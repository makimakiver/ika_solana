import { ENV } from "./env.js";

function authHeaders(): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  const jwt = ENV.NEAR_INTENTS_JWT;
  if (jwt) h["Authorization"] = `Bearer ${jwt}`;
  return h;
}

export type Token = {
  assetId: string;
  symbol: string;
  blockchain: string; // e.g. "sol", "sui", "near", "eth", "arb", "base"
  decimals: number;
  contractAddress: string;
};

export type QuoteParams = {
  originAsset: string;
  destinationAsset: string;
  amount: string;            // base units e.g. "10500000" for 10.5 USDC (6 decimals)
  recipient: string;         // Sui address — dWallet-derived
  refundTo: string;          // Solana address — user's wallet
  dry: boolean;              // false for real quotes
  swapType: "EXACT_INPUT" | "EXACT_OUTPUT" | "FLEX_INPUT" | "ANY_INPUT";
  slippageTolerance: number; // integer 0-10000 (basis points)
  depositType: "ORIGIN_CHAIN" | "INTENTS";
  refundType: "ORIGIN_CHAIN" | "INTENTS";
  recipientType: "DESTINATION_CHAIN" | "INTENTS";
  deadline: string;          // ISO 8601 date string
};

export type QuoteResponse = {
  quote: {
    amountIn: string;
    amountInFormatted: string;
    amountOut: string;
    amountOutFormatted: string;
    minAmountOut: string;
    depositAddress: string;
    deadline: string; // ISO 8601
    timeEstimate: number;
  };
  correlationId: string;
};

export type StatusResponse = {
  status: "PENDING_DEPOSIT" | "PROCESSING" | "SUCCESS" | "REFUNDED" | "FAILED";
};

export async function getTokens(): Promise<Token[]> {
  const res = await fetch(`${ENV.NEAR_INTENTS_BASE_URL}/v0/tokens`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`1Click /v0/tokens failed: ${res.status}`);
  return res.json() as Promise<Token[]>;
}

export async function getQuote(params: QuoteParams): Promise<QuoteResponse> {
  const res = await fetch(`${ENV.NEAR_INTENTS_BASE_URL}/v0/quote`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`1Click /v0/quote failed: ${res.status} — ${body}`);
  }
  return res.json() as Promise<QuoteResponse>;
}

export async function submitDeposit(
  depositAddress: string,
  txHash: string,
): Promise<void> {
  const res = await fetch(`${ENV.NEAR_INTENTS_BASE_URL}/v0/deposit/submit`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ depositAddress, txHash }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`1Click /v0/deposit/submit failed: ${res.status} — ${body}`);
  }
}

export async function getStatus(depositAddress: string): Promise<StatusResponse> {
  const res = await fetch(
    `${ENV.NEAR_INTENTS_BASE_URL}/v0/status?depositAddress=${encodeURIComponent(depositAddress)}`,
    { headers: authHeaders() },
  );
  if (!res.ok) throw new Error(`1Click /v0/status failed: ${res.status}`);
  return res.json() as Promise<StatusResponse>;
}
