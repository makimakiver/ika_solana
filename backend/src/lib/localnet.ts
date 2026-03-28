import { type IkaConfig } from "@ika.xyz/sdk";
import {
  Transaction,
  type TransactionObjectArgument,
} from "@mysten/sui/transactions";

export function createEmptyTestIkaToken(tx: Transaction, ikaConfig: IkaConfig) {
  return tx.moveCall({
    target: `0x2::coin::zero`,
    arguments: [],
    typeArguments: [`${ikaConfig.packages.ikaPackage}::ika::IKA`],
  });
}

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
