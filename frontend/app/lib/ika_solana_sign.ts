import {
  Hash,
  UserShareEncryptionKeys,
  SignatureAlgorithm,
  Curve,
  IkaClient,
  IkaTransaction,
  publicKeyFromDWalletOutput,
} from "@ika.xyz/sdk";
import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { Transaction } from "@mysten/sui/transactions";
import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction as SolanaTransaction,
  TransactionInstruction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import { retryWithBackoff } from "./utils";
import {
  createEmptyTestIkaToken,
  destroyEmptyTestIkaToken,
  getLocalNetworkConfig,
} from "./dWallet_utils";

function objectToUint8Array(obj: any): Uint8Array {
  if (obj instanceof Uint8Array) return obj;
  if (Array.isArray(obj)) return new Uint8Array(obj);
  const keys = Object.keys(obj)
    .map((k) => parseInt(k))
    .sort((a, b) => a - b);
  return new Uint8Array(keys.map((k) => obj[k]));
}

const MEMO_PROGRAM_ID = new PublicKey(
  "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
);

export async function buildUnsignedMemoTx(
  connection: Connection,
  from: PublicKey,
  memoText: string,
) {
  const tx = new SolanaTransaction().add(
    new TransactionInstruction({
      keys: [{ pubkey: from, isSigner: true, isWritable: true }],
      programId: MEMO_PROGRAM_ID,
      data: Buffer.from(memoText, "utf-8"),
    }),
  );
  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.feePayer = from;
  return { tx, messageBytes: tx.serializeMessage() };
}

async function ikaSignBytes(
  suiClient: SuiJsonRpcClient,
  ikaClient: IkaClient,
  rootSeedKey: Uint8Array,
  unsignedBytes: Uint8Array,
  executeTransaction: (tx: Transaction) => Promise<any>,
  signerAddress: string,
  dWalletObjectID: string,
  presignId: string,
) {
  const tx = new Transaction();

  const userShareKeys = await UserShareEncryptionKeys.fromRootSeedKey(
    rootSeedKey,
    Curve.ED25519,
  );

  // Fetch dWallet from network with retry
  console.log(`[Config] Fetching dWallet: ${dWalletObjectID}...`);
  const dWallet = await retryWithBackoff(async () => {
    return await ikaClient.getDWalletInParticularState(
      dWalletObjectID,
      "Active",
      { timeout: 120000, interval: 3000 },
    );
  });
  console.log(
    `[Config] dWallet fetched. State: ${dWallet.state?.$kind || "unknown"}`,
  );

  // Fetch presign from network (must be Completed) with retry
  console.log(`[Config] Fetching presign: ${presignId}...`);
  const presign = await retryWithBackoff(async () => {
    const p = await ikaClient.getPresignInParticularState(
      presignId,
      "Completed",
    );
    if (!p || p.state?.$kind !== "Completed") {
      throw new Error(`Presign ${presignId} is not in Completed state`);
    }
    return p;
  });
  console.log(`[Config] Presign fetched. State: ${presign.state?.$kind}`);

  // Get encrypted user secret key share from dWallet's ObjectTable
  const tableId = dWallet.encrypted_user_secret_key_shares?.id;
  let encryptedUserSecretKeyShare: any | undefined;
  let encryptedUserSecretKeyShareId: string | undefined;

  if (tableId) {
    console.log(`[Config] Fetching encrypted shares from table: ${tableId}...`);
    const dynamicFields = await retryWithBackoff(async () => {
      return await suiClient.core.listDynamicFields({ parentId: tableId });
    });
    console.log(dynamicFields);
    console.log(
      `[Config] Found ${dynamicFields.dynamicFields?.length || 0} dynamic field(s)`,
    );
    if (dynamicFields.dynamicFields && dynamicFields.dynamicFields.length > 0) {
      encryptedUserSecretKeyShareId = dynamicFields.dynamicFields[0]?.childId;
      if (encryptedUserSecretKeyShareId) {
        console.log(
          `[Config] Fetching encrypted share object: ${encryptedUserSecretKeyShareId}`,
        );
        encryptedUserSecretKeyShare = await retryWithBackoff(async () => {
          return await ikaClient.getEncryptedUserSecretKeyShare(
            encryptedUserSecretKeyShareId!,
          );
        });
        console.log(
          `[Config] Using encrypted user secret key share: ${encryptedUserSecretKeyShare}`,
        );
      }
    }
  }

  if (!encryptedUserSecretKeyShare) {
    throw new Error(
      "Could not find encrypted user secret key share in dWallet",
    );
  }

  // publicOutput comes from the dWallet's Active state, not the encrypted share
  if (!dWallet.state?.Active?.public_output) {
    throw new Error("dWallet is not in Active state or missing public_output");
  }
  const userPublicOutput =
    dWallet.state.Active.public_output instanceof Uint8Array
      ? dWallet.state.Active.public_output
      : objectToUint8Array(dWallet.state.Active.public_output);

  const ikaTx = new IkaTransaction({
    ikaClient,
    transaction: tx,
    userShareEncryptionKeys: userShareKeys,
  });

  const emptyIKACoin = createEmptyTestIkaToken(tx, getLocalNetworkConfig());
  // 1) User approves the message — Ed25519 / EdDSA for Solana
  const messageApproval = ikaTx.approveMessage({
    message: unsignedBytes,
    curve: Curve.ED25519,
    dWalletCap: dWallet.dwallet_cap_id,
    signatureAlgorithm: SignatureAlgorithm.EdDSA,
    hashScheme: Hash.SHA512,
  });

  // 2) Verify presign cap (presign must be Completed)
  const verifiedPresignCap = ikaTx.verifyPresignCap({ presign });

  // 3) Request the network signature
  console.log("[Debug] dWallet state:", dWallet.state?.$kind);
  console.log("[Debug] userPublicOutput length:", userPublicOutput.length);

  await ikaTx.requestSign({
    dWallet: dWallet,
    messageApproval,
    hashScheme: Hash.SHA512,
    verifiedPresignCap,
    presign,
    message: unsignedBytes,
    signatureScheme: SignatureAlgorithm.EdDSA,
    ikaCoin: emptyIKACoin,
    suiCoin: tx.gas,
    publicOutput: userPublicOutput,
    encryptedUserSecretKeyShare,
  });
  destroyEmptyTestIkaToken(tx, ikaClient.ikaConfig, emptyIKACoin);
  const txJSON = await tx.toJSON();
  console.log("txJSON:", txJSON);

  const result = await executeTransaction(tx);
  const waitResult = await suiClient.core.waitForTransaction({
    digest: result?.Transaction?.digest as string,
    include: {
      balanceChanges: true,
      effects: true,
      events: true,
      objectTypes: true,
      transaction: true,
    },
  });
  console.log("waitResult:", waitResult);
  console.log(
    "changedObjects:",
    waitResult.Transaction?.effects?.changedObjects,
  );
  console.log("objectTypes:", waitResult.Transaction?.objectTypes);

  // Find the SignSession created in this transaction
  const signEntry = waitResult.Transaction?.effects?.changedObjects?.find(
    (obj: any) =>
      obj.inputState === "DoesNotExist" &&
      waitResult.Transaction?.objectTypes?.[obj.objectId]?.includes(
        "SignSession",
      ),
  );
  console.log("signEntry:", signEntry);

  if (!signEntry) {
    console.warn("Could not find SignSession in transaction effects.");
    return {
      waitResult,
      signIdTransferredToYou: false,
      signObjectId: undefined,
    };
  }

  const signObjectId = signEntry.objectId;
  console.log(`[Config] Found sign object ID: ${signObjectId}`);
  return { waitResult, signIdTransferredToYou: true, signObjectId };
}

// TODO: implement — poll IKA until the signature is ready
/**
 * Poll Ika until the sign request is Completed, then return the raw Ed25519 signature.
 */
export async function fetchIkaSignature(
  ikaClient: IkaClient,
  signObjectId: string,
) {
  console.log("[Debug] Fetching sign object:", signObjectId);
  const sign = await ikaClient.getSignInParticularState(
    signObjectId,
    Curve.ED25519,
    SignatureAlgorithm.EdDSA,
    "Completed",
  );

  console.log("[Debug] Sign state:", sign.state?.$kind);
  console.log(
    "[Debug] Sign object full:",
    JSON.stringify(
      sign,
      (key, value) =>
        value instanceof Uint8Array
          ? `Uint8Array(${value.length}): ${Buffer.from(value).toString("hex").slice(0, 64)}...`
          : value,
      2,
    ),
  );

  const rawSignature = Uint8Array.from(sign.state.Completed.signature);
  console.log("[Debug] Raw signature length:", rawSignature.length);
  return rawSignature; // 64 bytes for Ed25519
}

/**
 * Attach an Ed25519 signature (from Ika) to a Solana transaction and broadcast it.
 *
 * @param connection - Solana RPC connection
 * @param tx         - The unsigned Transaction object (must have recentBlockhash + feePayer set)
 * @param fromPubkey - The public key that "signed" via Ika dWallet
 * @param rawSig     - 64-byte Ed25519 signature from Ika
 */
export async function broadcastSignedSolanaTx(
  connection: Connection,
  tx: SolanaTransaction,
  fromPubkey: PublicKey,
  rawSig: Uint8Array,
) {
  console.log("[Debug] rawSig length:", rawSig.length);
  console.log("[Debug] rawSig hex:", Buffer.from(rawSig).toString("hex"));

  if (rawSig.length !== 64) {
    throw new Error(
      `Expected 64-byte Ed25519 signature, got ${rawSig.length} bytes`,
    );
  }

  // Attach the signature to the transaction
  tx.addSignature(fromPubkey, Buffer.from(rawSig));

  // Serialize the fully-signed transaction
  const rawTx = tx.serialize();
  console.log("[Debug] rawTx length:", rawTx.length);

  // Send and confirm
  const txid = await connection.sendRawTransaction(rawTx, {
    skipPreflight: false,
    preflightCommitment: "confirmed",
  });

  console.log("Broadcast txid:", txid);
  console.log(
    `Explorer: https://explorer.solana.com/tx/${txid}?cluster=testnet`,
  );

  // Wait for confirmation
  const confirmation = await connection.confirmTransaction(txid, "confirmed");
  if (confirmation.value.err) {
    throw new Error(
      `Transaction failed: ${JSON.stringify(confirmation.value.err)}`,
    );
  }
  console.log("Transaction confirmed.");

  return txid;
}

interface WithdrawParams {
  ikaClient: IkaClient;
  suiClient: SuiJsonRpcClient;
  dWalletObjectID: string;
  connection: Connection;
  executeTransaction: (tx: Transaction) => Promise<any>;
  signerAddress: string;
  rootSeedKey: Uint8Array;
  presignId: string;
  destinationAddress: string;
  lamports: number;
}

export async function withdrawWithPresignCap({
  ikaClient,
  suiClient,
  dWalletObjectID,
  connection,
  executeTransaction,
  signerAddress,
  rootSeedKey,
  presignId,
  destinationAddress,
  lamports,
}: WithdrawParams) {
  console.log("\n=== Fetching dWallet from network ===");
  console.log("dWalletObjectID:", dWalletObjectID);

  const dWallet = await ikaClient.getDWalletInParticularState(
    dWalletObjectID,
    "Active",
    { timeout: 120000, interval: 3000 },
  );

  if (!dWallet.state?.Active?.public_output) {
    throw new Error("dWallet is not in Active state or missing public_output");
  }
  const dWalletPublicOutput =
    dWallet.state.Active.public_output instanceof Uint8Array
      ? dWallet.state.Active.public_output
      : new Uint8Array(dWallet.state.Active.public_output);

  const publicKey = await publicKeyFromDWalletOutput(
    Curve.ED25519,
    dWalletPublicOutput,
  );
  const solanaFromPubkey = new PublicKey(publicKey);
  console.log("Solana address (base58):", solanaFromPubkey.toBase58());

  const balance = await connection.getBalance(solanaFromPubkey);
  console.log("Balance:", balance / LAMPORTS_PER_SOL, "SOL");

  // Build unsigned SOL transfer to the given destination
  console.log("\n=== SOL Transfer via Ika ===");
  const recipient = new PublicKey(destinationAddress);
  const { tx, messageBytes } = await buildUnsignedSOLTransfer(
    connection,
    solanaFromPubkey,
    recipient,
    lamports,
  );

  const { signObjectId } = await ikaSignBytes(
    suiClient,
    ikaClient,
    rootSeedKey,
    messageBytes,
    executeTransaction,
    signerAddress,
    dWalletObjectID,
    presignId,
  );

  if (!signObjectId) {
    throw new Error("Sign object id not found in transaction results");
  }

  const rawSig = await fetchIkaSignature(ikaClient, signObjectId);
  const txid = await broadcastSignedSolanaTx(
    connection,
    tx,
    solanaFromPubkey,
    rawSig,
  );
  console.log("SOL Transfer txid:", txid);
  return txid;
}

export async function buildUnsignedSOLTransfer(
  connection: Connection,
  from: PublicKey,
  to: PublicKey,
  lamports: number,
) {
  const tx = new SolanaTransaction().add(
    SystemProgram.transfer({
      fromPubkey: from,
      toPubkey: to,
      lamports,
    }),
  );
  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.feePayer = from;
  return { tx, messageBytes: tx.serializeMessage() };
}
