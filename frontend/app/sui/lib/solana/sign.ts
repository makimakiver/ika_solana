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
import { Connection, PublicKey } from "@solana/web3.js";
import { toast } from "sonner";
import { retryWithBackoff } from "../utils";
import { getLocalNetworkConfig } from "../config";
import { createEmptyTestIkaToken, destroyEmptyTestIkaToken } from "../localnet";
import { buildUnsignedSOLTransfer } from "./transactions";
import { broadcastSignedSolanaTx } from "./broadcast";

async function ikaSignBytes(
  suiClient: SuiJsonRpcClient,
  ikaClient: IkaClient,
  rootSeedKey: Uint8Array,
  unsignedBytes: Uint8Array,
  executeTransaction: (tx: Transaction) => Promise<any>,
  signerAddress: string,
  dWalletObjectID: string,
  presignId: string,
  onStatus?: (msg: string) => void,
) {
  const tx = new Transaction();
  const userShareKeys = await UserShareEncryptionKeys.fromRootSeedKey(
    rootSeedKey,
    Curve.ED25519,
  );

  onStatus?.("Fetching dWallet...");
  const dWallet = await retryWithBackoff(async () => {
    return await ikaClient.getDWalletInParticularState(
      dWalletObjectID,
      "Active",
      { timeout: 120000, interval: 3000 },
    );
  });

  onStatus?.("Fetching presign...");
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

  onStatus?.("Fetching encrypted key shares...");
  const tableId = dWallet.encrypted_user_secret_key_shares?.id;
  let encryptedUserSecretKeyShare: any | undefined;
  let encryptedUserSecretKeyShareId: string | undefined;

  if (tableId) {
    const dynamicFields = await retryWithBackoff(async () => {
      return await suiClient.core.listDynamicFields({ parentId: tableId });
    });
    if (dynamicFields.dynamicFields && dynamicFields.dynamicFields.length > 0) {
      encryptedUserSecretKeyShareId = dynamicFields.dynamicFields[0]?.childId;
      if (encryptedUserSecretKeyShareId) {
        encryptedUserSecretKeyShare = await retryWithBackoff(async () => {
          return await ikaClient.getEncryptedUserSecretKeyShare(
            encryptedUserSecretKeyShareId!,
          );
        });
      }
    }
  }

  if (!encryptedUserSecretKeyShare) {
    throw new Error(
      "Could not find encrypted user secret key share in dWallet",
    );
  }

  if (!dWallet.state?.Active?.public_output) {
    throw new Error("dWallet is not in Active state or missing public_output");
  }
  const userPublicOutput =
    dWallet.state.Active.public_output instanceof Uint8Array
      ? dWallet.state.Active.public_output
      : dWallet.state.Active.public_output;

  const ikaTx = new IkaTransaction({
    ikaClient,
    transaction: tx,
    userShareEncryptionKeys: userShareKeys,
  });

  const emptyIKACoin = createEmptyTestIkaToken(tx, getLocalNetworkConfig());

  const messageApproval = ikaTx.approveMessage({
    message: unsignedBytes,
    curve: Curve.ED25519,
    dWalletCap: dWallet.dwallet_cap_id,
    signatureAlgorithm: SignatureAlgorithm.EdDSA,
    hashScheme: Hash.SHA512,
  });

  const verifiedPresignCap = ikaTx.verifyPresignCap({ presign });

  onStatus?.("Submitting sign request to IKA...");
  await ikaTx.requestSign({
    dWallet,
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

  onStatus?.("Executing sign transaction...");
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

  const signEntry = waitResult.Transaction?.effects?.changedObjects?.find(
    (obj: any) =>
      obj.inputState === "DoesNotExist" &&
      waitResult.Transaction?.objectTypes?.[obj.objectId]?.includes(
        "SignSession",
      ),
  );

  if (!signEntry) {
    toast.warning("Sign session not found in transaction effects.");
    return {
      waitResult,
      signIdTransferredToYou: false,
      signObjectId: undefined,
    };
  }

  toast.success("Sign request submitted");
  return {
    waitResult,
    signIdTransferredToYou: true,
    signObjectId: signEntry.objectId,
  };
}

export async function fetchIkaSignature(
  ikaClient: IkaClient,
  signObjectId: string,
  onStatus?: (msg: string) => void,
) {
  onStatus?.("Waiting for IKA network signature...");
  const sign = await ikaClient.getSignInParticularState(
    signObjectId,
    Curve.ED25519,
    SignatureAlgorithm.EdDSA,
    "Completed",
  );
  const rawSignature = Uint8Array.from(sign.state.Completed.signature);
  toast.success("Signature ready");
  return rawSignature;
}

export interface WithdrawParams {
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
  onStatus?: (msg: string) => void;
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
  onStatus,
}: WithdrawParams) {
  onStatus?.("Fetching dWallet...");
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

  await connection.getBalance(solanaFromPubkey);

  onStatus?.("Building Solana transfer transaction...");
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
    onStatus,
  );

  if (!signObjectId) {
    throw new Error("Sign object id not found in transaction results");
  }

  const rawSig = await fetchIkaSignature(ikaClient, signObjectId, onStatus);
  return await broadcastSignedSolanaTx(
    connection,
    tx,
    solanaFromPubkey,
    rawSig,
    onStatus,
  );
}
