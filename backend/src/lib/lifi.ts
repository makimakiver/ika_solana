const LIFI_API = "https://li.quest/v1";

export type LiFiQuoteParams = {
  fromChain: string;   // e.g. "SOL"
  toChain: string;     // e.g. "SUI"
  fromToken: string;   // token address on source chain
  toToken: string;     // token address on destination chain
  fromAmount: string;  // base units
  fromAddress: string; // sender address
  toAddress: string;   // recipient address
  slippage?: number;   // 0.005 = 0.5%
};

export type LiFiQuoteResponse = {
  id: string;
  tool: string;
  transactionRequest: {
    data: string; // base64-encoded transaction bytes (Solana) or hex PTB (Sui)
    [key: string]: unknown;
  };
  estimate: {
    fromAmount: string;
    toAmount: string;
    toAmountMin: string;
    executionDuration: number;
  };
  action: {
    fromChainId: number;
    toChainId: number;
    fromToken: { address: string; symbol: string; decimals: number };
    toToken: { address: string; symbol: string; decimals: number };
  };
};

export type LiFiStatusResponse = {
  transactionId?: string;
  status: "NOT_FOUND" | "INVALID" | "PENDING" | "DONE" | "FAILED";
  substatus?: string;
  substatusMessage?: string;
  sending?: { txHash?: string };
  receiving?: { txHash?: string };
};

export async function getLiFiQuote(params: LiFiQuoteParams): Promise<LiFiQuoteResponse> {
  const url = new URL(`${LIFI_API}/quote`);
  (Object.entries(params) as [string, string | number | undefined][]).forEach(
    ([k, v]) => v !== undefined && url.searchParams.set(k, String(v)),
  );
  const res = await fetch(url.toString());
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`LI.FI /quote failed: ${res.status} — ${body}`);
  }
  return res.json() as Promise<LiFiQuoteResponse>;
}

export async function getLiFiStatus(
  txHash: string,
  fromChain: string,
  toChain: string,
): Promise<LiFiStatusResponse> {
  const url = new URL(`${LIFI_API}/status`);
  url.searchParams.set("txHash", txHash);
  url.searchParams.set("fromChain", fromChain);
  url.searchParams.set("toChain", toChain);
  const res = await fetch(url.toString());
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`LI.FI /status failed: ${res.status} — ${body}`);
  }
  return res.json() as Promise<LiFiStatusResponse>;
}
