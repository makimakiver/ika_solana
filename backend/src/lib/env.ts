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
};
