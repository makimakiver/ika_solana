import { SuiGrpcClient } from "@mysten/sui/grpc";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { ENV } from "./env.js";

export const suiClient = new SuiGrpcClient({
  network: "localnet",
  baseUrl: ENV.SUI_RPC_URL,
});

export const testnetSuiClient = new SuiGrpcClient({
  network: "testnet",
  baseUrl: ENV.SUI_TESTNET_RPC_URL,
});

export const mainnetSuiClient = new SuiGrpcClient({
  network: "mainnet",
  baseUrl: ENV.SUI_MAINNET_RPC_URL,
});

export function getBackendKeypair(): Ed25519Keypair {
  return Ed25519Keypair.fromSecretKey(ENV.BACKEND_SUI_PRIVATE_KEY);
}

export function getGasSponsorKeypair(): Ed25519Keypair {
  return Ed25519Keypair.fromSecretKey(ENV.GAS_SPONSOR_PRIVATE_KEY);
}
