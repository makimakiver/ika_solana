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
import { Transaction, type TransactionObjectArgument } from "@mysten/sui/transactions";
import { blake2b } from "@noble/hashes/blake2b";
import { Ed25519PublicKey } from "@mysten/sui/keypairs/ed25519";
import { suiClient, mainnetSuiClient, getBackendKeypair } from "../lib/sui-client.js";
import { getLocalNetworkConfig } from "../lib/config.js";
import { createEmptyTestIkaToken, destroyEmptyTestIkaToken } from "../lib/localnet.js";
import { deriveRootSeedKeyFromSignature } from "../lib/utils.js";
import { getLiFiQuote, getLiFiStatus } from "../lib/lifi.js";

const router = express.Router();

// Solana mainnet USDC mint
const SOL_USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
// Sui mainnet USDC type
const SUI_USDC = "0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC";

// POST /api/lifi/deposit-quote
// Body: { dWalletId, solanaAddress, amount (human-readable USDC) }
// Returns LI.FI quote incl. transactionRequest (serialized Solana tx the user must sign)
router.post("/deposit-quote", async (req: Request, res: Response) => {
  const { dWalletId, solanaAddress, amount } = req.body as {
    dWalletId?: string;
    solanaAddress?: string;
    amount?: string;
  };

  if (!dWalletId || !solanaAddress || !amount) {
    res.status(400).json({ error: "dWalletId, solanaAddress, and amount are required" });
    return;
  }

  try {
    const ikaConfig = getLocalNetworkConfig();
    const ikaClient = new IkaClient({ suiClient, config: ikaConfig });
    await ikaClient.initialize();

    // Derive recipient Sui address from dWallet public key
    const dWallet = await ikaClient.getDWallet(dWalletId);
    if (dWallet.state?.$kind !== "Active") {
      res.status(400).json({ error: "dWallet is not in Active state" });
      return;
    }

    const rawPublicOutput = dWallet.state.Active.public_output;
    const publicOutput =
      rawPublicOutput instanceof Uint8Array ? rawPublicOutput : new Uint8Array(rawPublicOutput);
    const pubkeyBytes = await publicKeyFromDWalletOutput(Curve.ED25519, publicOutput);
    const suiAddress = new Ed25519PublicKey(pubkeyBytes).toSuiAddress();

    // Convert human-readable to base units (USDC has 6 decimals)
    const baseAmount = Math.round(parseFloat(amount) * 1_000_000).toString();

    const quote = await getLiFiQuote({
      fromChain: "SOL",
      toChain: "SUI",
      fromToken: SOL_USDC,
      toToken: SUI_USDC,
      fromAmount: baseAmount,
      fromAddress: solanaAddress,
      toAddress: suiAddress,
      slippage: 0.005,
    });

    console.log(
      `[lifi/deposit-quote] tool=${quote.tool} fromAmount=${quote.estimate.fromAmount} toAmount=${quote.estimate.toAmount} recipient=${suiAddress}`,
    );

    res.json({
      quoteId: quote.id,
      tool: quote.tool,
      transactionRequest: quote.transactionRequest,
      inputAmount: quote.estimate.fromAmount,
      outputAmount: quote.estimate.toAmount,
      outputAmountMin: quote.estimate.toAmountMin,
      executionDuration: quote.estimate.executionDuration,
      suiAddress,
    });
  } catch (e) {
    console.error("[lifi/deposit-quote] error:", e);
    res.status(502).json({ error: e instanceof Error ? e.message : "LI.FI quote failed" });
  }
});

// POST /api/lifi/withdraw-quote
// Body: { dWalletId, solanaAddress, amount (human-readable USDC) }
// Returns LI.FI quote incl. transactionRequest (Sui PTB bytes the backend must sign via MPC)
router.post("/withdraw-quote", async (req: Request, res: Response) => {
  const { dWalletId, solanaAddress, amount } = req.body as {
    dWalletId?: string;
    solanaAddress?: string;
    amount?: string;
  };

  if (!dWalletId || !solanaAddress || !amount) {
    res.status(400).json({ error: "dWalletId, solanaAddress, and amount are required" });
    return;
  }

  try {
    const ikaConfig = getLocalNetworkConfig();
    const ikaClient = new IkaClient({ suiClient, config: ikaConfig });
    await ikaClient.initialize();

    const dWallet = await ikaClient.getDWallet(dWalletId);
    if (dWallet.state?.$kind !== "Active") {
      res.status(400).json({ error: "dWallet is not in Active state" });
      return;
    }

    const rawPublicOutput = dWallet.state.Active.public_output;
    const publicOutput =
      rawPublicOutput instanceof Uint8Array ? rawPublicOutput : new Uint8Array(rawPublicOutput);
    const pubkeyBytes = await publicKeyFromDWalletOutput(Curve.ED25519, publicOutput);
    const suiAddress = new Ed25519PublicKey(pubkeyBytes).toSuiAddress();

    const baseAmount = Math.round(parseFloat(amount) * 1_000_000).toString();

    const quote = await getLiFiQuote({
      fromChain: "SUI",
      toChain: "SOL",
      fromToken: SUI_USDC,
      toToken: SOL_USDC,
      fromAmount: baseAmount,
      fromAddress: suiAddress,
      toAddress: solanaAddress,
      slippage: 0.005,
    });

    console.log(
      `[lifi/withdraw-quote] tool=${quote.tool} fromAmount=${quote.estimate.fromAmount} toAmount=${quote.estimate.toAmount} source=${suiAddress}`,
    );

    res.json({
      quoteId: quote.id,
      tool: quote.tool,
      transactionRequest: quote.transactionRequest,
      inputAmount: quote.estimate.fromAmount,
      outputAmount: quote.estimate.toAmount,
      outputAmountMin: quote.estimate.toAmountMin,
      executionDuration: quote.estimate.executionDuration,
      suiAddress,
      solanaRecipient: solanaAddress,
    });
  } catch (e) {
    console.error("[lifi/withdraw-quote] error:", e);
    res.status(502).json({ error: e instanceof Error ? e.message : "LI.FI withdraw quote failed" });
  }
});

// POST /api/lifi/withdraw-execute
// Body: { dWalletId, signature (Solana hex), transactionData (base64 Sui PTB from LI.FI) }
// Signs the Sui PTB via IKA MPC and executes on Sui mainnet
router.post("/withdraw-execute", async (req: Request, res: Response) => {
  const { dWalletId, signature, transactionData } = req.body as {
    dWalletId?: string;
    signature?: string;
    transactionData?: string;
  };

  if (!dWalletId || !signature || !transactionData) {
    res.status(400).json({ error: "dWalletId, signature, and transactionData are required" });
    return;
  }

  try {
    const keypair = getBackendKeypair();
    const senderAddress = keypair.getPublicKey().toSuiAddress();
    const ikaConfig = getLocalNetworkConfig();

    const rootSeedKey = deriveRootSeedKeyFromSignature(signature);
    const userShareKeys = await UserShareEncryptionKeys.fromRootSeedKey(rootSeedKey, Curve.ED25519);

    const ikaClient = new IkaClient({ suiClient, config: ikaConfig });
    await ikaClient.initialize();

    // Fetch dWallet and its public key
    const dWallet = await ikaClient.getDWalletInParticularState(dWalletId, "Active", {
      timeout: 30_000,
      interval: 3_000,
    });
    if (!dWallet.state?.Active?.public_output) throw new Error("dWallet not active");

    const publicOutput =
      dWallet.state.Active.public_output instanceof Uint8Array
        ? dWallet.state.Active.public_output
        : new Uint8Array(dWallet.state.Active.public_output);

    const pubkeyBytes = await publicKeyFromDWalletOutput(Curve.ED25519, publicOutput);

    // Get encrypted user secret key share
    const tableId = dWallet.encrypted_user_secret_key_shares?.id;
    if (!tableId) throw new Error("encrypted_user_secret_key_shares not found");
    const dynamicFields = await suiClient.core.listDynamicFields({ parentId: tableId });
    const encryptedUserSecretKeyShareId = dynamicFields.dynamicFields[0]?.childId;
    if (!encryptedUserSecretKeyShareId) throw new Error("Encrypted key share not found");
    const encryptedUserSecretKeyShare = await ikaClient.getEncryptedUserSecretKeyShare(
      encryptedUserSecretKeyShareId,
    );

    // ── Presign ──────────────────────────────────────────────────────────────
    console.log("[lifi/withdraw-execute] requesting presign...");
    const presignTx = new Transaction();
    const presignIkaTx = new IkaTransaction({
      ikaClient,
      transaction: presignTx,
      userShareEncryptionKeys: userShareKeys,
    });
    const dWalletEncryptionKey = await ikaClient.getLatestNetworkEncryptionKey();
    const emptyIkaCoin1 = createEmptyTestIkaToken(presignTx, ikaConfig);
    const unverifiedPresignCap = presignIkaTx.requestGlobalPresign({
      curve: Curve.ED25519,
      signatureAlgorithm: SignatureAlgorithm.EdDSA,
      ikaCoin: emptyIkaCoin1,
      suiCoin: presignTx.gas,
      dwalletNetworkEncryptionKeyId: dWalletEncryptionKey.id,
    });
    presignTx.transferObjects([unverifiedPresignCap as TransactionObjectArgument], senderAddress);
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

    console.log("[lifi/withdraw-execute] waiting for presign...", presignId);
    const completedPresign = await ikaClient.getPresignInParticularState(presignId, "Completed", {
      timeout: 180_000,
      interval: 3_000,
    });

    // ── Build intent hash from LI.FI's Sui PTB ───────────────────────────────
    // LI.FI returns the Sui PTB as base64-encoded BCS bytes
    const txBytes = Buffer.from(transactionData, "base64");
    const intentMessage = new Uint8Array([0, 0, 0, ...txBytes]);
    const messageDigest = blake2b(intentMessage, { dkLen: 32 });

    // ── Sign via IKA MPC ──────────────────────────────────────────────────────
    console.log("[lifi/withdraw-execute] signing with dWallet...");
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
    const verifiedPresignCap = signIkaTx.verifyPresignCap({ presign: completedPresign });
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
        signWait.Transaction?.objectTypes?.[obj.objectId]?.includes("SignSession"),
    );
    if (!signEntry) throw new Error("SignSession not found in transaction effects");

    console.log("[lifi/withdraw-execute] waiting for IKA signature...");
    const completedSign = await ikaClient.getSignInParticularState(
      signEntry.objectId,
      Curve.ED25519,
      SignatureAlgorithm.EdDSA,
      "Completed",
    );
    const rawSignature = Uint8Array.from(completedSign.state.Completed.signature);

    // Assemble Sui ed25519 signature: [0x00 flag] + [64-byte sig] + [32-byte pubkey]
    const suiSignature = new Uint8Array([0x00, ...rawSignature, ...pubkeyBytes]);
    const suiSigBase64 = Buffer.from(suiSignature).toString("base64");

    console.log("[lifi/withdraw-execute] executing on Sui mainnet...");
    const execResult = await mainnetSuiClient.core.executeTransaction({
      transaction: txBytes,
      signatures: [suiSigBase64],
    });

    const digest = execResult.Transaction?.digest ?? execResult.FailedTransaction?.digest;
    console.log("[lifi/withdraw-execute] done, digest:", digest);

    res.json({ digest });
  } catch (e) {
    console.error("[lifi/withdraw-execute] error:", e);
    res.status(500).json({ error: e instanceof Error ? e.message : "LI.FI withdraw execute failed" });
  }
});

// GET /api/lifi/status?txHash=...&fromChain=...&toChain=...
router.get("/status", async (req: Request, res: Response) => {
  const { txHash, fromChain, toChain } = req.query as {
    txHash?: string;
    fromChain?: string;
    toChain?: string;
  };

  if (!txHash || !fromChain || !toChain) {
    res.status(400).json({ error: "txHash, fromChain, and toChain are required" });
    return;
  }

  try {
    const status = await getLiFiStatus(txHash, fromChain, toChain);
    res.json(status);
  } catch (e) {
    console.error("[lifi/status] error:", e);
    res.status(502).json({ error: e instanceof Error ? e.message : "Status check failed" });
  }
});

export default router;
