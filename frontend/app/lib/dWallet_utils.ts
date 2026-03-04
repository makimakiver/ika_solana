import {
  IkaClient,
  IkaTransaction,
  UserShareEncryptionKeys,
  createRandomSessionIdentifier,
  Curve,
  prepareDKGAsync,
} from "@ika.xyz/sdk";
import {
  Transaction,
  type TransactionObjectArgument,
} from "@mysten/sui/transactions";
import { type ClientWithCoreApi } from "@mysten/dapp-kit-react";
import { getFaucetHost, requestSuiFromFaucetV2 } from "@mysten/sui/faucet";
import { retryWithBackoff } from "./utils";
import { getLocalNetworkConfig } from "./config";
import { createEmptyTestIkaToken, destroyEmptyTestIkaToken } from "./localnet";
import { deriveRootSeedKeyFromPassword } from "./crypto";

export { getLocalNetworkConfig } from "./config";
export { deriveRootSeedKeyFromPassword } from "./crypto";

export interface CreateDwalletOnSolanaParams {
  senderAddress: string;
  suiClient: ClientWithCoreApi;
  signAndExecuteTransaction: (args: {
    transaction: Transaction;
  }) => Promise<unknown>;
  password: string;
  onStatus?: (message: string) => void;
}

export interface CreateDwalletResult {
  dwalletCapId: string;
  encryptionKeyId: string;
  sessionId: Uint8Array;
  transactionDigest: string;
}

export interface DepositResult {
  transactionDigest: string;
  signId?: string;
  presignCapId?: string;
  futureSignCapId?: string;
}

export async function createdWallet({
  senderAddress,
  suiClient,
  signAndExecuteTransaction,
  password,
  onStatus,
}: CreateDwalletOnSolanaParams): Promise<CreateDwalletResult> {
  const status = onStatus ?? (() => {});

  const ikaClient = new IkaClient({
    suiClient,
    config: getLocalNetworkConfig(),
  });

  const rootSeedKey = deriveRootSeedKeyFromPassword(password);
  const userShareKeys = await UserShareEncryptionKeys.fromRootSeedKey(
    rootSeedKey,
    Curve.ED25519,
  );

  status("Initializing IKA client...");
  await retryWithBackoff(
    async () => {
      await ikaClient.initialize();
    },
    5,
    status,
  );

  const tx = new Transaction();
  const ikaTx = new IkaTransaction({
    ikaClient,
    transaction: tx,
    userShareEncryptionKeys: userShareKeys,
  });

  status("Fetching user coins...");
  await requestSuiFromFaucetV2({
    host: getFaucetHost("localnet"),
    recipient: senderAddress,
  });

  const sessionId = createRandomSessionIdentifier();

  status("Registering encryption key...");
  await ikaTx.registerEncryptionKey({ curve: Curve.ED25519 });

  status("Fetching network encryption key...");
  const dWalletEncryptionKey = await retryWithBackoff(
    async () => await ikaClient.getLatestNetworkEncryptionKey(),
    5,
    status,
  );

  status("Preparing DKG...");
  const dkgRequestInput = await retryWithBackoff(
    async () =>
      await prepareDKGAsync(
        ikaClient,
        Curve.ED25519,
        userShareKeys,
        sessionId,
        senderAddress,
      ),
    5,
    status,
  );

  const emptyIKACoin = createEmptyTestIkaToken(tx, getLocalNetworkConfig());

  status("Requesting dWallet DKG...");
  const [dwalletCap] = await ikaTx.requestDWalletDKG({
    dkgRequestInput,
    sessionIdentifier: ikaTx.registerSessionIdentifier(sessionId),
    dwalletNetworkEncryptionKeyId: dWalletEncryptionKey.id,
    curve: Curve.ED25519,
    ikaCoin: emptyIKACoin,
    suiCoin: tx.gas,
  });

  tx.transferObjects([dwalletCap as TransactionObjectArgument], senderAddress);
  destroyEmptyTestIkaToken(tx, ikaClient.ikaConfig, emptyIKACoin);

  status("Submitting transaction...");
  const result = await signAndExecuteTransaction({ transaction: tx });
  const waitForTransactionResult = await suiClient.core.waitForTransaction({
    digest: result?.Transaction?.digest as string,
    include: {
      balanceChanges: true,
      effects: true,
      events: true,
      objectTypes: true,
      transaction: true,
    },
  });

  const createdCapEntry =
    waitForTransactionResult.Transaction?.effects?.changedObjects?.find(
      (obj: any) =>
        obj.inputState === "DoesNotExist" &&
        waitForTransactionResult.Transaction?.objectTypes?.[
          obj.objectId
        ]?.includes("DWalletCap"),
    );
  if (!createdCapEntry)
    throw new Error("DWalletCap not found in transaction effects");

  const newCapObj = await suiClient.core.getObject({
    objectId: createdCapEntry.objectId,
    include: { json: true },
  });
  const dWalletId = newCapObj.object?.json?.dwallet_id as string;
  if (!dWalletId) throw new Error("dwallet_id not found on new DWalletCap");
  const dWalletCapId = createdCapEntry.objectId;

  status("Waiting for dWallet to be ready for activation...");
  const dWalletReady = await ikaClient.getDWalletInParticularState(
    dWalletId,
    "AwaitingKeyHolderSignature",
    { timeout: 300000, interval: 5000 },
  );

  status("Preparing activation transaction...");
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

  status("Submitting activation transaction...");
  const activationResult = await signAndExecuteTransaction({
    transaction: activationTx,
  });

  status("Waiting for dWallet to become Active...");
  await ikaClient.getDWalletInParticularState(dWalletId, "Active", {
    timeout: 120000,
    interval: 3000,
  });

  status("dWallet is now Active!");
  return {
    dwalletCapId: dWalletCapId,
    encryptionKeyId: dWalletEncryptionKey.id,
    sessionId,
    transactionDigest: (activationResult as any)?.Transaction?.digest ?? "",
  };
}
