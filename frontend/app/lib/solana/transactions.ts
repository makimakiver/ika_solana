import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction as SolanaTransaction,
  // TransactionInstruction,
} from "@solana/web3.js";

const MEMO_PROGRAM_ID = "";

// export async function buildUnsignedMemoTx(
//   connection: Connection,
//   from: PublicKey,
//   memoText: string,
// ) {
//   const tx = new SolanaTransaction().add(
//     new TransactionInstruction({
//       keys: [{ pubkey: from, isSigner: true, isWritable: true }],
//       programId: MEMO_PROGRAM_ID,
//       data: Buffer.from(memoText, "utf-8"),
//     }),
//   );
//   const { blockhash } = await connection.getLatestBlockhash("confirmed");
//   tx.recentBlockhash = blockhash;
//   tx.feePayer = from;
//   return { tx, messageBytes: tx.serializeMessage() };
// }

export async function buildUnsignedSOLTransfer(
  connection: Connection,
  from: PublicKey,
  to: PublicKey,
  lamports: number,
) {
  const tx = new SolanaTransaction().add(
    SystemProgram.transfer({ fromPubkey: from, toPubkey: to, lamports }),
  );
  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.feePayer = from;
  return { tx, messageBytes: tx.serializeMessage() };
}
