import {
  Transaction,
  TransactionObjectArgument,
} from "@mysten/sui/transactions";
import {
  getNetworkConfig,
  IkaClient,
  IkaTransaction,
  UserShareEncryptionKeys,
  createRandomSessionIdentifier,
  Curve,
  prepareDKGAsync,
} from "@ika.xyz/sdk";
import { retryWithBackoff } from "./utils";
import { ClientWithCoreApi } from "@mysten/dapp-kit-react";

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
  const testnetIkaCoinType =
    "0x0000000000000000000000000000000000000000000000000000000000000002::coin::Coin<0x1f26bb2f711ff82dcda4d02c77d5123089cb7f8418751474b9fb744ce031526a::ika::IKA>";
  const testnetSuiCoinType =
    "0x0000000000000000000000000000000000000000000000000000000000000002::coin::Coin<0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI>";
  // Note: Type assertion needed due to @ika.xyz/sdk using @mysten/sui v1.x internally
  const ikaClient = new IkaClient({
    suiClient,
    config: getNetworkConfig("testnet"), // mainnet / testnet
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
  const rawUserCoins = await suiClient.core.listOwnedObjects({
    owner: senderAddress,
    type: "0x2::coin::Coin",
  });
  console.log(rawUserCoins);
  const rawUserIkaCoins = rawUserCoins.objects.filter(
    (coin) => coin.type === testnetIkaCoinType,
  );
  const rawUserSuiCoins = rawUserCoins.objects.filter(
    (coin) => coin.type === testnetSuiCoinType,
  );

  if (!rawUserIkaCoins[0] || !rawUserSuiCoins[1]) {
    throw new Error("Missing required coins");
  }
  const userIkaCoin = tx.object(rawUserIkaCoins[0].objectId);
  const userSuiCoin = tx.object(rawUserSuiCoins[1].objectId);

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

  status("Requesting dWallet DKG...");
  const [dwalletCap, _sign_ID] = await ikaTx.requestDWalletDKG({
    dkgRequestInput: dkgRequestInput,
    sessionIdentifier: ikaTx.registerSessionIdentifier(sessionId),
    dwalletNetworkEncryptionKeyId: dWalletEncryptionKey.id,
    curve: Curve.ED25519,
    ikaCoin: userIkaCoin,
    suiCoin: userSuiCoin,
  });

  tx.transferObjects([dwalletCap as TransactionObjectArgument], senderAddress);

  status("Submitting transaction...");
  const result = await signAndExecuteTransaction({ transaction: tx });
  const digest = (result as { digest?: string })?.digest ?? "";

  return {
    dwalletCapId: (dwalletCap as TransactionObjectArgument).toString(),
    encryptionKeyId: dWalletEncryptionKey.id,
    sessionId,
    transactionDigest: digest,
  };
}

export async function activateDwallet({
  senderAddress,
  suiClient,
  signAndExecuteTransaction,
  onStatus,
}: CreateDwalletOnSolanaParams): Promise<CreateDwalletResult> {
  const status = onStatus ?? (() => {});
  const testnetIkaCoinType =
    "0x0000000000000000000000000000000000000000000000000000000000000002::coin::Coin<0x1f26bb2f711ff82dcda4d02c77d5123089cb7f8418751474b9fb744ce031526a::ika::IKA>";
  const testnetSuiCoinType =
    "0x0000000000000000000000000000000000000000000000000000000000000002::coin::Coin<0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI>";
  // Note: Type assertion needed due to @ika.xyz/sdk using @mysten/sui v1.x internally
  const ikaClient = new IkaClient({
    suiClient,
    config: getNetworkConfig("testnet"), // mainnet / testnet
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
  const rawUserCoins = await suiClient.core.listOwnedObjects({
    owner: senderAddress,
    type: "0x2::coin::Coin",
  });
  console.log(rawUserCoins);
  const rawUserIkaCoins = rawUserCoins.objects.filter(
    (coin) => coin.type === testnetIkaCoinType,
  );
  const rawUserSuiCoins = rawUserCoins.objects.filter(
    (coin) => coin.type === testnetSuiCoinType,
  );

  if (!rawUserIkaCoins[0] || !rawUserSuiCoins[1]) {
    throw new Error("Missing required coins");
  }
  const userIkaCoin = tx.object(rawUserIkaCoins[0].objectId);
  const userSuiCoin = tx.object(rawUserSuiCoins[1].objectId);

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

  status("Requesting dWallet DKG...");
  const [dwalletCap, _sign_ID] = await ikaTx.requestDWalletDKG({
    dkgRequestInput: dkgRequestInput,
    sessionIdentifier: ikaTx.registerSessionIdentifier(sessionId),
    dwalletNetworkEncryptionKeyId: dWalletEncryptionKey.id,
    curve: Curve.ED25519,
    ikaCoin: userIkaCoin,
    suiCoin: userSuiCoin,
  });

  tx.transferObjects([dwalletCap as TransactionObjectArgument], senderAddress);

  status("Submitting transaction...");
  const result = await signAndExecuteTransaction({ transaction: tx });
  const digest = (result as { digest?: string })?.digest ?? "";

  return {
    dwalletCapId: (dwalletCap as TransactionObjectArgument).toString(),
    encryptionKeyId: dWalletEncryptionKey.id,
    sessionId,
    transactionDigest: digest,
  };
}
