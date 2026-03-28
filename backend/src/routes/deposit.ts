import express from "express";
import type { Request, Response } from "express";
import { Transaction } from "@mysten/sui/transactions";
import { suiClient, getBackendKeypair } from "../lib/sui-client.js";

const router = express.Router();

const URCHIN_PACKAGE = "0x679e4dec2919a6ea94367a91e49b5698e4f80ec13fb50452199df2f9212439d9";

// POST /api/deposit
// Body: { dWalletId: string, capId: string }
// Signs and executes a Sui testnet transaction to register a deposit on the Urchin contract
router.post("/", async (req: Request, res: Response) => {
  const { dWalletId, capId } = req.body as {
    dWalletId?: string;
    capId?: string;
  };

  if (!dWalletId || !capId) {
    res.status(400).json({ error: "dWalletId and capId are required" });
    return;
  }

  try {
    const keypair = getBackendKeypair();

    const tx = new Transaction();

    // TODO: replace with the actual Urchin Move function once the ABI is available
    // tx.moveCall({
    //   target: `${URCHIN_PACKAGE}::<module>::<function>`,
    //   arguments: [tx.object(capId), tx.pure.address(dWalletId)],
    // });

    console.log(`[deposit] signing tx for dWallet ${dWalletId} via ${URCHIN_PACKAGE}`);

    const result = await suiClient.signAndExecuteTransaction({
      transaction: tx,
      signer: keypair,
      signal: AbortSignal.timeout(60_000),
    });

    const digest = result.Transaction!.digest;
    console.log("[deposit] tx digest:", digest);

    res.json({ digest });
  } catch (e) {
    console.error("[deposit] error:", e);
    res.status(500).json({ error: e instanceof Error ? e.message : "Deposit failed" });
  }
});

export default router;
