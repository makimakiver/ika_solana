import {
  Transaction,
  TransactionObjectArgument,
} from "@mysten/sui/transactions";
import {
  IkaClient,
  IkaTransaction,
  UserShareEncryptionKeys,
  createRandomSessionIdentifier,
  Curve,
  prepareDKGAsync,
  SignatureAlgorithm,
  Hash,
  type IkaConfig,
} from "@ika.xyz/sdk";
import { retryWithBackoff } from "./utils";
import { ClientWithCoreApi } from "@mysten/dapp-kit-react";
import ikaConfigJson from "../../ika_config.json";
import { getFaucetHost, requestSuiFromFaucetV2 } from "@mysten/sui/faucet";

export interface CreateDwalletOnSolanaParams {
  senderAddress: string;
  suiClient: ClientWithCoreApi;
  signAndExecuteTransaction: (args: {
    transaction: Transaction;
  }) => Promise<unknown>;
  onStatus?: (message: string) => void;
}

export interface CreateDwalletResult {
  dwalletCapId: string;
  encryptionKeyId: string;
  sessionId: Uint8Array;
  transactionDigest: string;
}

// Helper function to convert object with numeric keys to Uint8Array
function objectToUint8Array(obj: any): Uint8Array {
  if (obj instanceof Uint8Array) return obj;
  if (Array.isArray(obj)) return new Uint8Array(obj);
  const keys = Object.keys(obj)
    .map((k) => parseInt(k))
    .sort((a, b) => a - b);
  return new Uint8Array(keys.map((k) => obj[k]));
}

export function getLocalNetworkConfig(): IkaConfig {
  return {
    packages: {
      ikaPackage: ikaConfigJson.packages.ika_package_id,
      ikaCommonPackage: ikaConfigJson.packages.ika_common_package_id,
      ikaSystemOriginalPackage: ikaConfigJson.packages.ika_system_package_id,
      ikaSystemPackage: ikaConfigJson.packages.ika_system_package_id,
      ikaDwallet2pcMpcOriginalPackage:
        ikaConfigJson.packages.ika_dwallet_2pc_mpc_package_id,
      ikaDwallet2pcMpcPackage:
        ikaConfigJson.packages.ika_dwallet_2pc_mpc_package_id,
    },
    objects: {
      ikaSystemObject: {
        objectID: ikaConfigJson.objects.ika_system_object_id,
        initialSharedVersion: 0,
      },
      ikaDWalletCoordinator: {
        objectID: ikaConfigJson.objects.ika_dwallet_coordinator_object_id,
        initialSharedVersion: 0,
      },
    },
  };
}

function destroyEmptyTestIkaToken(
  tx: Transaction,
  ikaConfig: IkaConfig,
  ikaToken: TransactionObjectArgument,
) {
  return tx.moveCall({
    target: `0x2::coin::destroy_zero`,
    arguments: [ikaToken],
    typeArguments: [`${ikaConfig.packages.ikaPackage}::ika::IKA`],
  });
}

function createEmptyTestIkaToken(tx: Transaction, ikaConfig: IkaConfig) {
  return tx.moveCall({
    target: `0x2::coin::zero`,
    arguments: [],
    typeArguments: [`${ikaConfig.packages.ikaPackage}::ika::IKA`],
  });
}

/**
 *
 * @param sender_addr
 * @param suiClient
 * @param signAndExecuteTransaction
 * @param
 * @returns
 */
export async function createdWallet({
  senderAddress,
  suiClient,
  signAndExecuteTransaction,
  onStatus,
}: CreateDwalletOnSolanaParams): Promise<CreateDwalletResult> {
  const status = onStatus ?? (() => {});

  const ikaClient = new IkaClient({
    suiClient,
    config: getLocalNetworkConfig(),
  });

  const rootSeedKey = new Uint8Array(32);
  crypto.getRandomValues(rootSeedKey);
  const userShareKeys = await UserShareEncryptionKeys.fromRootSeedKey(
    rootSeedKey,
    Curve.ED25519, //Solana supports ED25519 Curve so will choose ED25519 by default
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
  await ikaTx.registerEncryptionKey({
    curve: Curve.ED25519,
  });

  status("Fetching network encryption key...");
  const dWalletEncryptionKey = await retryWithBackoff(
    async () => {
      return await ikaClient.getLatestNetworkEncryptionKey();
    },
    5,
    status,
  );

  status("Preparing DKG...");
  const dkgRequestInput = await retryWithBackoff(
    async () => {
      return await prepareDKGAsync(
        ikaClient,
        Curve.ED25519,
        userShareKeys,
        sessionId,
        senderAddress,
      );
    },
    5,
    status,
  );
  const emptyIKACoin = createEmptyTestIkaToken(tx, getLocalNetworkConfig());
  console.log(dkgRequestInput.userPublicOutput);
  status("Requesting dWallet DKG...");
  const [dwalletCap, _sign_ID] = await ikaTx.requestDWalletDKG({
    dkgRequestInput: dkgRequestInput,
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
  console.log("HELLO:", waitForTransactionResult);
  // Find the DWalletCap created specifically in this transaction
  const createdCapEntry =
    waitForTransactionResult.Transaction?.effects?.changedObjects?.find(
      (obj: any) =>
        obj.inputState === "DoesNotExist" &&
        waitForTransactionResult.Transaction?.objectTypes?.[
          obj.objectId
        ]?.includes("DWalletCap"),
    );
  console.log(
    "changedObjects:",
    waitForTransactionResult.Transaction?.effects?.changedObjects,
  );
  console.log(
    "objectTypes:",
    waitForTransactionResult.Transaction?.objectTypes,
  );
  console.log("createdCapEntry:", createdCapEntry);
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
  console.log(dWalletReady);
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
    userPublicOutput: objectToUint8Array(dkgRequestInput.userPublicOutput),
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

// ─── Deposit helpers ──────────────────────────────────────────────────────────

export interface DepositOnSolanaParams {
  senderAddress: string;
  suiClient: ClientWithCoreApi;
  signAndExecuteTransaction: (args: {
    transaction: Transaction;
  }) => Promise<unknown>;
  dWalletCapId: string;
  dWalletId: string;
  /** Raw bytes of the Solana transaction to sign */
  message: Uint8Array;
  onStatus?: (msg: string) => void;
}

export interface DepositResult {
  transactionDigest: string;
  /** Set for directSign mode — the on-chain sign session ID */
  signId?: string;
  /** Set for presign mode — the unverified presign cap ID to use later */
  presignCapId?: string;
  /** Set for futureSign mode — the partial user signature cap ID to complete later */
  futureSignCapId?: string;
}

async function initIkaClient(suiClient: ClientWithCoreApi): Promise<IkaClient> {
  const ikaClient = new IkaClient({
    suiClient,
    config: getLocalNetworkConfig(),
  });
  await ikaClient.initialize();
  return ikaClient;
}

async function fetchEncryptedShareId(
  suiClient: ClientWithCoreApi,
  dWallet: any,
): Promise<string> {
  const tableId = dWallet.encrypted_user_secret_key_shares?.id;
  if (!tableId) throw new Error("encrypted_user_secret_key_shares table not found");
  const { dynamicFields } = await suiClient.core.listDynamicFields({
    parentId: tableId,
  });
  const shareId = dynamicFields[0]?.childId;
  if (!shareId) throw new Error("Encrypted user secret key share not found");
  return shareId;
}

function findCreatedObjectByType(waitResult: any, typeFragment: string): string | undefined {
  return waitResult.Transaction?.effects?.changedObjects?.find(
    (obj: any) =>
      obj.inputState === "DoesNotExist" &&
      waitResult.Transaction?.objectTypes?.[obj.objectId]?.includes(typeFragment),
  )?.objectId;
}

/**
 * Presign mode — submits only the presign request and returns the presign cap ID.
 * The actual signing can be completed later using the returned presignCapId.
 */
export async function depositWithPresign({
  senderAddress,
  suiClient,
  signAndExecuteTransaction,
  dWalletId,
  message,
  onStatus,
}: DepositOnSolanaParams): Promise<DepositResult> {
  const status = onStatus ?? (() => {});
  const ikaConfig = getLocalNetworkConfig();

  status("Initializing IKA client...");
  const ikaClient = await initIkaClient(suiClient);

  status("Fetching network encryption key...");
  const networkEncKey = await ikaClient.getLatestNetworkEncryptionKey();

  status("Requesting presign...");
  const tx = new Transaction();
  const ikaTx = new IkaTransaction({ ikaClient, transaction: tx });
  const emptyIKACoin = createEmptyTestIkaToken(tx, ikaConfig);

  const unverifiedPresignCap = ikaTx.requestGlobalPresign({
    dwalletNetworkEncryptionKeyId: networkEncKey.id,
    curve: Curve.ED25519,
    signatureAlgorithm: SignatureAlgorithm.EdDSA,
    ikaCoin: emptyIKACoin,
    suiCoin: tx.gas,
  });
  tx.transferObjects([unverifiedPresignCap as TransactionObjectArgument], senderAddress);
  destroyEmptyTestIkaToken(tx, ikaConfig, emptyIKACoin);

  status("Submitting presign transaction...");
  const result = await signAndExecuteTransaction({ transaction: tx });
  const waitResult = await suiClient.core.waitForTransaction({
    digest: (result as any)?.Transaction?.digest as string,
    include: { effects: true, objectTypes: true },
  });

  const presignCapId = findCreatedObjectByType(waitResult, "DWalletSession");
  if (!presignCapId) throw new Error("Presign cap not found in transaction effects");

  status(`Presign submitted. Cap ID: ${presignCapId}`);
  return {
    transactionDigest: (result as any)?.Transaction?.digest ?? "",
    presignCapId,
  };
}

/**
 * Direct sign mode — requests presign, waits for network completion, then signs immediately.
 * Returns the sign session ID.
 */
export async function depositWithDirectSign({
  senderAddress,
  suiClient,
  signAndExecuteTransaction,
  dWalletCapId,
  dWalletId,
  message,
  onStatus,
}: DepositOnSolanaParams): Promise<DepositResult> {
  const status = onStatus ?? (() => {});
  const ikaConfig = getLocalNetworkConfig();

  status("Initializing IKA client...");
  const ikaClient = await initIkaClient(suiClient);

  status("Fetching dWallet...");
  const dWallet = await ikaClient.getDWallet(dWalletId);

  status("Fetching network encryption key...");
  const networkEncKey = await ikaClient.getLatestNetworkEncryptionKey();

  // TX 1: Request global presign
  status("Requesting presign...");
  const presignTx = new Transaction();
  const presignIkaTx = new IkaTransaction({ ikaClient, transaction: presignTx });
  const presignCoin = createEmptyTestIkaToken(presignTx, ikaConfig);

  const unverifiedPresignCap = presignIkaTx.requestGlobalPresign({
    dwalletNetworkEncryptionKeyId: networkEncKey.id,
    curve: Curve.ED25519,
    signatureAlgorithm: SignatureAlgorithm.EdDSA,
    ikaCoin: presignCoin,
    suiCoin: presignTx.gas,
  });
  presignTx.transferObjects(
    [unverifiedPresignCap as TransactionObjectArgument],
    senderAddress,
  );
  destroyEmptyTestIkaToken(presignTx, ikaConfig, presignCoin);

  status("Submitting presign transaction...");
  const presignResult = await signAndExecuteTransaction({ transaction: presignTx });
  const presignWaitResult = await suiClient.core.waitForTransaction({
    digest: (presignResult as any)?.Transaction?.digest as string,
    include: { effects: true, objectTypes: true },
  });

  const presignCapId = findCreatedObjectByType(presignWaitResult, "DWalletSession");
  if (!presignCapId) throw new Error("Presign cap not found in transaction effects");

  status("Waiting for presign to complete...");
  const presign = await ikaClient.getPresignInParticularState(presignCapId, "Completed", {
    timeout: 120000,
    interval: 3000,
  });

  status("Fetching encrypted user share...");
  const encryptedShareId = await fetchEncryptedShareId(suiClient, dWallet);
  const encryptedUserSecretKeyShare =
    await ikaClient.getEncryptedUserSecretKeyShare(encryptedShareId);

  // TX 2: Approve message + verify presign cap + sign
  status("Signing message...");
  const signTx = new Transaction();
  const signIkaTx = new IkaTransaction({ ikaClient, transaction: signTx });
  const signCoin = createEmptyTestIkaToken(signTx, ikaConfig);

  const messageApproval = signIkaTx.approveMessage({
    dWalletCap: dWalletCapId,
    curve: Curve.ED25519,
    signatureAlgorithm: SignatureAlgorithm.EdDSA,
    hashScheme: Hash.SHA512,
    message,
  });
  const verifiedPresignCap = signIkaTx.verifyPresignCap({ presign });

  await signIkaTx.requestSign({
    dWallet: dWallet as any,
    messageApproval,
    hashScheme: Hash.SHA512,
    verifiedPresignCap,
    presign,
    encryptedUserSecretKeyShare,
    message,
    signatureScheme: SignatureAlgorithm.EdDSA,
    ikaCoin: signCoin,
    suiCoin: signTx.gas,
  });
  destroyEmptyTestIkaToken(signTx, ikaConfig, signCoin);

  status("Submitting sign transaction...");
  const signResult = await signAndExecuteTransaction({ transaction: signTx });
  const signWaitResult = await suiClient.core.waitForTransaction({
    digest: (signResult as any)?.Transaction?.digest as string,
    include: { effects: true, objectTypes: true },
  });

  const signId = findCreatedObjectByType(signWaitResult, "Sign");
  status("Deposit signed successfully!");
  return {
    transactionDigest: (signResult as any)?.Transaction?.digest ?? "",
    signId,
  };
}

/**
 * Future sign mode — creates a partial signature commitment that can be finalized later.
 * Returns the partial user signature cap ID.
 */
export async function depositWithFutureSign({
  senderAddress,
  suiClient,
  signAndExecuteTransaction,
  dWalletCapId,
  dWalletId,
  message,
  onStatus,
}: DepositOnSolanaParams): Promise<DepositResult> {
  const status = onStatus ?? (() => {});
  const ikaConfig = getLocalNetworkConfig();

  status("Initializing IKA client...");
  const ikaClient = await initIkaClient(suiClient);

  status("Fetching dWallet...");
  const dWallet = await ikaClient.getDWallet(dWalletId);

  status("Fetching network encryption key...");
  const networkEncKey = await ikaClient.getLatestNetworkEncryptionKey();

  // TX 1: Request global presign
  status("Requesting presign...");
  const presignTx = new Transaction();
  const presignIkaTx = new IkaTransaction({ ikaClient, transaction: presignTx });
  const presignCoin = createEmptyTestIkaToken(presignTx, ikaConfig);

  const unverifiedPresignCap = presignIkaTx.requestGlobalPresign({
    dwalletNetworkEncryptionKeyId: networkEncKey.id,
    curve: Curve.ED25519,
    signatureAlgorithm: SignatureAlgorithm.EdDSA,
    ikaCoin: presignCoin,
    suiCoin: presignTx.gas,
  });
  presignTx.transferObjects(
    [unverifiedPresignCap as TransactionObjectArgument],
    senderAddress,
  );
  destroyEmptyTestIkaToken(presignTx, ikaConfig, presignCoin);

  status("Submitting presign transaction...");
  const presignResult = await signAndExecuteTransaction({ transaction: presignTx });
  const presignWaitResult = await suiClient.core.waitForTransaction({
    digest: (presignResult as any)?.Transaction?.digest as string,
    include: { effects: true, objectTypes: true },
  });

  const presignCapId = findCreatedObjectByType(presignWaitResult, "DWalletSession");
  if (!presignCapId) throw new Error("Presign cap not found in transaction effects");

  status("Waiting for presign to complete...");
  const presign = await ikaClient.getPresignInParticularState(presignCapId, "Completed", {
    timeout: 120000,
    interval: 3000,
  });

  status("Fetching encrypted user share...");
  const encryptedShareId = await fetchEncryptedShareId(suiClient, dWallet);
  const encryptedUserSecretKeyShare =
    await ikaClient.getEncryptedUserSecretKeyShare(encryptedShareId);

  // TX 2: Verify presign cap + create future sign commitment
  status("Creating future sign commitment...");
  const futureTx = new Transaction();
  const futureIkaTx = new IkaTransaction({ ikaClient, transaction: futureTx });
  const futureCoin = createEmptyTestIkaToken(futureTx, ikaConfig);

  const verifiedPresignCap = futureIkaTx.verifyPresignCap({ presign });

  const partialSigCap = await futureIkaTx.requestFutureSign({
    dWallet: dWallet as any,
    verifiedPresignCap,
    presign,
    encryptedUserSecretKeyShare,
    message,
    hashScheme: Hash.SHA512,
    signatureScheme: SignatureAlgorithm.EdDSA,
    ikaCoin: futureCoin,
    suiCoin: futureTx.gas,
  });
  futureTx.transferObjects([partialSigCap as TransactionObjectArgument], senderAddress);
  destroyEmptyTestIkaToken(futureTx, ikaConfig, futureCoin);

  status("Submitting future sign transaction...");
  const futureResult = await signAndExecuteTransaction({ transaction: futureTx });
  const futureWaitResult = await suiClient.core.waitForTransaction({
    digest: (futureResult as any)?.Transaction?.digest as string,
    include: { effects: true, objectTypes: true },
  });

  const futureSignCapId = findCreatedObjectByType(futureWaitResult, "PartialUserSignature");
  status("Future sign commitment created!");
  return {
    transactionDigest: (futureResult as any)?.Transaction?.digest ?? "",
    futureSignCapId,
  };
}
