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
  mainnetSuiClient,
  getBackendKeypair,
  getGasSponsorKeypair,
} from "../lib/sui-client.js";
import { getLocalNetworkConfig } from "../lib/config.js";
import {
  createEmptyTestIkaToken,
  destroyEmptyTestIkaToken,
} from "../lib/localnet.js";
import { deriveRootSeedKeyFromSignature } from "../lib/utils.js";
import { ENV } from "../lib/env.js";
import {
  getTokens,
  getQuote,
  submitDeposit,
  getStatus,
} from "../lib/near-intents.js";

const USDC_SUI_MAINNET =
  "0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC";

const router = express.Router();

// POST /api/bridge/quote
// Body: { dWalletId: string, solanaAddress: string, amount: string }
// amount is human-readable USDC e.g. "10.50"
// Returns depositAddress (send USDC here from Solana wallet) and suiAddress (recipient on Sui)
router.post("/quote", async (req: Request, res: Response) => {
  const { dWalletId, solanaAddress, amount } = req.body as {
    dWalletId?: string;
    solanaAddress?: string;
    amount?: string;
  };

  if (!dWalletId || !solanaAddress || !amount) {
    res
      .status(400)
      .json({ error: "dWalletId, solanaAddress, and amount are required" });
    return;
  }

  try {
    const ikaConfig = getLocalNetworkConfig();
    const ikaClient = new IkaClient({ suiClient, config: ikaConfig });
    await ikaClient.initialize();

    // 1. Fetch dWallet and derive Sui recipient address from its ED25519 public key
    const dWallet = await ikaClient.getDWallet(dWalletId);
    if (dWallet.state?.$kind !== "Active") {
      res.status(400).json({ error: "dWallet is not in Active state" });
      return;
    }

    const rawPublicOutput = dWallet.state.Active.public_output;
    const publicOutput =
      rawPublicOutput instanceof Uint8Array
        ? rawPublicOutput
        : new Uint8Array(rawPublicOutput);

    const pubkeyBytes = await publicKeyFromDWalletOutput(
      Curve.ED25519,
      publicOutput,
    );
    const suiAddress = new Ed25519PublicKey(pubkeyBytes).toSuiAddress();

    // 2. Discover USDC asset IDs on Solana and Sui from live token list
    const tokens = await getTokens();
    const solanaUsdc = tokens.find(
      (t) => t.symbol === "USDC" && t.blockchain === "sol",
    );
    const suiUsdc = tokens.find(
      (t) => t.symbol === "USDC" && t.blockchain === "sui",
    );

    if (!solanaUsdc) {
      console.warn("[bridge/quote] Solana USDC not found in token list");
      res
        .status(503)
        .json({ error: "USDC not available on Solana via NEAR Intents" });
      return;
    }
    if (!suiUsdc) {
      console.warn("[bridge/quote] Sui USDC not found in token list");
      res
        .status(503)
        .json({ error: "USDC not available on Sui via NEAR Intents" });
      return;
    }

    // 3. Convert human-readable amount to base units
    const baseAmount = Math.round(
      parseFloat(amount) * 10 ** solanaUsdc.decimals,
    ).toString();

    // 4. Fetch quote from NEAR Intents 1Click API
    const quote = await getQuote({
      originAsset: solanaUsdc.assetId,
      destinationAsset: suiUsdc.assetId,
      amount: baseAmount,
      recipient: suiAddress,
      refundTo: solanaAddress,
      dry: false,
      swapType: "EXACT_INPUT",
      slippageTolerance: 100, // 1%
      depositType: "ORIGIN_CHAIN",
      refundType: "ORIGIN_CHAIN",
      recipientType: "DESTINATION_CHAIN",
      deadline: new Date(Date.now() + 5 * 60 * 1000).toISOString(), // 5 min from now
    });

    console.log(
      `[bridge/quote] depositAddress=${quote.quote.depositAddress} suiRecipient=${suiAddress}`,
    );

    res.json({
      depositAddress: quote.quote.depositAddress,
      inputAmount: quote.quote.amountIn,
      outputAmount: quote.quote.amountOut,
      expiry: quote.quote.deadline,
      timeEstimate: quote.quote.timeEstimate,
      suiAddress,
    });
  } catch (e) {
    console.error("[bridge/quote] error:", e);
    res.status(502).json({
      error: e instanceof Error ? e.message : "Quote failed",
    });
  }
});

// POST /api/bridge/submit
// Body: { depositAddress: string, solanaTxId: string }
// Optional — speeds up solver detection, not required for the swap to complete
router.post("/submit", async (req: Request, res: Response) => {
  const { depositAddress, solanaTxId } = req.body as {
    depositAddress?: string;
    solanaTxId?: string;
  };

  if (!depositAddress || !solanaTxId) {
    res
      .status(400)
      .json({ error: "depositAddress and solanaTxId are required" });
    return;
  }

  try {
    await submitDeposit(depositAddress, solanaTxId);
    res.json({ ok: true });
  } catch (e) {
    console.error("[bridge/submit] error:", e);
    res.status(502).json({
      error: e instanceof Error ? e.message : "Submit failed",
    });
  }
});

// GET /api/bridge/status?depositAddress=...
// Proxies NEAR Intents status — poll until status is SUCCESS, REFUNDED, or FAILED
router.get("/status", async (req: Request, res: Response) => {
  const depositAddress = req.query.depositAddress as string | undefined;

  if (!depositAddress) {
    res.status(400).json({ error: "depositAddress query param is required" });
    return;
  }

  try {
    const status = await getStatus(depositAddress);
    res.json(status);
  } catch (e) {
    console.error("[bridge/status] error:", e);
    res.status(502).json({
      error: e instanceof Error ? e.message : "Status check failed",
    });
  }
});

// POST /api/bridge/withdraw-execute
// Body: { dWalletId, signature (Solana hex — same seed used at creation), depositAddress, inputAmount (base units) }
// Signs a Sui mainnet USDC transfer from the dWallet address to the NEAR Intents deposit address via IKA MPC
router.post("/withdraw-execute", async (req: Request, res: Response) => {
  const { dWalletId, signature, depositAddress, inputAmount } = req.body as {
    dWalletId?: string;
    signature?: string;
    depositAddress?: string;
    inputAmount?: string;
  };

  if (!dWalletId || !signature || !depositAddress || !inputAmount) {
    res.status(400).json({
      error:
        "dWalletId, signature, depositAddress, and inputAmount are required",
    });
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
    await ikaClient.initialize();

    // ── Step 1: fetch dWallet and derive its Sui address ─────────────────────
    const dWallet = await ikaClient.getDWalletInParticularState(
      dWalletId,
      "Active",
      {
        timeout: 30_000,
        interval: 3_000,
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
    const dWalletSuiAddress = new Ed25519PublicKey(pubkeyBytes).toSuiAddress();

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

    // ── Step 3: presign ──────────────────────────────────────────────────────
    console.log("[bridge/withdraw-execute] requesting presign...");
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

    console.log("[bridge/withdraw-execute] waiting for presign...", presignId);
    const completedPresign = await ikaClient.getPresignInParticularState(
      presignId,
      "Completed",
      {
        timeout: 180_000,
        interval: 3_000,
      },
    );

    // ── Step 4: build the Sui mainnet USDC transfer transaction ─────────────
    // Fetch USDC coin objects owned by the dWallet address
    const coinsRes = await fetch(ENV.SUI_MAINNET_RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "suix_getCoins",
        params: [dWalletSuiAddress, USDC_SUI_MAINNET, null, 50],
      }),
    });
    const coinsData = await coinsRes.json();
    const coins: Array<{ coinObjectId: string; balance: string }> =
      coinsData.result?.data ?? [];
    if (coins.length === 0) {
      throw new Error(
        `No USDC coins found at dWallet Sui address ${dWalletSuiAddress}`,
      );
    }

    const gasSponsor = getGasSponsorKeypair();
    const sponsorAddress = gasSponsor.getPublicKey().toSuiAddress();

    const targetTx = new Transaction();
    targetTx.setSender(dWalletSuiAddress);
    targetTx.setGasOwner(sponsorAddress);

    if (coins.length > 1) {
      targetTx.mergeCoins(
        targetTx.object(coins[0].coinObjectId),
        coins.slice(1).map((c) => targetTx.object(c.coinObjectId)),
      );
    }
    const [usdcCoin] = targetTx.splitCoins(
      targetTx.object(coins[0].coinObjectId),
      [BigInt(inputAmount)],
    );
    targetTx.transferObjects([usdcCoin], depositAddress);

    console.log("[withdraw-execute] dWalletSuiAddress:", dWalletSuiAddress);
    console.log("[withdraw-execute] senderAddress:", senderAddress);
    const txBytes = await targetTx.build({ client: mainnetSuiClient });

    // Sui intent prefix for TransactionData: [0, 0, 0]
    const intentMessage = new Uint8Array([0, 0, 0, ...txBytes]);
    const messageDigest = blake2b(intentMessage, { dkLen: 32 });

    // ── Step 5: sign with dWallet via IKA MPC ────────────────────────────────
    console.log("[bridge/withdraw-execute] signing with dWallet...");
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

    console.log("[bridge/withdraw-execute] waiting for IKA signature...");
    const completedSign = await ikaClient.getSignInParticularState(
      signEntry.objectId,
      Curve.ED25519,
      SignatureAlgorithm.EdDSA,
      "Completed",
    );
    const rawSignature = Uint8Array.from(
      completedSign.state.Completed.signature,
    );

    // ── Step 6: assemble Sui ed25519 signature and execute on mainnet ────────
    // Format: [0x00 (ed25519 flag)] + [64-byte signature] + [32-byte pubkey]
    const suiSignature = new Uint8Array([
      0x00,
      ...rawSignature,
      ...pubkeyBytes,
    ]);
    const dWalletSigBase64 = Buffer.from(suiSignature).toString("base64");

    // Gas sponsor also signs the transaction
    const sponsorSig = await gasSponsor.signTransaction(txBytes);

    console.log("[bridge/withdraw-execute] executing on Sui mainnet...");
    const execResult = await mainnetSuiClient.core.executeTransaction({
      transaction: txBytes,
      signatures: [dWalletSigBase64, sponsorSig.signature],
    });

    const digest =
      execResult.Transaction?.digest ?? execResult.FailedTransaction?.digest;
    console.log("[bridge/withdraw-execute] done, digest:", digest);

    res.json({ digest, suiAddress: dWalletSuiAddress });
  } catch (e) {
    console.error("[bridge/withdraw-execute] error:", e);
    res.status(500).json({
      error: e instanceof Error ? e.message : "Withdraw execute failed",
    });
  }
});

// POST /api/bridge/withdraw-quote
// Body: { dWalletId: string, solanaAddress: string, amount: string }
// amount is human-readable USDC e.g. "10.50"
// Returns depositAddress (send USDC here FROM the dWallet's Sui address) and solanaRecipient
router.post("/withdraw-quote", async (req: Request, res: Response) => {
  const { dWalletId, solanaAddress, amount } = req.body as {
    dWalletId?: string;
    solanaAddress?: string;
    amount?: string;
  };

  if (!dWalletId || !solanaAddress || !amount) {
    res
      .status(400)
      .json({ error: "dWalletId, solanaAddress, and amount are required" });
    return;
  }

  try {
    const ikaConfig = getLocalNetworkConfig();
    const ikaClient = new IkaClient({ suiClient, config: ikaConfig });
    await ikaClient.initialize();

    // 1. Derive the dWallet's Sui address (refund destination + source of funds)
    const dWallet = await ikaClient.getDWallet(dWalletId);
    if (dWallet.state?.$kind !== "Active") {
      res.status(400).json({ error: "dWallet is not in Active state" });
      return;
    }

    const rawPublicOutput = dWallet.state.Active.public_output;
    const publicOutput =
      rawPublicOutput instanceof Uint8Array
        ? rawPublicOutput
        : new Uint8Array(rawPublicOutput);

    const pubkeyBytes = await publicKeyFromDWalletOutput(
      Curve.ED25519,
      publicOutput,
    );
    const suiAddress = new Ed25519PublicKey(pubkeyBytes).toSuiAddress();

    // 2. Discover USDC asset IDs
    const tokens = await getTokens();
    const suiUsdc = tokens.find(
      (t) => t.symbol === "USDC" && t.blockchain === "sui",
    );
    const solanaUsdc = tokens.find(
      (t) => t.symbol === "USDC" && t.blockchain === "sol",
    );

    if (!suiUsdc) {
      res
        .status(503)
        .json({ error: "USDC not available on Sui via NEAR Intents" });
      return;
    }
    if (!solanaUsdc) {
      res
        .status(503)
        .json({ error: "USDC not available on Solana via NEAR Intents" });
      return;
    }

    // 3. Convert human-readable amount to base units
    const baseAmount = Math.round(
      parseFloat(amount) * 10 ** suiUsdc.decimals,
    ).toString();

    // 4. Fetch quote: Sui USDC → Solana USDC
    const quote = await getQuote({
      originAsset: suiUsdc.assetId,
      destinationAsset: solanaUsdc.assetId,
      amount: baseAmount,
      recipient: solanaAddress, // Phantom wallet receives on Solana
      refundTo: suiAddress, // refund back to dWallet Sui address
      dry: false,
      swapType: "EXACT_INPUT",
      slippageTolerance: 100, // 1%
      depositType: "ORIGIN_CHAIN", // deposit address is on Sui
      refundType: "ORIGIN_CHAIN", // refund on Sui
      recipientType: "DESTINATION_CHAIN",
      deadline: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    });

    console.log(
      `[bridge/withdraw-quote] depositAddress=${quote.quote.depositAddress} solanaRecipient=${solanaAddress} suiSource=${suiAddress}`,
    );

    res.json({
      depositAddress: quote.quote.depositAddress, // Sui address — send USDC here
      inputAmount: quote.quote.amountIn,
      outputAmount: quote.quote.amountOut,
      expiry: quote.quote.deadline,
      timeEstimate: quote.quote.timeEstimate,
      suiAddress, // dWallet's Sui address (source of funds)
      solanaRecipient: solanaAddress,
    });
  } catch (e) {
    console.error("[bridge/withdraw-quote] error:", e);
    res.status(502).json({
      error: e instanceof Error ? e.message : "Withdraw quote failed",
    });
  }
});

export default router;
