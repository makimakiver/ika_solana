# NEAR Intents Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three backend endpoints (`/api/bridge/quote`, `/api/bridge/submit`, `/api/bridge/status`) that enable a Solana-wallet user to bridge USDC to the Sui address derived from their IKA dWallet using the NEAR Intents 1Click API.

**Architecture:** A typed 1Click API client lives in `lib/near-intents.ts`. Three Express endpoints in `routes/bridge.ts` orchestrate: resolving token IDs, fetching a quote (with the dWallet-derived Sui address as recipient), proxying submit, and proxying status. The Solana wallet signing and broadcast are done entirely in the frontend — the backend never touches the Solana tx.

**Tech Stack:** TypeScript, Express, `@ika.xyz/sdk` (`IkaClient`, `publicKeyFromDWalletOutput`, `Curve`), `@mysten/sui` (`Ed25519PublicKey`), native `fetch` (Node 18+), NEAR Intents 1Click API.

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Modify | `backend/src/lib/env.ts` | Add `NEAR_INTENTS_BASE_URL` and `NEAR_INTENTS_JWT` accessors |
| Modify | `backend/.env.example` | Document new env vars |
| Create | `backend/src/lib/near-intents.ts` | Typed 1Click API client (tokens, quote, submit, status) |
| Create | `backend/src/routes/bridge.ts` | `/quote`, `/submit`, `/status` endpoints |
| Modify | `backend/src/index.ts` | Register `bridgeRouter` at `/api/bridge` |

---

## Task 1: Add env vars

**Files:**
- Modify: `backend/src/lib/env.ts`
- Modify: `backend/.env.example`

- [ ] **Step 1: Add accessors to `env.ts`**

Open `backend/src/lib/env.ts`. Add two new getters inside the `ENV` object after the existing `BACKEND_SUI_PRIVATE_KEY` getter:

```ts
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
  get NEAR_INTENTS_BASE_URL() {
    return process.env.NEAR_INTENTS_BASE_URL ?? "https://1click.near-intents.org";
  },
  get NEAR_INTENTS_JWT() {
    return process.env.NEAR_INTENTS_JWT; // optional — omitting adds 0.2% unauthenticated fee
  },
};
```

- [ ] **Step 2: Update `.env.example`**

Append to `backend/.env.example`:

```
# NEAR Intents 1Click API
NEAR_INTENTS_BASE_URL=https://1click.near-intents.org
NEAR_INTENTS_JWT=   # optional JWT — avoids 0.2% unauthenticated fee
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/lib/env.ts backend/.env.example
git commit -m "feat: add NEAR Intents env vars"
```

---

## Task 2: Create `near-intents.ts` 1Click API client

**Files:**
- Create: `backend/src/lib/near-intents.ts`

- [ ] **Step 1: Create the file**

Create `backend/src/lib/near-intents.ts` with the full content below.

> **Note:** The exact field names returned by `/v0/tokens` must be verified against the live API before the route uses them. The `assetId` and `blockchain` names below are based on documented examples — run `curl https://1click.near-intents.org/v0/tokens | head -c 2000` once to confirm the shape and adjust if needed.

```ts
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
  blockchain: string;
  decimals: number;
};

export type QuoteParams = {
  originAsset: string;
  destinationAsset: string;
  amount: string;       // base units (e.g. "10500000" for 10.5 USDC with 6 decimals)
  recipient: string;    // Sui address — dWallet-derived
  refundTo: string;     // Solana address — user's wallet
  slippage: number;     // basis points, e.g. 100 = 1%
  deadline: number;     // unix seconds
};

export type QuoteResponse = {
  depositAddress: string;
  inputAmount: string;
  outputAmount: string;
  expiry: number;
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

export async function getStatus(
  depositAddress: string,
): Promise<StatusResponse> {
  const res = await fetch(
    `${ENV.NEAR_INTENTS_BASE_URL}/v0/status?depositAddress=${encodeURIComponent(depositAddress)}`,
    { headers: authHeaders() },
  );
  if (!res.ok) throw new Error(`1Click /v0/status failed: ${res.status}`);
  return res.json() as Promise<StatusResponse>;
}
```

- [ ] **Step 2: Verify token shape against live API**

```bash
curl https://1click.near-intents.org/v0/tokens | npx -y fx '.[0:3]'
```

Confirm the response objects have `assetId`, `symbol`, `blockchain`, and `decimals` fields. If field names differ (e.g. `chain` instead of `blockchain`), update the `Token` type and the filtering logic in Task 3 accordingly.

- [ ] **Step 3: Commit**

```bash
git add backend/src/lib/near-intents.ts
git commit -m "feat: add NEAR Intents 1Click API client"
```

---

## Task 3: Create `bridge.ts` route

**Files:**
- Create: `backend/src/routes/bridge.ts`

- [ ] **Step 1: Create the file**

Create `backend/src/routes/bridge.ts`:

```ts
import express from "express";
import type { Request, Response } from "express";
import { IkaClient, publicKeyFromDWalletOutput, Curve } from "@ika.xyz/sdk";
import { Ed25519PublicKey } from "@mysten/sui/keypairs/ed25519";
import { suiClient } from "../lib/sui-client.js";
import { getLocalNetworkConfig } from "../lib/config.js";
import {
  getTokens,
  getQuote,
  submitDeposit,
  getStatus,
} from "../lib/near-intents.js";

const router = express.Router();

// POST /api/bridge/quote
// Body: { dWalletId: string, solanaAddress: string, amount: string }
// amount is a human-readable USDC value e.g. "10.50"
router.post("/quote", async (req: Request, res: Response) => {
  const { dWalletId, solanaAddress, amount } = req.body as {
    dWalletId?: string;
    solanaAddress?: string;
    amount?: string;
  };

  if (!dWalletId || !solanaAddress || !amount) {
    res.status(400).json({ error: "dWalletId, solanaAddress, and amount are required" });
    return;
  }

  try {
    const ikaConfig = getLocalNetworkConfig();
    const ikaClient = new IkaClient({ suiClient, config: ikaConfig });
    await ikaClient.initialize();

    // 1. Fetch dWallet and derive Sui recipient address
    const dWallet = await ikaClient.getDWallet(dWalletId);
    if (dWallet.state?.$kind !== "Active") {
      res.status(400).json({ error: "dWallet is not in Active state" });
      return;
    }

    const rawPublicOutput = dWallet.state.Active.public_output;
    const publicOutput =
      rawPublicOutput instanceof Uint8Array
        ? rawPublicOutput
        : new Uint8Array(rawPublicOutput);

    const pubkeyBytes = await publicKeyFromDWalletOutput(Curve.ED25519, publicOutput);
    const suiAddress = new Ed25519PublicKey(pubkeyBytes).toSuiAddress();

    // 2. Discover USDC token IDs on Solana and Sui
    const tokens = await getTokens();

    const solanaUsdc = tokens.find(
      (t) => t.symbol === "USDC" && t.blockchain.toLowerCase() === "solana",
    );
    const suiUsdc = tokens.find(
      (t) => t.symbol === "USDC" && t.blockchain.toLowerCase() === "sui",
    );

    if (!solanaUsdc) {
      console.warn("[bridge/quote] Solana USDC not found in token list");
      res.status(503).json({ error: "USDC not available on Solana via NEAR Intents" });
      return;
    }
    if (!suiUsdc) {
      console.warn("[bridge/quote] Sui USDC not found in token list");
      res.status(503).json({ error: "USDC not available on Sui via NEAR Intents" });
      return;
    }

    // 3. Convert human amount to base units
    const decimals = solanaUsdc.decimals;
    const baseAmount = Math.round(parseFloat(amount) * 10 ** decimals).toString();

    // 4. Fetch quote
    const quote = await getQuote({
      originAsset: solanaUsdc.assetId,
      destinationAsset: suiUsdc.assetId,
      amount: baseAmount,
      recipient: suiAddress,
      refundTo: solanaAddress,
      slippage: 100, // 1%
      deadline: Math.floor(Date.now() / 1000) + 300, // 5 minutes
    });

    console.log(`[bridge/quote] depositAddress=${quote.depositAddress} suiRecipient=${suiAddress}`);

    res.json({
      depositAddress: quote.depositAddress,
      inputAmount: quote.inputAmount,
      outputAmount: quote.outputAmount,
      expiry: quote.expiry,
      suiAddress,
    });
  } catch (e) {
    console.error("[bridge/quote] error:", e);
    res.status(502).json({
      error: e instanceof Error ? e.message : "Quote failed",
    });
  }
});

// POST /api/bridge/submit
// Body: { depositAddress: string, solanaTxId: string }
// Optional but speeds up solver detection
router.post("/submit", async (req: Request, res: Response) => {
  const { depositAddress, solanaTxId } = req.body as {
    depositAddress?: string;
    solanaTxId?: string;
  };

  if (!depositAddress || !solanaTxId) {
    res.status(400).json({ error: "depositAddress and solanaTxId are required" });
    return;
  }

  try {
    await submitDeposit(depositAddress, solanaTxId);
    res.json({ ok: true });
  } catch (e) {
    console.error("[bridge/submit] error:", e);
    res.status(502).json({
      error: e instanceof Error ? e.message : "Submit failed",
    });
  }
});

// GET /api/bridge/status?depositAddress=...
router.get("/status", async (req: Request, res: Response) => {
  const depositAddress = req.query.depositAddress as string | undefined;

  if (!depositAddress) {
    res.status(400).json({ error: "depositAddress query param is required" });
    return;
  }

  try {
    const status = await getStatus(depositAddress);
    res.json(status);
  } catch (e) {
    console.error("[bridge/status] error:", e);
    res.status(502).json({
      error: e instanceof Error ? e.message : "Status check failed",
    });
  }
});

export default router;
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/routes/bridge.ts
git commit -m "feat: add bridge route (quote/submit/status)"
```

---

## Task 4: Register route in `index.ts`

**Files:**
- Modify: `backend/src/index.ts`

- [ ] **Step 1: Add import and mount**

Open `backend/src/index.ts`. Add the import after the existing route imports and mount it:

```ts
import "dotenv/config";
import express from "express";
import dwalletRouter from "./routes/dwallet.js";
import depositRouter from "./routes/deposit.js";
import testRouter from "./routes/test.js";
import bridgeRouter from "./routes/bridge.js";

const app = express();
const PORT = process.env.PORT ?? 3001;
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN ?? "http://localhost:3000";

app.use(express.json());

app.use((_req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", FRONTEND_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  next();
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/api/dwallet", dwalletRouter);
app.use("/api/deposit", depositRouter);
app.use("/api/test", testRouter);
app.use("/api/bridge", bridgeRouter);

app.listen(PORT, () => {
  console.log(`Urchin backend running on http://localhost:${PORT}`);
});
```

- [ ] **Step 2: Start the server and verify it compiles**

```bash
cd backend && npm run dev
```

Expected: server starts without TypeScript errors on `http://localhost:3001`.

- [ ] **Step 3: Smoke test the quote endpoint**

With the server running, run (replace `<DWALLET_ID>` with a real active dWallet ID):

```bash
curl -s -X POST http://localhost:3001/api/bridge/quote \
  -H "Content-Type: application/json" \
  -d '{"dWalletId":"<DWALLET_ID>","solanaAddress":"GR5HAedxPBDnV8PUb4dywaHHxPvTpV7wAXNk9MyDYBuH","amount":"1.00"}' | jq .
```

Expected response shape:
```json
{
  "depositAddress": "So1ana...",
  "inputAmount": "1000000",
  "outputAmount": "...",
  "expiry": 1234567890,
  "suiAddress": "0x..."
}
```

- [ ] **Step 4: Smoke test the status endpoint**

```bash
curl -s "http://localhost:3001/api/bridge/status?depositAddress=<DEPOSIT_ADDRESS>" | jq .
```

Expected: `{ "status": "PENDING_DEPOSIT" }` (or similar 1Click state).

- [ ] **Step 5: Final commit**

```bash
git add backend/src/index.ts
git commit -m "feat: register bridge route"
```

---

## Post-implementation note

If the `Token` field names from the live API differ from `assetId` / `blockchain` (verified in Task 2 Step 2), update:
1. The `Token` type in `near-intents.ts`
2. The `.find()` calls in `bridge.ts` (`t.symbol`, `t.blockchain`, `t.assetId`)

These are the only two places token shape is referenced.
