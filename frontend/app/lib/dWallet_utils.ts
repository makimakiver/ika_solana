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

function getLocalNetworkConfig(): IkaConfig {
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
