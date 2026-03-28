import express from "express";
import type { Request, Response } from "express";
import { ed25519 } from "@noble/curves/ed25519";
import bs58 from "bs58";
import {
  IkaClient,
  IkaTransaction,
  UserShareEncryptionKeys,
  createRandomSessionIdentifier,
  Curve,
  prepareDKGAsync,
  publicKeyFromDWalletOutput,
} from "@ika.xyz/sdk";
import {
  Transaction,
  type TransactionObjectArgument,
} from "@mysten/sui/transactions";
import { getFaucetHost, requestSuiFromFaucetV2 } from "@mysten/sui/faucet";
import { Ed25519PublicKey } from "@mysten/sui/keypairs/ed25519";
import { buildCreateDWalletMessage } from "../protocol.js";
import { getLocalNetworkConfig } from "../lib/config.js";
import {
  createEmptyTestIkaToken,
  destroyEmptyTestIkaToken,
} from "../lib/localnet.js";
import { deriveRootSeedKeyFromSignature } from "../lib/utils.js";
import { suiClient, getBackendKeypair } from "../lib/sui-client.js";

const router = express.Router();

// POST /api/dwallet/create
// Body: { address: string, signature: string (hex) }
// Response: { dWalletId: string, dWalletCapId: string }
router.post("/create", async (req: Request, res: Response) => {
  const { address, signature } = req.body as {
    address?: string;
    signature?: string;
  };

  if (!address || !signature) {
    res.status(400).json({ error: "address and signature are required" });
    return;
  }

  /**
   * Verify the ed25519 signature against the fixed protocol message:
   *   protocol:URCHIN_PROTOCOL_V1
   *   action:CREATE_DWALLET
   *   address:<base58 solana pubkey>
   */
  let valid = false;
  try {
    const message = buildCreateDWalletMessage(address);
    console.log("[dwallet/create] message user signed:\n", message);
    const messageBytes = new TextEncoder().encode(message);
    const pubkeyBytes = bs58.decode(address);
    const sigBytes = Buffer.from(signature, "hex");
    valid = ed25519.verify(sigBytes, messageBytes, pubkeyBytes);
    console.log("[dwallet/create] signature valid:", valid);
  } catch (e) {
    console.error("[dwallet/create] verification threw:", e);
    res.status(400).json({ error: "Invalid signature format" });
    return;
  }

  if (!valid) {
    res.status(401).json({ error: "Signature verification failed" });
    return;
  }

  try {
    const keypair = getBackendKeypair();
    const senderAddress = keypair.getPublicKey().toSuiAddress();

    const ikaConfig = getLocalNetworkConfig();
    const ikaClient = new IkaClient({ suiClient, config: ikaConfig });

    // Derive deterministic encryption key from the user's Solana signature
    const rootSeedKey = deriveRootSeedKeyFromSignature(signature);
    const userShareKeys = await UserShareEncryptionKeys.fromRootSeedKey(
      rootSeedKey,
      Curve.ED25519,
    );

    console.log("[dwallet/create] initializing IKA client...");
    await ikaClient.initialize();

    await requestSuiFromFaucetV2({
      host: getFaucetHost("localnet"),
      recipient: senderAddress,
    });

    const sessionId = createRandomSessionIdentifier();

    const tx = new Transaction();
    const ikaTx = new IkaTransaction({
      ikaClient,
      transaction: tx,
      userShareEncryptionKeys: userShareKeys,
    });

    let encryptionKeyExists = false;
    try {
      await ikaClient.getActiveEncryptionKey(senderAddress);
      encryptionKeyExists = true;
    } catch {
      encryptionKeyExists = false;
    }

    if (!encryptionKeyExists) {
      console.log("[dwallet/create] registering encryption key...");
      await ikaTx.registerEncryptionKey({ curve: Curve.ED25519 });
    } else {
      console.log("[dwallet/create] encryption key already registered, skipping...");
    }

    console.log("[dwallet/create] fetching network encryption key...");
    const dWalletEncryptionKey =
      await ikaClient.getLatestNetworkEncryptionKey();

    console.log("[dwallet/create] preparing DKG...");
    const dkgRequestInput = await prepareDKGAsync(
      ikaClient,
      Curve.ED25519,
      userShareKeys,
      sessionId,
      senderAddress,
    );

    const emptyIKACoin = createEmptyTestIkaToken(tx, ikaConfig);

    console.log("[dwallet/create] requesting dWallet DKG...");
    const [dwalletCap] = await ikaTx.requestDWalletDKG({
      dkgRequestInput,
      sessionIdentifier: ikaTx.registerSessionIdentifier(sessionId),
      dwalletNetworkEncryptionKeyId: dWalletEncryptionKey.id,
      curve: Curve.ED25519,
      ikaCoin: emptyIKACoin,
      suiCoin: tx.gas,
    });

    tx.transferObjects(
      [dwalletCap as TransactionObjectArgument],
      senderAddress,
    );
    destroyEmptyTestIkaToken(tx, ikaConfig, emptyIKACoin);

    console.log("[dwallet/create] submitting transaction...");
    const result = await suiClient.signAndExecuteTransaction({
      transaction: tx,
      signer: keypair,
      signal: AbortSignal.timeout(120_000),
    });

    const txDigest = result.Transaction!.digest;
    console.log("[dwallet/create] tx digest:", txDigest);

    const waitResult = await suiClient.waitForTransaction({
      result,
      timeout: 120_000,
      include: {
        effects: true,
        objectTypes: true,
      },
    });

    const createdCapEntry =
      waitResult.Transaction?.effects?.changedObjects?.find(
        (obj: any) =>
          obj.inputState === "DoesNotExist" &&
          waitResult.Transaction?.objectTypes?.[obj.objectId]?.includes(
            "DWalletCap",
          ),
      );
    if (!createdCapEntry)
      throw new Error("DWalletCap not found in transaction effects");

    const dWalletCapId = createdCapEntry.objectId;

    const newCapObj = await suiClient.core.getObject({
      objectId: dWalletCapId,
      include: { json: true },
    });
    const dWalletId = newCapObj.object?.json?.dwallet_id as string;
    if (!dWalletId) throw new Error("dwallet_id not found on DWalletCap");

    console.log("[dwallet/create] waiting for AwaitingKeyHolderSignature...");
    const dWalletReady = await ikaClient.getDWalletInParticularState(
      dWalletId,
      "AwaitingKeyHolderSignature",
      { timeout: 300000, interval: 5000 },
    );

    const activationTx = new Transaction();
    const activationIkaTx = new IkaTransaction({
      ikaClient,
      transaction: activationTx,
      userShareEncryptionKeys: userShareKeys,
    });

    const tableId = dWalletReady.encrypted_user_secret_key_shares?.id;
    if (!tableId)
      throw new Error("encrypted_user_secret_key_shares table not found");

    const dynamicFields = await suiClient.core.listDynamicFields({
      parentId: tableId,
    });
    const encryptedUserSecretKeyShareId = dynamicFields.dynamicFields[0]?.childId;
    if (!encryptedUserSecretKeyShareId)
      throw new Error("Encrypted user secret key share not found");

    await activationIkaTx.acceptEncryptedUserShare({
      dWallet: dWalletReady,
      encryptedUserSecretKeyShareId,
      userPublicOutput: dkgRequestInput.userPublicOutput,
    });

    console.log("[dwallet/create] submitting activation transaction...");
    const activationResult = await suiClient.signAndExecuteTransaction({
      transaction: activationTx,
      signer: keypair,
    });

    console.log("[dwallet/create] waiting for dWallet Active state...");
    const activeDWallet = await ikaClient.getDWalletInParticularState(dWalletId, "Active", {
      timeout: 120000,
      interval: 3000,
    });

    const publicOutput = activeDWallet.state.Active.public_output instanceof Uint8Array
      ? activeDWallet.state.Active.public_output
      : new Uint8Array(activeDWallet.state.Active.public_output);

    const publicKey = await publicKeyFromDWalletOutput(Curve.ED25519, publicOutput);
    const publicKeyHex = Buffer.from(publicKey).toString("hex");

    console.log("[dwallet/create] dWallet active:", dWalletId, "pubkey:", publicKeyHex);
    res.json({
      dWalletId,
      dWalletCapId,
      publicKey: publicKeyHex,
      transactionDigest: activationResult.Transaction!.digest,
    });
  } catch (e) {
    console.error("[dwallet/create] error:", e);
    res.status(500).json({
      error: e instanceof Error ? e.message : "dWallet creation failed",
    });
  }
});

// GET /api/dwallet/list
// Returns all DWalletCap objects owned by the backend Sui account
router.get("/list", async (_req: Request, res: Response) => {
  try {
    const keypair = getBackendKeypair();
    const ownerAddress = keypair.getPublicKey().toSuiAddress();

    const ikaConfig = getLocalNetworkConfig();
    const ikaClient = new IkaClient({ suiClient, config: ikaConfig });
    await ikaClient.initialize();

    const ownedObjects = await suiClient.core.listOwnedObjects({
      owner: ownerAddress,
      type: `${ikaConfig.packages.ikaDwallet2pcMpcPackage}::coordinator_inner::DWalletCap`,
      include: { json: true },
    });

    const results = await Promise.all(
      ownedObjects.objects.map(async (obj: any) => {
        const dwalletId = obj.json?.dwallet_id as string | undefined;
        if (!dwalletId) return null;

        let isActive = false;
        let publicKey: string | null = null;
        let suiAddress: string | null = null;
        try {
          const dWallet = await ikaClient.getDWallet(dwalletId);
          isActive = dWallet.state?.$kind === "Active";
          if (isActive && dWallet.state?.Active?.public_output) {
            const publicOutput = dWallet.state.Active.public_output instanceof Uint8Array
              ? dWallet.state.Active.public_output
              : new Uint8Array(dWallet.state.Active.public_output);
            const pubkey = await publicKeyFromDWalletOutput(Curve.ED25519, publicOutput);
            publicKey = Buffer.from(pubkey).toString("hex");
            suiAddress = new Ed25519PublicKey(pubkey).toSuiAddress();
          }
        } catch {
          isActive = false;
        }

        return { capId: obj.objectId, dwalletId, isActive, publicKey, suiAddress };
      }),
    );

    res.json({ dWallets: results.filter(Boolean) });
  } catch (e) {
    console.error("[dwallet/list] error:", e);
    res.status(500).json({ error: e instanceof Error ? e.message : "Failed to list dWallets" });
  }
});

export default router;
