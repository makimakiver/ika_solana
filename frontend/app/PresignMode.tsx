"use client";

import { useEffect, useState } from "react";
import {
  Badge,
  Box,
  Button,
  Callout,
  Card,
  Code,
  Dialog,
  Flex,
  Separator,
  Spinner,
  Text,
  TextField,
} from "@radix-ui/themes";
import {
  CheckCircleIcon,
  PenLineIcon,
  RefreshCw,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react";
import {
  useCurrentAccount,
  useCurrentClient,
  useDAppKit,
} from "@mysten/dapp-kit-react";
import { IkaClient, Curve, publicKeyFromDWalletOutput } from "@ika.xyz/sdk";
import { Connection } from "@solana/web3.js";
import bs58 from "bs58";
import {
  getLocalNetworkConfig,
  deriveRootSeedKeyFromPassword,
  type DepositResult,
} from "./lib/dWallet_utils";
import { createPresign } from "./lib/presign_utils";
import { withdrawWithPresignCap } from "./lib/ika_solana_sign";

const UNVERIFIED_PRESIGN_CAP_TYPE =
  "0x1007eac1b28c288b87995de09fb33846575c7245e1c5a6edf7e15d0ebbb46fd7::coordinator_inner::UnverifiedPresignCap";

interface UnverifiedCap {
  objectId: string;
  json: Record<string, any> | null;
}

async function signSolanaWithPresignCap(_params: {
  presignCapId: string;
  dwalletId: string;
  destinationAddress: string;
  lamports: number;
}): Promise<void> {
  // TODO: implement — build unsigned Solana SOL-transfer, hash the message,
  // call IKA to complete the signature using the presign cap, then broadcast.
}

interface Props {
  selectedDWallet: { capId: string; dwalletId: string };
}

export function PresignMode({ selectedDWallet }: Props) {
  const account = useCurrentAccount();
  const suiClient = useCurrentClient();
  const dAppKit = useDAppKit();

  // ── Create presign state ────────────────────────────────────────────────────
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DepositResult | null>(null);

  // ── Unverified caps list ────────────────────────────────────────────────────
  const [caps, setCaps] = useState<UnverifiedCap[]>([]);
  const [loadingCaps, setLoadingCaps] = useState(false);

  // ── Sign dialog state ───────────────────────────────────────────────────────
  const [signingCap, setSigningCap] = useState<UnverifiedCap | null>(null);
  const [destAddress, setDestAddress] = useState("");
  const [solAmount, setSolAmount] = useState("");
  const [signPassword, setSignPassword] = useState("");
  const [signPending, setSignPending] = useState(false);
  const [signError, setSignError] = useState<string | null>(null);
  const [signDone, setSignDone] = useState(false);
  const [dialogSolanaAddr, setDialogSolanaAddr] = useState<string | null>(null);
  const [dialogBalance, setDialogBalance] = useState<number | null>(null);
  const [loadingBalance, setLoadingBalance] = useState(false);

  // ── Fetch unverified caps ───────────────────────────────────────────────────
  async function fetchCaps() {
    if (!account) return;
    setLoadingCaps(true);
    try {
      const owned = await suiClient.core.listOwnedObjects({
        owner: account.address,
        type: UNVERIFIED_PRESIGN_CAP_TYPE,
        include: { content: true, json: true },
      });
      setCaps(
        owned.objects.map((obj) => ({
          objectId: obj.objectId,
          json: (obj as any).json ?? null,
        })),
      );
    } finally {
      setLoadingCaps(false);
    }
  }

  useEffect(() => {
    fetchCaps();
  }, [account?.address]);

  // ── Balance fetch when dialog opens ────────────────────────────────────────
  async function fetchCapBalance(cap: UnverifiedCap) {
    const dwalletId = (cap.json?.dwallet_id ??
      selectedDWallet.dwalletId) as string;
    setLoadingBalance(true);
    setDialogSolanaAddr(null);
    setDialogBalance(null);
    try {
      const ikaClient = new IkaClient({
        suiClient,
        config: getLocalNetworkConfig(),
      });
      await ikaClient.initialize();
      const dWallet = await ikaClient.getDWallet(dwalletId);
      const publicOutput = dWallet.state?.Active?.public_output as
        | Uint8Array
        | undefined;
      if (!publicOutput) return;
      const pubKeyBytes = await publicKeyFromDWalletOutput(
        Curve.ED25519,
        publicOutput,
      );
      const addr = bs58.encode(pubKeyBytes);
      setDialogSolanaAddr(addr);
      const res = await fetch(
        process.env.NEXT_PUBLIC_SOLANA_RPC_URL ??
          "https://api.devnet.solana.com",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "getBalance",
            params: [addr],
          }),
        },
      );
      const json = await res.json();
      setDialogBalance(json.result?.value ?? null);
    } catch {
      // silent — balance stays null
    } finally {
      setLoadingBalance(false);
    }
  }

  function openDialog(cap: UnverifiedCap) {
    setSigningCap(cap);
    setDestAddress("");
    setSolAmount("");
    setSignError(null);
    setSignDone(false);
    setDialogSolanaAddr(null);
    setDialogBalance(null);
    fetchCapBalance(cap);
  }

  function closeDialog() {
    if (signPending) return;
    setSigningCap(null);
    setSignDone(false);
    setSignError(null);
    setSignPassword("");
  }

  // ── Sign with cap handler ───────────────────────────────────────────────────
  async function handleSign() {
    if (!signingCap || !destAddress || !solAmount || !signPassword || !account) return;
    setSignPending(true);
    setSignError(null);
    try {
      const ikaClient = new IkaClient({ suiClient, config: getLocalNetworkConfig() });
      await ikaClient.initialize();
      const connection = new Connection(
        process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? "https://api.devnet.solana.com",
      );
      const presignId = (signingCap.json?.presign_id ?? signingCap.json?.presignId) as string | undefined;
      if (!presignId) throw new Error("presign_id not found in cap JSON");
      await withdrawWithPresignCap({
        ikaClient,
        suiClient,
        dWalletObjectID: selectedDWallet.dwalletId,
        connection,
        executeTransaction: (tx) =>
          dAppKit.signAndExecuteTransaction({ transaction: tx }),
        signerAddress: account.address,
        rootSeedKey: deriveRootSeedKeyFromPassword(signPassword),
        presignId,
        destinationAddress: destAddress,
        lamports: Math.round(parseFloat(solAmount) * 1e9),
      });
      setSignDone(true);
      await fetchCaps(); // refresh list after signing
    } catch (err) {
      setSignError(err instanceof Error ? err.message : "Signing failed");
    } finally {
      setSignPending(false);
    }
  }

  // ── Create presign handler ──────────────────────────────────────────────────
  async function handleCreatePresign() {
    if (!account) return;
    if (!password) return setError("Please enter a password.");
    setPending(true);
    setError(null);
    setStatus(null);
    try {
      const rootSeedKey = deriveRootSeedKeyFromPassword(password);
      const presignResult = await createPresign({
        senderAddress: account.address,
        suiClient,
        signAndExecuteTransaction: (args) =>
          dAppKit.signAndExecuteTransaction({ transaction: args.transaction }),
        dWalletObjectID: selectedDWallet.dwalletId,
        rootSeedKey,
        onStatus: setStatus,
      });
      setResult({
        transactionDigest: presignResult.transactionDigest,
        presignCapId: presignResult.presignCapId,
      });
      await fetchCaps(); // refresh caps after creating
    } catch (err) {
      setError(err instanceof Error ? err.message : "Presign failed");
    } finally {
      setPending(false);
      setStatus(null);
    }
  }

  // ── Result screen ───────────────────────────────────────────────────────────
  if (result) {
    return (
      <Flex direction="column" gap="3">
        <Callout.Root color="green">
          <Callout.Icon>
            <CheckCircleIcon size={16} />
          </Callout.Icon>
          <Callout.Text>Presign submitted successfully</Callout.Text>
        </Callout.Root>
        <Flex
          direction="column"
          gap="2"
          p="3"
          style={{
            background: "var(--gray-a3)",
            borderRadius: "var(--radius-3)",
          }}
        >
          <Box>
            <Text size="1" color="gray">
              Transaction
            </Text>
            <Code size="1" style={{ wordBreak: "break-all", display: "block" }}>
              {result.transactionDigest}
            </Code>
          </Box>
          {result.presignCapId && (
            <Box>
              <Text size="1" color="gray">
                Presign Cap ID
              </Text>
              <Code
                size="1"
                style={{ wordBreak: "break-all", display: "block" }}
              >
                {result.presignCapId}
              </Code>
            </Box>
          )}
        </Flex>
        <Button
          variant="outline"
          onClick={() => {
            setResult(null);
            setPassword("");
          }}
        >
          Create Another
        </Button>
      </Flex>
    );
  }

  return (
    <>
      {/* ── Sign with presign cap dialog ──────────────────────────────────── */}
      <Dialog.Root
        open={signingCap !== null}
        onOpenChange={(open) => {
          if (!open) closeDialog();
        }}
      >
        <Dialog.Content maxWidth="420px">
          <Dialog.Title>
            <Flex align="center" gap="2">
              <PenLineIcon size={16} />
              Sign Solana Transaction
            </Flex>
          </Dialog.Title>
          <Dialog.Description size="2" color="gray" mb="4">
            Use the selected presign cap to sign and submit a Solana
            transaction.
          </Dialog.Description>

          {signDone ? (
            <Flex direction="column" gap="3">
              <Callout.Root color="green">
                <Callout.Icon>
                  <CheckCircleIcon size={16} />
                </Callout.Icon>
                <Callout.Text>Transaction signed successfully.</Callout.Text>
              </Callout.Root>
              <Box>
                <Text size="1" color="gray">
                  Presign Cap
                </Text>
                <Code
                  size="1"
                  style={{ wordBreak: "break-all", display: "block" }}
                >
                  {signingCap?.objectId}
                </Code>
              </Box>
              <Dialog.Close>
                <Button variant="outline" onClick={closeDialog}>
                  Close
                </Button>
              </Dialog.Close>
            </Flex>
          ) : (
            <Flex direction="column" gap="3">
              {/* Cap info panel */}
              <Box
                p="3"
                style={{
                  background: "var(--amber-a3)",
                  borderRadius: "var(--radius-3)",
                  border: "1px solid var(--amber-a6)",
                }}
              >
                <Flex align="center" gap="2" mb="1">
                  <Badge color="amber" variant="soft">
                    Unverified
                  </Badge>
                  <Text size="1" weight="medium">
                    Presign Cap
                  </Text>
                </Flex>
                <Code
                  size="1"
                  style={{ wordBreak: "break-all", display: "block" }}
                >
                  {signingCap?.objectId}
                </Code>
                {signingCap?.json &&
                  Object.keys(signingCap.json).length > 0 && (
                    <Flex direction="column" gap="1" mt="2">
                      {Object.entries(signingCap.json).map(([key, value]) => (
                        <Box key={key}>
                          <Text size="1" color="gray">
                            {key}
                          </Text>
                          <Code
                            size="1"
                            style={{ wordBreak: "break-all", display: "block" }}
                          >
                            {typeof value === "object"
                              ? JSON.stringify(value)
                              : String(value)}
                          </Code>
                        </Box>
                      ))}
                    </Flex>
                  )}
              </Box>

              <Separator size="4" />

              {/* Transaction fields */}
              <Flex direction="column" gap="1">
                <Text as="label" size="2" weight="medium">
                  Destination Solana Address
                </Text>
                <TextField.Root
                  placeholder="Enter Solana address"
                  value={destAddress}
                  onChange={(e) => setDestAddress(e.target.value)}
                />
              </Flex>
              <Flex direction="column" gap="1">
                <Flex align="center" justify="between">
                  <Text as="label" size="2" weight="medium">
                    Amount (SOL)
                  </Text>
                  {loadingBalance ? (
                    <Flex align="center" gap="1">
                      <Spinner size="1" />
                      <Text size="1" color="gray">
                        Loading balance…
                      </Text>
                    </Flex>
                  ) : dialogBalance !== null ? (
                    <Text size="1" color="gray">
                      Balance:{" "}
                      <strong>{(dialogBalance / 1e9).toFixed(4)} SOL</strong>
                    </Text>
                  ) : null}
                </Flex>
                <TextField.Root
                  type="number"
                  placeholder="0.00"
                  min="0"
                  step="0.01"
                  value={solAmount}
                  onChange={(e) => setSolAmount(e.target.value)}
                />
                {dialogSolanaAddr && (
                  <Text size="1" color="gray">
                    From:{" "}
                    <Code size="1">
                      {dialogSolanaAddr.slice(0, 8)}…
                      {dialogSolanaAddr.slice(-6)}
                    </Code>
                  </Text>
                )}
              </Flex>

              <Flex direction="column" gap="1">
                <Text as="label" size="2" weight="medium">
                  Password
                </Text>
                <TextField.Root
                  type="password"
                  placeholder="Password used to create your dWallet"
                  value={signPassword}
                  onChange={(e) => setSignPassword(e.target.value)}
                />
              </Flex>

              {signError && (
                <Callout.Root color="red">
                  <Callout.Icon>
                    <TriangleAlertIcon size={16} />
                  </Callout.Icon>
                  <Callout.Text>{signError}</Callout.Text>
                </Callout.Root>
              )}

              <Flex gap="2" justify="end">
                <Dialog.Close>
                  <Button
                    variant="outline"
                    color="gray"
                    disabled={signPending}
                    onClick={closeDialog}
                  >
                    <XIcon size={14} /> Cancel
                  </Button>
                </Dialog.Close>
                <Button
                  disabled={signPending || !destAddress || !solAmount || !signPassword}
                  onClick={handleSign}
                >
                  {signPending ? (
                    <>
                      <Spinner />
                      Signing...
                    </>
                  ) : (
                    "Sign Transaction"
                  )}
                </Button>
              </Flex>
            </Flex>
          )}
        </Dialog.Content>
      </Dialog.Root>

      {/* ── Create presign form ───────────────────────────────────────────── */}
      <Flex direction="column" gap="3">
        <Flex direction="column" gap="1">
          <Text as="label" size="2" weight="medium">
            Password
          </Text>
          <TextField.Root
            type="password"
            placeholder="Password used to create your dWallet"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <Text size="1" color="gray">
            Must match the password used when creating the dWallet.
          </Text>
        </Flex>

        {status && (
          <Flex align="center" gap="2">
            <Spinner />
            <Text size="2" color="gray">
              {status}
            </Text>
          </Flex>
        )}

        {error && (
          <Callout.Root color="red">
            <Callout.Icon>
              <TriangleAlertIcon size={16} />
            </Callout.Icon>
            <Callout.Text>{error}</Callout.Text>
          </Callout.Root>
        )}

        <Button
          size="3"
          onClick={handleCreatePresign}
          disabled={pending || !password}
        >
          {pending ? (
            <>
              <Spinner />
              Presigning...
            </>
          ) : (
            "Create Presign"
          )}
        </Button>

        <Separator size="4" />

        {/* ── Unverified caps list ──────────────────────────────────────── */}
        <Flex direction="column" gap="2">
          <Flex align="center" justify="between">
            <Flex align="center" gap="2">
              <PenLineIcon size={14} />
              <Text size="2" weight="medium">
                Select Presign Cap
              </Text>
              <Badge color="gray" variant="soft">
                {caps.length}
              </Badge>
            </Flex>
            <Button
              variant="ghost"
              size="1"
              onClick={fetchCaps}
              disabled={loadingCaps}
            >
              <RefreshCw size={13} />
            </Button>
          </Flex>

          {loadingCaps ? (
            <Flex align="center" gap="2">
              <Spinner />
              <Text size="2" color="gray">
                Loading...
              </Text>
            </Flex>
          ) : caps.length === 0 ? (
            <Text size="2" color="gray">
              No unverified presign caps. Create one above.
            </Text>
          ) : (
            <Flex direction="column" gap="2">
              {caps.map((cap, i) => (
                <Card
                  key={cap.objectId}
                  variant="surface"
                  onClick={() => openDialog(cap)}
                  style={{
                    borderLeft: "4px solid var(--amber-9)",
                    cursor: "pointer",
                    transition: "box-shadow 0.15s",
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLElement).style.boxShadow =
                      "0 0 0 2px var(--amber-8)";
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLElement).style.boxShadow = "none";
                  }}
                >
                  <Flex align="center" justify="between">
                    <Flex align="center" gap="2">
                      <Text size="2" weight="bold">
                        Cap #{i + 1}
                      </Text>
                      <Badge color="amber" variant="soft">
                        Unverified
                      </Badge>
                    </Flex>
                    <Badge
                      color="amber"
                      variant="outline"
                      style={{ pointerEvents: "none" }}
                    >
                      Sign on Solana →
                    </Badge>
                  </Flex>
                  <Code
                    size="1"
                    mt="2"
                    style={{ wordBreak: "break-all", display: "block" }}
                  >
                    {cap.objectId}
                  </Code>
                </Card>
              ))}
            </Flex>
          )}
        </Flex>
      </Flex>
    </>
  );
}
