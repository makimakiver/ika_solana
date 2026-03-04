# IKA · Solana Example

A boilerplate dApp for creating IKA dWallets and transferring SOL on Solana devnet using the IKA SDK on a local IKA network.

---

## How it works

IKA dWallets are cryptographic wallets whose private key is never held by a single party. Key generation and signing happen through a 2-PC MPC protocol between the user and the IKA network. The user's share is encrypted and stored on-chain; the IKA network holds the other share.

Because dWallets generate standard ED25519 key pairs, the resulting public key is a valid Solana address — any SOL sent to that address can only be spent by completing a signing protocol with IKA.

---

## Pages

### Create dWallet

Creates an IKA dWallet through a multi-step Distributed Key Generation (DKG) process:

1. Generates a random root seed key and derives user share encryption keys (ED25519)
```ts
  const userShareKeys = await UserShareEncryptionKeys.fromRootSeedKey(
    rootSeedKey,
    Curve.ED25519, //Solana supports ED25519 Curve so will choose ED25519 by default
  );
```
2. Initializes the IKA client
```ts
  const ikaClient = new IkaClient({
    suiClient, //JsonRpc for now
    config: getNetworkConfig("testnet"), // testnet
  });
```
3. Registers an encryption key on-chain
4. Fetches the latest network encryption key
5. Prepares the DKG request (async cryptographic computation)
6. Submits the DKG transaction via the connected wallet

Returns a **dWallet Cap ID**, **dWallet ID**, **Encryption Key ID**, and **Transaction Digest**.

Also displays a **My dWallets** list showing all dWallets owned by the connected account with their active/pending state.

---

### Deposit on Solana

Shows the dWallet's Solana address (derived from the ED25519 public output) and its current devnet SOL balance. The amount field turns **red** if the entered value exceeds the wallet balance.

In this section, you will need to send some devnet SOL to the dWallet address manually:

- Visit https://faucet.solana.com/ to receive devnet SOL token
- Copy the address displayed on the Deposit page and send some SOL token from your Solana wallet

---

### Withdraw

Withdraws SOL from a dWallet to any Solana address. Three signing methods are available via a tab toggle:

| Method | Status | Description |
|---|---|---|
| **Presign** | ✅ Implemented | Pre-compute the presign on-chain, then use the resulting `UnverifiedPresignCap` to sign and broadcast a Solana SOL transfer. Links to the confirmed transaction on Solana devnet explorer. |
| **Direct Sign** | 🚧 Stub | Sign and submit in one step — implementation pending. |
| **Future Sign** | 🚧 Stub | Schedule signing for a future time — implementation pending. |

#### Presign flow in detail

1. **Create Presign** — calls `requestGlobalPresign` on IKA, waits for the presign to reach `Completed` state, and transfers an `UnverifiedPresignCap` to the user's wallet.
2. **Sign with Cap** — selects a cap from the list, enters a destination address, amount, and password, then:
   - Builds an unsigned Solana `SystemProgram.transfer` transaction
   - Calls `ikaSignBytes` to submit an `approveMessage` + `verifyPresignCap` + `requestSign` transaction on IKA
   - Polls IKA until the `SignSession` reaches `Completed` state and extracts the 64-byte Ed25519 signature
   - Attaches the signature to the Solana transaction and broadcasts it via `sendRawTransaction`
   - Displays the Solana txid and a **View on Solana Explorer ↗** link (`?cluster=devnet`)

The amount field in the sign dialog turns **red** if the entered SOL amount exceeds the dWallet's devnet balance.

---

## Project structure

```
ika_sol_example/
├── contracts/                        # Sui Move smart contracts
│   └── sources/
│       └── counter.move
├── indexer/                          # On-chain event indexer (placeholder)
└── frontend/                         # Next.js 16 app
    └── app/
        ├── CreateDWallet.tsx         # dWallet creation UI + DKG flow
        ├── DWalletList.tsx           # Lists owned dWallets with active/pending state
        ├── DepositSolana.tsx         # Deposit page — shows Solana address + balance
        ├── Withdraw.tsx              # Withdraw page — mode selector (presign / direct / future)
        ├── PresignMode.tsx           # Presign: create cap + sign dialog + explorer link
        ├── DirectSignMode.tsx        # Direct sign stub
        ├── FutureSignMode.tsx        # Future sign stub
        ├── CreatePresign.tsx         # Standalone create-presign card
        ├── UnverifiedCapList.tsx     # Lists UnverifiedPresignCaps owned by the account
        ├── HomeClient.tsx            # Top-level layout, topbar, page navigation
        ├── DappKitClientProvider.tsx # Sui dApp Kit context provider
        ├── dapp-kit.ts               # dApp Kit configuration
        └── lib/
            ├── dWallet_utils.ts      # IKA SDK — DKG, activation, network config, token helpers
            ├── ika_solana_sign.ts    # Solana signing — build tx, IKA sign, broadcast, explorer URL
            ├── presign_utils.ts      # createPresign — requestGlobalPresign + wait for Completed
            ├── env.ts                # Env var accessors (SUI_RPC_URL, SOLANA_RPC_URL)
            └── utils.ts              # retryWithBackoff utility
```

---

## Setup

### Prerequisites

- Node.js 18+
- A Sui-compatible wallet browser extension (e.g. Sui Wallet)
- Sui CLI is installed on your computer

### Running localnet

First clone the ika repository:
```bash
git clone https://github.com/dwallet-labs/ika.git
```
Next run Sui localnet:
```bash
RUST_LOG="off,sui_node=info" sui start --with-faucet --force-regenesis --epoch-duration-ms 1000000000000000
```

Then run Ika localnet:
```bash
cargo run --bin ika --release --no-default-features -- start
```

- If you already have executed the Ika localnet, check whether you have ika_config.json file and have Pub.localnet.toml file.
If you have them run the following command:
```bash
cargo run --bin ika --release --no-default-features -- start --force-reinitiation
```
Once you run the command you will get `ika_config.json` file that looks something like this:
```json
{
  "packages": {
    "ika_package_id": "0x22408712e48413ee7af640aa763b193b0bfc51fff45bbff961f0f83eed74150e",
    "ika_common_package_id": "0x1b8615c4502844bbd9e5b0f40d8f1229e5c748321651d47f2a28cd143563023c",
    "ika_dwallet_2pc_mpc_package_id": "0x0e0d0abb7d0e1fcb7f417538b905257e7ffcfcf166a10f771b203d1bb7e57965",
    "ika_system_package_id": "0xe254d71cb7b56c263031bed643e64cf3c20518a3dd70e46227690c74d3e5895b"
  },
  "objects": {
    "ika_system_object_id": "0x02a876ea5b743e4e0675e7ded9de0fd5b31a15719a014894885f597eb976b0a1",
    "ika_dwallet_coordinator_object_id": "0xd2d534308cb1316f560e935920bfcbb37e7fa9395868bf84f56d6492eb3e9fcb"
  }
}
```
Copy the content of the file once it is generated and paste it into the `frontend/` directory:

```
ika_sol_example/
├── contracts/
├── indexer/
└── frontend/
    ├── ika_config.json   ← place it here
    ├── app/
    └── ...
```


Visit ika documention to know more about this:

https://docs.ika.xyz/docs/sdk/setup-localnet


### Frontend

```bash
cd frontend
npm install
```

Create a `.env` file:

```env
# Sui / IKA RPC — point to your local IKA node or a hosted RPC
NEXT_PUBLIC_SUI_RPC_URL=http://127.0.0.1:9000

# Solana devnet RPC
NEXT_PUBLIC_SOLANA_RPC_URL=https://api.devnet.solana.com
```

> **Tip:** If you hit `Resource limit exceeded` errors, use a dedicated RPC provider (e.g. Shinami) for `NEXT_PUBLIC_SUI_RPC_URL`.

Start the dev server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## Tech stack

| Layer | Tool |
|---|---|
| Framework | Next.js 16 |
| UI components | Radix UI Themes 3 |
| IKA SDK | `@ika.xyz/sdk` ^0.3.0 |
| Sui SDK | `@mysten/sui` ^2.5.0, `@mysten/dapp-kit-react` ^1.1.0 |
| Solana SDK | `@solana/web3.js` ^1.98.4 |

---

## Localnet-only helper functions

The following three functions in `frontend/app/lib/dWallet_utils.ts` are **localnet-specific utilities** and will not be needed when connecting to IKA testnet or mainnet.

---

### `getLocalNetworkConfig()`

Builds an `IkaConfig` object by reading package and object IDs directly from `ika_config.json` — the file generated by the local IKA node. On testnet/mainnet the IKA SDK provides its own `getNetworkConfig("testnet")` helper, so this function becomes unnecessary.

```ts
export function getLocalNetworkConfig(): IkaConfig {
  return {
    packages: {
      ikaPackage: ikaConfigJson.packages.ika_package_id,
      ikaCommonPackage: ikaConfigJson.packages.ika_common_package_id,
      ikaSystemOriginalPackage: ikaConfigJson.packages.ika_system_package_id,
      ikaSystemPackage: ikaConfigJson.packages.ika_system_package_id,
      ikaDwallet2pcMpcOriginalPackage:
        ikaConfigJson.packages.ika_dwallet_2pc_mpc_package_id,
      ikaDwallet2pcMpcPackage:
        ikaConfigJson.packages.ika_dwallet_2pc_mpc_package_id,
    },
    objects: {
      ikaSystemObject: {
        objectID: ikaConfigJson.objects.ika_system_object_id,
        initialSharedVersion: 0,
      },
      ikaDWalletCoordinator: {
        objectID: ikaConfigJson.objects.ika_dwallet_coordinator_object_id,
        initialSharedVersion: 0,
      },
    },
  };
}
```

---

### `createEmptyTestIkaToken()`

Creates a zero-value IKA coin via `0x2::coin::zero`. This is required on localnet because the faucet does not distribute IKA tokens. On testnet/mainnet the user's wallet will hold real IKA coins, so this workaround is not needed.

```ts
export function createEmptyTestIkaToken(tx: Transaction, ikaConfig: IkaConfig) {
  return tx.moveCall({
    target: `0x2::coin::destroy_zero`,
    arguments: [],
    typeArguments: [`${ikaConfig.packages.ikaPackage}::ika::IKA`],
  });
}
```

---

### `destroyEmptyTestIkaToken()`

Destroys the zero-value IKA coin after use via `0x2::coin::destroy_zero`. It is the cleanup counterpart of `createEmptyTestIkaToken` and exists for the same localnet-only reason.

```ts
export function destroyEmptyTestIkaToken(
  tx: Transaction,
  ikaConfig: IkaConfig,
  ikaToken: TransactionObjectArgument,
) {
  return tx.moveCall({
    target: `0x2::coin::destroy_zero`,
    arguments: [ikaToken],
    typeArguments: [`${ikaConfig.packages.ikaPackage}::ika::IKA`],
  });
}
```

---

## Known behaviour

- **DKG latency** — dWallet creation involves heavy cryptographic computation (`prepareDKGAsync`) and several sequential network round-trips. Expect 10–30 seconds end-to-end.
- **Rate limiting** — the Sui RPC may return `Resource limit exceeded`. The `retryWithBackoff` not neccesasry for the localnet but the utility retries up to 5 times automatically. A dedicated RPC provider reduces this significantly.
- **Presign signing latency** — after submitting the sign request, the app polls IKA until the `SignSession` reaches `Completed` state (up to 3 minutes with 3-second intervals).
- **Password = seed key** — the password entered at dWallet creation is used to derive the user's 32-byte root seed key. The same password must be provided again when signing. It is never sent to any server. (For the boilerplate app, I did not add restriction which forces users to put a string password)
- **Direct Sign / Future Sign** — these modes are stubs. Replace the `// TODO` comments in `DirectSignMode.tsx` and `FutureSignMode.tsx` with actual IKA SDK calls.
- **Deposit flow** — also a stub. The UI shows the dWallet's Solana address and balance; the actual deposit call needs to be wired up.
- **Indexer** — the `indexer/` directory is a placeholder. Wiring it up would allow the frontend to query dWallet state without hitting the RPC for every read.
