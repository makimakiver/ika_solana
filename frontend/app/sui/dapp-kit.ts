import { createDAppKit } from "@mysten/dapp-kit-react";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import { ENV } from "./lib/env";

const GRPC_URLS = {
  testnet: ENV.SUI_RPC_URL,
} as const;

const LOCAL_URL = {
  localnet: "http://127.0.0.1:9000",
};
export const dAppKit = createDAppKit({
  networks: ["localnet"],
  createClient: (network) =>
    new SuiGrpcClient({ network, baseUrl: LOCAL_URL[network] }),
});

declare module "@mysten/dapp-kit-react" {
  interface Register {
    dAppKit: typeof dAppKit;
  }
}
