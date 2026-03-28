import { type IkaConfig } from "@ika.xyz/sdk";
import ikaConfigJson from "../../../ika_config.json";

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
