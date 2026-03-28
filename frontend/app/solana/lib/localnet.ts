import { type IkaConfig } from "@ika.xyz/sdk";
import {
  Transaction,
  type TransactionObjectArgument,
} from "@mysten/sui/transactions";

/**
 * Localnet-only — mints a zero-value IKA coin via coin::zero.
 * On testnet/mainnet use real IKA coins from the user's wallet.
 */
export function createEmptyTestIkaToken(tx: Transaction, ikaConfig: IkaConfig) {
  return tx.moveCall({
    target: `0x2::coin::zero`,
    arguments: [],
    typeArguments: [`${ikaConfig.packages.ikaPackage}::ika::IKA`],
  });
}

/**
 * Localnet-only — destroys the zero-value IKA coin created by createEmptyTestIkaToken.
 */
export function destroyEmptyTestIkaToken(
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
