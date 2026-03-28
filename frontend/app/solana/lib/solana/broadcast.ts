import {
  Connection,
  PublicKey,
  Transaction as SolanaTransaction,
} from "@solana/web3.js";
import { toast } from "sonner";

/**
 * Attaches an Ed25519 signature produced by IKA to a Solana transaction,
 * broadcasts it to devnet, waits for confirmation, and fires a success toast.
 */
export async function broadcastSignedSolanaTx(
  connection: Connection,
  tx: SolanaTransaction,
  fromPubkey: PublicKey,
  rawSig: Uint8Array,
  onStatus?: (msg: string) => void,
) {
  if (rawSig.length !== 64) {
    throw new Error(
      `Expected 64-byte Ed25519 signature, got ${rawSig.length} bytes`,
    );
  }

  tx.addSignature(fromPubkey, Buffer.from(rawSig));
  const rawTx = tx.serialize();

  onStatus?.("Broadcasting to Solana devnet...");
  const txid = await connection.sendRawTransaction(rawTx, {
    skipPreflight: false,
    preflightCommitment: "confirmed",
  });

  onStatus?.("Waiting for confirmation...");
  const confirmation = await connection.confirmTransaction(txid, "confirmed");
  if (confirmation.value.err) {
    throw new Error(
      `Transaction failed: ${JSON.stringify(confirmation.value.err)}`,
    );
  }

  toast.success("SOL transfer confirmed", {
    description: txid,
    action: {
      label: "View on Explorer",
      onClick: () =>
        window.open(
          `https://explorer.solana.com/tx/${txid}?cluster=devnet`,
          "_blank",
        ),
    },
    duration: 10000,
  });

  return txid;
}
