# NEAR Intents Bridge — Design Spec
_Date: 2026-03-28_

## Overview

Add a Solana → Sui USDC bridge to the ika_sol_example backend using the NEAR Intents 1Click API. The user sends USDC from their Solana wallet (Phantom etc.) and receives USDC on Sui at the address derived from their IKA dWallet's ED25519 public key. The IKA dWallet is not involved in signing the Solana side — it is purely the Sui recipient identity.

---

## Architecture

Two new files are added to the backend. No existing files are modified except `index.ts` (one new route registration).

```
backend/src/
├── lib/
│   └── near-intents.ts     ← typed 1Click API client
└── routes/
    └── bridge.ts           ← three endpoints
```

`.env` / `.env.example` get two new keys:
```
NEAR_INTENTS_BASE_URL=https://1click.near-intents.org
NEAR_INTENTS_JWT=          # optional — omitting adds 0.2% unauthenticated fee
```

---

## Components

### `lib/near-intents.ts`

Stateless typed wrappers over the four 1Click calls. Each function takes typed inputs and returns typed outputs. No logic beyond `fetch` + JSON parse + error throwing.

Functions:
- `getTokens(): Promise<Token[]>` — `GET /v0/tokens`
- `getQuote(params): Promise<QuoteResponse>` — `POST /v0/quote`
- `submitDeposit(params): Promise<void>` — `POST /v0/deposit/submit`
- `getStatus(depositAddress: string): Promise<StatusResponse>` — `GET /v0/status?depositAddress=`

Key types:
```ts
type Token = { assetId: string; symbol: string; chainId: string; decimals: number }
type QuoteResponse = { depositAddress: string; inputAmount: string; outputAmount: string; expiry: number }
type StatusResponse = { status: 'PENDING_DEPOSIT' | 'PROCESSING' | 'SUCCESS' | 'REFUNDED' | 'FAILED' }
```

JWT is attached as `Authorization: Bearer <jwt>` when present.

---

### `routes/bridge.ts`

Three endpoints mounted at `/api/bridge`.

#### `POST /api/bridge/quote`

**Input:**
```json
{ "dWalletId": "0x...", "solanaAddress": "GR5H...", "amount": "10.50" }
```

**Steps:**
1. Fetch dWallet from IKA client using `ikaClient.getDWallet(dWalletId)`
2. Extract `public_output` from `state.Active` → call `publicKeyFromDWalletOutput(Curve.ED25519, publicOutput)`
3. Derive Sui address: `new Ed25519PublicKey(pubkeyBytes).toSuiAddress()`
4. Call `getTokens()` → find Solana USDC (`symbol === 'USDC'`, Solana chain) and Sui USDC (`symbol === 'USDC'`, Sui chain) by scanning the list
5. Convert `amount` (human units) to base units using token decimals
6. Call `getQuote({ originAsset, destinationAsset, amount: baseUnits, recipient: suiAddress, refundTo: solanaAddress, slippage: 100, deadline: Date.now()/1000 + 300 })`
7. Return `{ depositAddress, inputAmount, outputAmount, expiry, suiAddress }`

**Error cases:**
- dWallet not found or not Active → 400
- USDC not found on either chain in tokens list → 503
- 1Click quote fails → 502

---

#### `POST /api/bridge/submit`

**Input:**
```json
{ "depositAddress": "So1ana...", "solanaTxId": "5abc..." }
```

Calls `submitDeposit({ depositAddress, txHash: solanaTxId })`. Returns `{ ok: true }`. This is optional per 1Click docs (the solver auto-detects deposits) but speeds up processing.

---

#### `GET /api/bridge/status?depositAddress=...`

Proxies `getStatus(depositAddress)` and returns the 1Click response directly.

---

### `index.ts` change

```ts
import bridgeRouter from "./routes/bridge.js";
app.use("/api/bridge", bridgeRouter);
```

---

## Data Flow

```
Frontend                          Backend                        1Click API
   |                                 |                               |
   |-- POST /api/bridge/quote -----> |                               |
   |   { dWalletId, solanaAddress,   |-- GET /v0/tokens -----------> |
   |     amount }                    |<-- Token[] ------------------- |
   |                                 |-- POST /v0/quote -----------> |
   |                                 |<-- { depositAddress, ... } --- |
   |<-- { depositAddress, ... } ---- |                               |
   |                                 |                               |
   | [User confirms USDC transfer    |                               |
   |  to depositAddress in Phantom]  |                               |
   |                                 |                               |
   |-- POST /api/bridge/submit ----> |                               |
   |   { depositAddress, txId }      |-- POST /v0/deposit/submit --> |
   |<-- { ok: true } --------------- |                               |
   |                                 |                               |
   |-- GET /api/bridge/status? ----> |                               |
   |   depositAddress=...            |-- GET /v0/status?... -------> |
   |<-- { status: "SUCCESS" } ------ |<-- { status: ... } ---------- |
```

---

## Token Discovery

Do not hardcode asset IDs. On each quote request, call `/v0/tokens` and filter by:
- `symbol === 'USDC'`
- chain identifier matching Solana (e.g. `'solana'` or `'sol'`)
- chain identifier matching Sui

If multiple matches exist, pick the one with the highest liquidity or simply the first match. Log a warning if no match is found so it is easy to diagnose token list changes.

---

## Error Handling

| Scenario | Response |
|---|---|
| dWallet not Active | 400 `{ error: "dWallet is not in Active state" }` |
| USDC not in token list | 503 `{ error: "USDC not available on source or destination chain" }` |
| 1Click quote error | 502 `{ error: "Quote failed: <1click message>" }` |
| Missing required fields | 400 `{ error: "..." }` |

---

## Environment Variables

| Key | Required | Description |
|---|---|---|
| `NEAR_INTENTS_BASE_URL` | Yes | 1Click API base URL |
| `NEAR_INTENTS_JWT` | No | JWT for fee reduction (avoids 0.2% unauthenticated fee) |

---

## Constraints

- No testnet for NEAR Intents — use small amounts when testing
- Token availability is live; never hardcode asset IDs
- 1Click quote expires (`expiry` field) — frontend should warn user if quote is stale before sending
- `submitDeposit` is optional but recommended
- Status polling is the frontend's responsibility; backend only proxies
