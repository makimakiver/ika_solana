import {
  getNetworkConfig,
  IkaClient,
  IkaTransaction,
  UserShareEncryptionKeys,
  Curve,
  SignatureAlgorithm,
  SessionsManagerModule,
  CoordinatorInnerModule,
  type IkaConfig,
} from "@ika.xyz/sdk";
import {
  Transaction,
  type TransactionObjectArgument,
} from "@mysten/sui/transactions";
import { ClientWithCoreApi } from "@mysten/sui/client";
import { retryWithBackoff } from "./utils";
import { getLocalNetworkConfig } from "./dWallet_utils";

function createEmptyTestIkaToken(tx: Transaction, ikaConfig: IkaConfig) {
  return tx.moveCall({
    target: `0x2::coin::zero`,
    arguments: [],
    typeArguments: [`${ikaConfig.packages.ikaPackage}::ika::IKA`],
  });
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

export interface CreatePresignParams {
  senderAddress: string;
  suiClient: ClientWithCoreApi;
  signAndExecuteTransaction: (args: {
    transaction: Transaction;
  }) => Promise<unknown>;
  dWalletObjectID: string;
  rootSeedKey: Uint8Array;
  onStatus?: (msg: string) => void;
}

export interface PresignResult {
  transactionDigest: string;
  presignId: string;
  presignCapId: string;
  dWalletObjectID: string;
}

export async function createPresign({
  senderAddress,
  suiClient,
  signAndExecuteTransaction,
  dWalletObjectID,
  rootSeedKey,
  onStatus,
}: CreatePresignParams): Promise<PresignResult> {
  const status = onStatus ?? (() => {});

  status("Initializing IKA client...");
  const ikaClient = new IkaClient({
    suiClient: suiClient,
    config: getLocalNetworkConfig(),
  });
  await ikaClient.initialize();

  const ikaConfig = getLocalNetworkConfig();
  const tx = new Transaction();
  const userShareKeys = await UserShareEncryptionKeys.fromRootSeedKey(
    rootSeedKey,
    Curve.SECP256K1,
  );
  const ikaTx = new IkaTransaction({
    ikaClient,
    transaction: tx,
    userShareEncryptionKeys: userShareKeys,
  });

  status("Fetching network encryption key...");
  const dWalletEncryptionKey = await retryWithBackoff(
    () => ikaClient.getLatestNetworkEncryptionKey(),
    5,
    status,
  );

  const emptyIKACoin = createEmptyTestIkaToken(tx, ikaConfig);

  status("Requesting presign...");
  const unverifiedPresignCap = ikaTx.requestGlobalPresign({
    curve: Curve.ED25519,
    signatureAlgorithm: SignatureAlgorithm.EdDSA,
    ikaCoin: emptyIKACoin,
    suiCoin: tx.gas,
    dwalletNetworkEncryptionKeyId: dWalletEncryptionKey.id,
  });
  tx.transferObjects(
    [unverifiedPresignCap as TransactionObjectArgument],
    senderAddress,
  );
  destroyEmptyTestIkaToken(tx, ikaConfig, emptyIKACoin);
  tx.setSender(senderAddress);

  status("Submitting presign transaction...");
  const result = await signAndExecuteTransaction({ transaction: tx });
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

  status("Extracting presign ID from events...");
  const presignEvent = waitResult.Transaction?.events?.find((e: any) =>
    e.eventType.includes("PresignRequestEvent"),
  );
  if (!presignEvent) {
    throw new Error("PresignRequestEvent not found in transaction events");
  }

  const parsedPresignEvent = SessionsManagerModule.DWalletSessionEvent(
    CoordinatorInnerModule.PresignRequestEvent,
  ).parse(presignEvent.bcs);
  console.log(parsedPresignEvent);
  const presignId = parsedPresignEvent.event_data.presign_id;

  status("Waiting for presign to complete on the network...");
  const completedPresign = await ikaClient.getPresignInParticularState(
    presignId,
    "Completed",
    { timeout: 180000, interval: 3000 },
  );

  status("Presign completed!");
  return {
    transactionDigest: result?.Transaction?.digest ?? "",
    presignId,
    presignCapId: completedPresign.cap_id,
    dWalletObjectID,
  };
}
