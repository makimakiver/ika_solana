import express from "express";
import type { Request, Response } from "express";
import {
  IkaClient,
  IkaTransaction,
  UserShareEncryptionKeys,
  Curve,
  SignatureAlgorithm,
  Hash,
  SessionsManagerModule,
  CoordinatorInnerModule,
  publicKeyFromDWalletOutput,
} from "@ika.xyz/sdk";
import {
  Transaction,
  type TransactionObjectArgument,
} from "@mysten/sui/transactions";
import { blake2b } from "@noble/hashes/blake2b";
import { Ed25519PublicKey } from "@mysten/sui/keypairs/ed25519";
import {
  suiClient,
  testnetSuiClient,
  getBackendKeypair,
} from "../lib/sui-client.js";
import { getLocalNetworkConfig } from "../lib/config.js";
import {
  createEmptyTestIkaToken,
  destroyEmptyTestIkaToken,
} from "../lib/localnet.js";
import { deriveRootSeedKeyFromSignature } from "../lib/utils.js";

const router = express.Router();

const URCHIN_PACKAGE =
  "0x679e4dec2919a6ea94367a91e49b5698e4f80ec13fb50452199df2f9212439d9";

// POST /api/test/sign-sui
// Signs a Sui transaction using the IKA dWallet
// Body: { dWalletId: string, signature: string (Solana hex sig, to derive seed) }
router.post("/sign-sui", async (req: Request, res: Response) => {
  const { dWalletId, signature } = req.body as {
    dWalletId?: string;
    signature?: string;
  };

  if (!dWalletId || !signature) {
    res.status(400).json({ error: "dWalletId and signature are required" });
    return;
  }

  try {
    const keypair = getBackendKeypair();
    const senderAddress = keypair.getPublicKey().toSuiAddress();
    const ikaConfig = getLocalNetworkConfig();

    const rootSeedKey = deriveRootSeedKeyFromSignature(signature);
    const userShareKeys = await UserShareEncryptionKeys.fromRootSeedKey(
      rootSeedKey,
      Curve.ED25519,
    );

    const ikaClient = new IkaClient({ suiClient, config: ikaConfig });
    console.log("[test/sign-sui] initializing IKA client...");
    await ikaClient.initialize();

    // ── Step 1: fetch active dWallet and its public key ──────────────────────
    const dWallet = await ikaClient.getDWalletInParticularState(
      dWalletId,
      "Active",
      {
        timeout: 30000,
        interval: 3000,
      },
    );
    if (!dWallet.state?.Active?.public_output)
      throw new Error("dWallet not active");

    const publicOutput =
      dWallet.state.Active.public_output instanceof Uint8Array
        ? dWallet.state.Active.public_output
        : new Uint8Array(dWallet.state.Active.public_output);

    const pubkeyBytes = await publicKeyFromDWalletOutput(
      Curve.ED25519,
      publicOutput,
    );

    // ── Step 2: get encrypted user secret key share ──────────────────────────
    const tableId = dWallet.encrypted_user_secret_key_shares?.id;
    if (!tableId) throw new Error("encrypted_user_secret_key_shares not found");

    const dynamicFields = await suiClient.core.listDynamicFields({
      parentId: tableId,
    });
    const encryptedUserSecretKeyShareId =
      dynamicFields.dynamicFields[0]?.childId;
    if (!encryptedUserSecretKeyShareId)
      throw new Error("Encrypted key share not found");

    const encryptedUserSecretKeyShare =
      await ikaClient.getEncryptedUserSecretKeyShare(
        encryptedUserSecretKeyShareId,
      );

    // ── Step 3: request presign ──────────────────────────────────────────────
    console.log("[test/sign-sui] requesting presign...");
    const presignTx = new Transaction();
    const presignIkaTx = new IkaTransaction({
      ikaClient,
      transaction: presignTx,
      userShareEncryptionKeys: userShareKeys,
    });

    const dWalletEncryptionKey =
      await ikaClient.getLatestNetworkEncryptionKey();
    const emptyIkaCoin1 = createEmptyTestIkaToken(presignTx, ikaConfig);

    const unverifiedPresignCap = presignIkaTx.requestGlobalPresign({
      curve: Curve.ED25519,
      signatureAlgorithm: SignatureAlgorithm.EdDSA,
      ikaCoin: emptyIkaCoin1,
      suiCoin: presignTx.gas,
      dwalletNetworkEncryptionKeyId: dWalletEncryptionKey.id,
    });
    presignTx.transferObjects(
      [unverifiedPresignCap as TransactionObjectArgument],
      senderAddress,
    );
    destroyEmptyTestIkaToken(presignTx, ikaConfig, emptyIkaCoin1);

    const presignResult = await suiClient.signAndExecuteTransaction({
      transaction: presignTx,
      signer: keypair,
      signal: AbortSignal.timeout(60_000),
    });

    const presignWait = await suiClient.waitForTransaction({
      result: presignResult,
      timeout: 60_000,
      include: { effects: true, events: true, objectTypes: true },
    });

    const presignEvent = presignWait.Transaction?.events?.find((e: any) =>
      e.eventType?.includes("PresignRequestEvent"),
    );
    if (!presignEvent) throw new Error("PresignRequestEvent not found");

    const parsedEvent = SessionsManagerModule.DWalletSessionEvent(
      CoordinatorInnerModule.PresignRequestEvent,
    ).parse(presignEvent.bcs);
    const presignId = parsedEvent.event_data.presign_id;

    console.log(
      "[test/sign-sui] waiting for presign to complete...",
      presignId,
    );
    const completedPresign = await ikaClient.getPresignInParticularState(
      presignId,
      "Completed",
      {
        timeout: 180000,
        interval: 3000,
      },
    );

    // ── Step 4: build the target transaction and get bytes to sign ────────────
    const dWalletSuiAddress = new Ed25519PublicKey(pubkeyBytes).toSuiAddress();
    const targetTx = new Transaction();
    targetTx.moveCall({
      target: `${URCHIN_PACKAGE}::contract::test_call`,
      arguments: [],
    });
    targetTx.setSender(dWalletSuiAddress);
    // TODO: replace with real Urchin Move call once ABI is known
    const txBytes = await targetTx.build({ client: testnetSuiClient });

    // Sui intent prefix for TransactionData: [0, 0, 0]
    const intentMessage = new Uint8Array([0, 0, 0, ...txBytes]);
    // Sui verifies ed25519 signatures against blake2b-256 of the intent message
    const messageDigest = blake2b(intentMessage, { dkLen: 32 });

    // ── Step 5: sign tx bytes with dWallet ───────────────────────────────────
    console.log("[test/sign-sui] signing with dWallet...");
    const signTx = new Transaction();
    const signIkaTx = new IkaTransaction({
      ikaClient,
      transaction: signTx,
      userShareEncryptionKeys: userShareKeys,
    });

    const emptyIkaCoin2 = createEmptyTestIkaToken(signTx, ikaConfig);

    const messageApproval = signIkaTx.approveMessage({
      message: messageDigest,
      curve: Curve.ED25519,
      dWalletCap: dWallet.dwallet_cap_id,
      signatureAlgorithm: SignatureAlgorithm.EdDSA,
      hashScheme: Hash.SHA512,
    });

    const verifiedPresignCap = signIkaTx.verifyPresignCap({
      presign: completedPresign,
    });

    await signIkaTx.requestSign({
      dWallet,
      messageApproval,
      hashScheme: Hash.SHA512,
      verifiedPresignCap,
      presign: completedPresign,
      message: messageDigest,
      signatureScheme: SignatureAlgorithm.EdDSA,
      ikaCoin: emptyIkaCoin2,
      suiCoin: signTx.gas,
      publicOutput,
      encryptedUserSecretKeyShare,
    });
    destroyEmptyTestIkaToken(signTx, ikaConfig, emptyIkaCoin2);

    const signResult = await suiClient.signAndExecuteTransaction({
      transaction: signTx,
      signer: keypair,
      signal: AbortSignal.timeout(60_000),
    });

    const signWait = await suiClient.waitForTransaction({
      result: signResult,
      timeout: 60_000,
      include: { effects: true, objectTypes: true },
    });

    const signEntry = signWait.Transaction?.effects?.changedObjects?.find(
      (obj: any) =>
        obj.inputState === "DoesNotExist" &&
        signWait.Transaction?.objectTypes?.[obj.objectId]?.includes(
          "SignSession",
        ),
    );
    if (!signEntry)
      throw new Error("SignSession not found in transaction effects");

    console.log("[test/sign-sui] waiting for IKA signature...");
    const completedSign = await ikaClient.getSignInParticularState(
      signEntry.objectId,
      Curve.ED25519,
      SignatureAlgorithm.EdDSA,
      "Completed",
    );

    const rawSignature = Uint8Array.from(
      completedSign.state.Completed.signature,
    );

    console.log("[test/sign-sui] rawSignature length:", rawSignature.length);
    console.log("[test/sign-sui] pubkeyBytes length:", pubkeyBytes.length);
    console.log(
      "[test/sign-sui] rawSignature hex:",
      Buffer.from(rawSignature).toString("hex"),
    );
    console.log(
      "[test/sign-sui] pubkeyBytes hex:",
      Buffer.from(pubkeyBytes).toString("hex"),
    );
    console.log("[test/sign-sui] dWalletSuiAddress:", dWalletSuiAddress);
    console.log(
      "[test/sign-sui] intentMessage hex:",
      Buffer.from(intentMessage).toString("hex"),
    );

    // ── Step 6: assemble Sui ed25519 signature and execute ───────────────────
    // Format: [0x00 (ed25519 flag)] + [64-byte signature] + [32-byte pubkey]
    const suiSignature = new Uint8Array([
      0x00,
      ...rawSignature,
      ...pubkeyBytes,
    ]);
    const suiSigBase64 = Buffer.from(suiSignature).toString("base64");

    console.log("[test/sign-sui] suiSignature length:", suiSignature.length);
    console.log("[test/sign-sui] executing signed transaction...");
    const execResult = await testnetSuiClient.core.executeTransaction({
      transaction: txBytes,
      signatures: [suiSigBase64],
    });

    const digest =
      execResult.Transaction?.digest ?? execResult.FailedTransaction?.digest;
    console.log("[test/sign-sui] done, digest:", digest);

    res.json({ digest, signer: senderAddress, dWalletId });
  } catch (e) {
    console.error("[test/sign-sui] error:", e);
    res
      .status(500)
      .json({ error: e instanceof Error ? e.message : "Signing failed" });
  }
});

export default router;
