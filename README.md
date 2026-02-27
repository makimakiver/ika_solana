# IKA · Solana Example

A boilerplate dApp for creating IKA dWallets and depositing / withdrawing funds on Solana using the IKA SDK on Sui testnet.

---

## Pages

### Create dWallet
Creates an IKA dWallet through a multi-step Distributed Key Generation (DKG) process on Sui testnet:

1. Generates a random root seed key and derives user share encryption keys (ED25519)
```
  const userShareKeys = await UserShareEncryptionKeys.fromRootSeedKey(
    rootSeedKey,
    Curve.ED25519, //Solana supports ED25519 Curve so will choose ED25519 by default
  );
```
2. Initializes the IKA client
```
  const ikaClient = new IkaClient({
    suiClient, //JsonRpc for now
    config: getNetworkConfig("testnet"), // testnet
  });
```
3. Registers an encryption key on-chain
4. Fetches the latest network encryption key
5. Prepares the DKG request (async cryptographic computation)
6. Submits the DKG transaction via the connected wallet

Returns a **dWallet Cap ID**, **Encryption Key ID**, **Session ID**, and **Transaction Digest**.

### Deposit on Solana
Deposits funds from Solana into a dWallet. Supports three signing methods selectable via a tab toggle:

| Method | Description |
|---|---|
| **Presign** | Mint PresignCap on SUI and sign any transaction with the generated PresignCap |
| **Direct Sign** | Sign and submit the transaction immediately |
| **Future Sign** | Schedule the transaction to be signed at a future date/time |

### Withdraw
Withdraws funds from a dWallet back to a Solana address.

---

## Project structure

```
ika_sol_example/
├── contracts/                       # Sui Move smart contracts
│   └── sources/
│       └── counter.move
├── indexer/                         # On-chain event indexer
│                                    # Listens to events and store minted dWallets
│                                    
└── frontend/                        # Next.js app
    └── app/
        ├── CreateDWallet.tsx        # dWallet creation UI + DKG flow
        ├── DepositSolana.tsx        # Deposit page (presign / direct / future sign tabs)
        ├── Withdraw.tsx             # Withdraw page
        ├── HomeClient.tsx           # Top-level layout, topbar, page navigation
        ├── DappKitClientProvider.tsx
        ├── dapp-kit.ts
        └── lib/
            ├── dWallet.ts           # IKA SDK — DKG, encryption key, transaction logic
            ├── env.ts               # Env var accessors
            └── utils.ts             # retryWithBackoff utility
```


---

## Setup

### Frontend

```bash
cd frontend
npm install
```

Create a `.env` file:

```env
# Sui RPC — recommended to use independent rpc service like shinami since it is likely to face "too many request" error
NEXT_PUBLIC_SUI_RPC_URL=https://fullnode.testnet.sui.io
```

Start the dev server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).


The indexer connects to the Sui/IKA network and listens for on-chain events (dWallet creation, deposits, withdrawals). It indexes this data so the frontend can query current dWallet state without hitting the RPC directly for every read.

---

## Tech stack

|tool | name |
|---|---|
| Framework | Next.js  |
| UI components | Radix UI Themes |
| RPC provider | Shinami (testnet) |

---

## Known behaviour

- **Rate limiting** — the Sui RPC may return `Resource limit exceeded`. The `retryWithBackoff` utility automatically retries up to 5 times with a 1 second delay. Using a dedicated RPC provider like Shinami reduces this significantly.
- **DKG latency** — dWallet creation involves heavy cryptographic computation (`prepareDKGAsync`) and several sequential network calls. Expect 10–30 seconds before the wallet popup appears.
- **Deposit / Withdraw flows** — currently use placeholder logic. Replace the `// TODO` comments in `DepositSolana.tsx` and `Withdraw.tsx` with actual IKA SDK calls.
- **Indexer** — the indexer directory is a placeholder. Wire it up to feed indexed dWallet state into the frontend to avoid repeated RPC calls.
# ika_solana
