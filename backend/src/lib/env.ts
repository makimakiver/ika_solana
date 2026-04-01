export const ENV = {
  get SUI_RPC_URL() {
    const url = process.env.SUI_RPC_URL;
    if (!url) throw new Error("Missing env var: SUI_RPC_URL");
    return url;
  },
  get SUI_TESTNET_RPC_URL() {
    return process.env.SUI_TESTNET_RPC_URL || "https://fullnode.testnet.sui.io:443";
  },
  get BACKEND_SUI_PRIVATE_KEY() {
    const key = process.env.BACKEND_SUI_PRIVATE_KEY;
    if (!key) throw new Error("Missing env var: BACKEND_SUI_PRIVATE_KEY");
    return key;
  },
  get SUI_MAINNET_RPC_URL() {
    return process.env.SUI_MAINNET_RPC_URL || "https://fullnode.mainnet.sui.io:443";
  },
  get GAS_SPONSOR_PRIVATE_KEY() {
    const key = process.env.GAS_SPONSOR_PRIVATE_KEY;
    if (!key) throw new Error("Missing env var: GAS_SPONSOR_PRIVATE_KEY");
    return key;
  },
  get NEAR_INTENTS_BASE_URL() {
    return process.env.NEAR_INTENTS_BASE_URL ?? "https://1click.near-intents.org";
  },
  get NEAR_INTENTS_JWT() {
    return process.env.NEAR_INTENTS_JWT; // optional — omitting adds 0.2% unauthenticated fee
  },
};
