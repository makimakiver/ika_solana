export const ENV = {
  get SUI_RPC_URL() {
    const url = process.env.NEXT_PUBLIC_SUI_RPC_URL;
    if (!url) throw new Error("Missing env var: NEXT_PUBLIC_SUI_RPC_URL");
    return url;
  },
  get SOLANA_RPC_URL() {
    const url = process.env.NEXT_PUBLIC_SOLANA_RPC_URL;
    if (!url) throw new Error("Missing env var: NEXT_PUBLIC_SOLANA_RPC_URL");
    return url;
  },
};
