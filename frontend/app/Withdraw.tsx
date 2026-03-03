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
  Heading,
  Select,
  SegmentedControl,
  Separator,
  Spinner,
  Text,
  TextField,
} from "@radix-ui/themes";
import {
  ArrowUpFromLineIcon,
  CheckCircleIcon,
  ClockIcon,
  PenLineIcon,
  RefreshCw,
  TriangleAlertIcon,
  XIcon,
  ZapIcon,
} from "lucide-react";
import {
  useCurrentAccount,
  useCurrentClient,
  useDAppKit,
} from "@mysten/dapp-kit-react";
import { IkaClient } from "@ika.xyz/sdk";
import ikaConfigJson from "../ika_config.json";
import {
  getLocalNetworkConfig,
  type DepositResult,
  deriveRootSeedKeyFromPassword,
} from "./lib/dWallet_utils";
import { createPresign } from "./lib/presign_utils";

const UNVERIFIED_PRESIGN_CAP_TYPE =
  "0x1007eac1b28c288b87995de09fb33846575c7245e1c5a6edf7e15d0ebbb46fd7::coordinator_inner::UnverifiedPresignCap";

interface UnverifiedCap {
  objectId: string;
  json: Record<string, any> | null;
}

async function withdrawWithDirectSign(_params: any): Promise<DepositResult> {
  return { transactionDigest: "" };
}
async function withdrawWithFutureSign(_params: any): Promise<DepositResult> {
  return { transactionDigest: "" };
}
async function signSolanaWithPresignCap(_params: any): Promise<void> {
  // TODO: implement Solana signing with presign cap
}

type SignMode = "presign" | "direct" | "future";

const SIGN_MODES: {
  value: SignMode;
  label: string;
  icon: React.ReactNode;
  description: string;
}[] = [
  {
    value: "presign",
    label: "Presign",
    icon: <PenLineIcon size={13} />,
    description: "Pre-compute part of the signature now; finalize withdrawal later.",
  },
  {
    value: "direct",
    label: "Direct Sign",
    icon: <ZapIcon size={13} />,
    description: "Sign and submit the withdrawal transaction immediately.",
  },
  {
    value: "future",
    label: "Future Sign",
    icon: <ClockIcon size={13} />,
    description: "Create a partial signature commitment to complete at a future time.",
  },
];

interface DWalletOption {
  capId: string;
  dwalletId: string;
}

export function Withdraw() {
  const account = useCurrentAccount();
  const suiClient = useCurrentClient();
  const dAppKit = useDAppKit();

  const [signMode, setSignMode] = useState<SignMode>("direct");
  const [address, setAddress] = useState("");
  const [amount, setAmount] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [result, setResult] = useState<DepositResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [dwallets, setDwallets] = useState<DWalletOption[]>([]);
  const [selectedDWallet, setSelectedDWallet] = useState<DWalletOption | null>(null);
  const [loadingDWallets, setLoadingDWallets] = useState(false);

  const [unverifiedCaps, setUnverifiedCaps] = useState<UnverifiedCap[]>([]);
  const [loadingCaps, setLoadingCaps] = useState(false);

  // Dialog state
  const [signingCap, setSigningCap] = useState<UnverifiedCap | null>(null);
  const [solanaAddress, setSolanaAddress] = useState("");
  const [solanaAmount, setSolanaAmount] = useState("");
  const [signPending, setSignPending] = useState(false);
  const [signError, setSignError] = useState<string | null>(null);
  const [signDone, setSignDone] = useState(false);

  const activeMode = SIGN_MODES.find((m) => m.value === signMode)!;

  useEffect(() => {
    if (!account) return;
    setLoadingDWallets(true);
    suiClient.core
      .listOwnedObjects({
        owner: account.address,
        type: `${ikaConfigJson.packages.ika_dwallet_2pc_mpc_package_id}::coordinator_inner::DWalletCap`,
        include: { content: true, json: true },
      })
      .then(async (owned) => {
        const ikaClient = new IkaClient({ suiClient, config: getLocalNetworkConfig() });
        await ikaClient.initialize();
        const results: DWalletOption[] = [];
        for (const obj of owned.objects) {
          const cap = await suiClient.core.getObject({
            objectId: obj.objectId,
            include: { json: true },
          });
          const dwalletId = cap.object?.json?.dwallet_id as string | undefined;
          if (!dwalletId) continue;
          try {
            const dWallet = await ikaClient.getDWallet(dwalletId);
            if (dWallet.state?.$kind === "Active") {
              results.push({ capId: obj.objectId, dwalletId });
            }
          } catch {
            // skip dWallets that can't be fetched
          }
        }
        setDwallets(results);
        if (results.length > 0) setSelectedDWallet(results[0]);
      })
      .finally(() => setLoadingDWallets(false));
  }, [account?.address]);

  async function fetchUnverifiedCaps() {
    if (!account) return;
    setLoadingCaps(true);
    try {
      const owned = await suiClient.core.listOwnedObjects({
        owner: account.address,
        type: UNVERIFIED_PRESIGN_CAP_TYPE,
        include: { content: true, json: true },
      });
      setUnverifiedCaps(
        owned.objects.map((obj) => ({
          objectId: obj.objectId,
          json: (obj as any).json ?? null,
        }))
      );
    } finally {
      setLoadingCaps(false);
    }
  }

  useEffect(() => {
    if (signMode === "presign") fetchUnverifiedCaps();
  }, [account?.address, signMode]);

  function openSignDialog(cap: UnverifiedCap) {
    setSigningCap(cap);
    setSolanaAddress("");
    setSolanaAmount("");
    setSignError(null);
    setSignDone(false);
  }

  function closeSignDialog() {
    if (signPending) return;
    setSigningCap(null);
    setSignDone(false);
    setSignError(null);
  }

  async function handleSignWithCap() {
    if (!signingCap || !solanaAddress || !solanaAmount) return;
    setSignPending(true);
    setSignError(null);
    try {
      await signSolanaWithPresignCap({
        presignCapId: signingCap.objectId,
        solanaAddress,
        solanaAmount,
      });
      setSignDone(true);
    } catch (err) {
      setSignError(err instanceof Error ? err.message : "Signing failed");
    } finally {
      setSignPending(false);
    }
  }

  function reset() {
    setResult(null);
    setAddress("");
    setAmount("");
    setPassword("");
    setError(null);
    setStatus(null);
  }

  async function handleWithdraw() {
    if (!account || !selectedDWallet) return setError("Please select a dWallet.");
    if (signMode === "presign") {
      if (!password) return setError("Please enter a password.");
    } else {
      if (!address || !amount) return setError("Please fill in all fields.");
    }

    setPending(true);
    setError(null);
    setStatus(null);

    try {
      let withdrawResult: DepositResult;

      if (signMode === "presign") {
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
        withdrawResult = {
          transactionDigest: presignResult.transactionDigest,
          presignCapId: presignResult.presignCapId,
        };
      } else {
        const message = new TextEncoder().encode(`${address}:${amount}`);
        if (signMode === "direct") {
          withdrawResult = await withdrawWithDirectSign({
            senderAddress: account.address,
            suiClient,
            signAndExecuteTransaction: (args: { transaction: any }) =>
              dAppKit.signAndExecuteTransaction({ transaction: args.transaction }),
            dWalletCapId: selectedDWallet.capId,
            dWalletId: selectedDWallet.dwalletId,
            message,
            onStatus: setStatus,
          });
        } else {
          withdrawResult = await withdrawWithFutureSign({
            senderAddress: account.address,
            suiClient,
            signAndExecuteTransaction: (args: { transaction: any }) =>
              dAppKit.signAndExecuteTransaction({ transaction: args.transaction }),
            dWalletCapId: selectedDWallet.capId,
            dWalletId: selectedDWallet.dwalletId,
            message,
            onStatus: setStatus,
          });
        }
      }

      setResult(withdrawResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Withdrawal failed");
    } finally {
      setPending(false);
      setStatus(null);
    }
  }

  return (
    <>
      {/* ── Sign with Presign Cap Dialog ── */}
      <Dialog.Root open={signingCap !== null} onOpenChange={(open) => { if (!open) closeSignDialog(); }}>
        <Dialog.Content maxWidth="420px">
          <Dialog.Title>
            <Flex align="center" gap="2">
              <PenLineIcon size={16} />
              Sign Solana Transaction
            </Flex>
          </Dialog.Title>
          <Dialog.Description size="2" color="gray" mb="4">
            Use the selected presign cap to sign and submit a Solana transaction.
          </Dialog.Description>

          {signDone ? (
            <Flex direction="column" gap="3">
              <Callout.Root color="green">
                <Callout.Icon><CheckCircleIcon size={16} /></Callout.Icon>
                <Callout.Text>Transaction signed successfully.</Callout.Text>
              </Callout.Root>
              <Box>
                <Text size="1" color="gray">Presign Cap</Text>
                <Code size="1" style={{ wordBreak: "break-all", display: "block" }}>
                  {signingCap?.objectId}
                </Code>
              </Box>
              <Dialog.Close>
                <Button variant="outline" onClick={closeSignDialog}>Close</Button>
              </Dialog.Close>
            </Flex>
          ) : (
            <Flex direction="column" gap="3">
              {/* Cap info */}
              <Box p="3" style={{ background: "var(--amber-a3)", borderRadius: "var(--radius-3)", border: "1px solid var(--amber-a6)" }}>
                <Flex align="center" gap="2" mb="1">
                  <Badge color="amber" variant="soft">Unverified</Badge>
                  <Text size="1" weight="medium">Presign Cap</Text>
                </Flex>
                <Code size="1" style={{ wordBreak: "break-all", display: "block" }}>
                  {signingCap?.objectId}
                </Code>
                {signingCap?.json && Object.keys(signingCap.json).length > 0 && (
                  <Flex direction="column" gap="1" mt="2">
                    {Object.entries(signingCap.json).map(([key, value]) => (
                      <Box key={key}>
                        <Text size="1" color="gray">{key}</Text>
                        <Code size="1" style={{ wordBreak: "break-all", display: "block" }}>
                          {typeof value === "object" ? JSON.stringify(value) : String(value)}
                        </Code>
                      </Box>
                    ))}
                  </Flex>
                )}
              </Box>

              <Separator size="4" />

              {/* Transaction fields */}
              <Flex direction="column" gap="1">
                <Text as="label" size="2" weight="medium">Destination Solana Address</Text>
                <TextField.Root
                  placeholder="Enter Solana address"
                  value={solanaAddress}
                  onChange={(e) => setSolanaAddress(e.target.value)}
                />
              </Flex>
              <Flex direction="column" gap="1">
                <Text as="label" size="2" weight="medium">Amount (SOL)</Text>
                <TextField.Root
                  type="number"
                  placeholder="0.00"
                  min="0"
                  step="0.01"
                  value={solanaAmount}
                  onChange={(e) => setSolanaAmount(e.target.value)}
                />
              </Flex>

              {signError && (
                <Callout.Root color="red">
                  <Callout.Icon><TriangleAlertIcon size={16} /></Callout.Icon>
                  <Callout.Text>{signError}</Callout.Text>
                </Callout.Root>
              )}

              <Flex gap="2" justify="end">
                <Dialog.Close>
                  <Button variant="outline" color="gray" disabled={signPending} onClick={closeSignDialog}>
                    <XIcon size={14} /> Cancel
                  </Button>
                </Dialog.Close>
                <Button
                  disabled={signPending || !solanaAddress || !solanaAmount}
                  onClick={handleSignWithCap}
                >
                  {signPending ? <><Spinner />Signing...</> : "Sign Transaction"}
                </Button>
              </Flex>
            </Flex>
          )}
        </Dialog.Content>
      </Dialog.Root>

      {/* ── Main Card ── */}
      <Card size="3">
        <Flex align="center" gap="2" mb="1">
          <ArrowUpFromLineIcon size={16} />
          <Heading size="3">Withdraw</Heading>
        </Flex>
        <Text size="2" color="gray" mb="4" as="p">
          Withdraw funds from your IKA dWallet to a Solana address.
        </Text>

        {result ? (
          <Flex direction="column" gap="3">
            <Callout.Root color="green">
              <Callout.Icon><CheckCircleIcon size={16} /></Callout.Icon>
              <Callout.Text>
                {signMode === "presign" && "Presign submitted successfully"}
                {signMode === "direct" && "Withdrawal signed and submitted"}
                {signMode === "future" && "Future sign commitment created"}
              </Callout.Text>
            </Callout.Root>
            <Flex direction="column" gap="2" p="3" style={{ background: "var(--gray-a3)", borderRadius: "var(--radius-3)" }}>
              <Box>
                <Text size="1" color="gray">Transaction</Text>
                <Code size="1" style={{ wordBreak: "break-all", display: "block" }}>
                  {result.transactionDigest}
                </Code>
              </Box>
              {result.presignCapId && (
                <Box>
                  <Text size="1" color="gray">Presign Cap ID</Text>
                  <Code size="1" style={{ wordBreak: "break-all", display: "block" }}>
                    {result.presignCapId}
                  </Code>
                </Box>
              )}
              {result.signId && (
                <Box>
                  <Text size="1" color="gray">Sign Session ID</Text>
                  <Code size="1" style={{ wordBreak: "break-all", display: "block" }}>
                    {result.signId}
                  </Code>
                </Box>
              )}
              {result.futureSignCapId && (
                <Box>
                  <Text size="1" color="gray">Future Sign Cap ID</Text>
                  <Code size="1" style={{ wordBreak: "break-all", display: "block" }}>
                    {result.futureSignCapId}
                  </Code>
                </Box>
              )}
            </Flex>
            <Button variant="outline" onClick={reset}>
              New Withdrawal
            </Button>
          </Flex>
        ) : (
          <Flex direction="column" gap="3">
            {/* dWallet selector */}
            <Flex direction="column" gap="1">
              <Text size="2" weight="medium">dWallet</Text>
              {loadingDWallets ? (
                <Flex align="center" gap="2">
                  <Spinner />
                  <Text size="2" color="gray">Loading dWallets...</Text>
                </Flex>
              ) : dwallets.length === 0 ? (
                <Text size="2" color="amber">No dWallets found. Create one first.</Text>
              ) : (
                <Select.Root
                  value={selectedDWallet?.capId ?? ""}
                  onValueChange={(capId) =>
                    setSelectedDWallet(dwallets.find((d) => d.capId === capId) ?? null)
                  }
                >
                  <Select.Trigger style={{ width: "100%" }} />
                  <Select.Content>
                    {dwallets.map((d, i) => (
                      <Select.Item key={d.capId} value={d.capId}>
                        dWallet #{i + 1} — {d.capId.slice(0, 10)}…
                      </Select.Item>
                    ))}
                  </Select.Content>
                </Select.Root>
              )}
            </Flex>

            {/* Signing mode */}
            <Flex direction="column" gap="2">
              <Text size="2" weight="medium">Signing Method</Text>
              <SegmentedControl.Root
                value={signMode}
                onValueChange={(v) => { setSignMode(v as SignMode); setError(null); setPassword(""); }}
                style={{ width: "100%" }}
              >
                {SIGN_MODES.map((mode) => (
                  <SegmentedControl.Item key={mode.value} value={mode.value}>
                    <Flex align="center" gap="1">
                      {mode.icon}
                      {mode.label}
                    </Flex>
                  </SegmentedControl.Item>
                ))}
              </SegmentedControl.Root>
              <Text size="1" color="gray">{activeMode.description}</Text>
            </Flex>

            {signMode === "presign" ? (
              <Flex direction="column" gap="3">
                {/* Create new presign */}
                <Flex direction="column" gap="1">
                  <Text as="label" size="2" weight="medium">Password</Text>
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
                    <Text size="2" color="gray">{status}</Text>
                  </Flex>
                )}

                {error && (
                  <Callout.Root color="red">
                    <Callout.Icon><TriangleAlertIcon size={16} /></Callout.Icon>
                    <Callout.Text>{error}</Callout.Text>
                  </Callout.Root>
                )}

                <Button
                  size="3"
                  onClick={handleWithdraw}
                  disabled={pending || dwallets.length === 0 || !password}
                >
                  {pending ? <><Spinner />Presigning...</> : "Create Presign"}
                </Button>

                <Separator size="4" />

                {/* Unverified presign caps */}
                <Flex direction="column" gap="2">
                  <Flex align="center" justify="between">
                    <Flex align="center" gap="2">
                      <PenLineIcon size={14} />
                      <Text size="2" weight="medium">Unverified Presign Caps</Text>
                      <Badge color="gray" variant="soft">{unverifiedCaps.length}</Badge>
                    </Flex>
                    <Button variant="ghost" size="1" onClick={fetchUnverifiedCaps} disabled={loadingCaps}>
                      <RefreshCw size={13} />
                    </Button>
                  </Flex>

                  {loadingCaps ? (
                    <Flex align="center" gap="2">
                      <Spinner />
                      <Text size="2" color="gray">Loading...</Text>
                    </Flex>
                  ) : unverifiedCaps.length === 0 ? (
                    <Text size="2" color="gray">No unverified presign caps. Create a presign above.</Text>
                  ) : (
                    <Flex direction="column" gap="2">
                      {unverifiedCaps.map((cap, i) => (
                        <Card
                          key={cap.objectId}
                          variant="surface"
                          onClick={() => openSignDialog(cap)}
                          style={{
                            borderLeft: "4px solid var(--amber-9)",
                            cursor: "pointer",
                            transition: "box-shadow 0.15s",
                          }}
                          onMouseEnter={(e) => {
                            (e.currentTarget as HTMLElement).style.boxShadow = "0 0 0 2px var(--amber-8)";
                          }}
                          onMouseLeave={(e) => {
                            (e.currentTarget as HTMLElement).style.boxShadow = "none";
                          }}
                        >
                          <Flex align="center" justify="between">
                            <Flex align="center" gap="2">
                              <Text size="2" weight="bold">Cap #{i + 1}</Text>
                              <Badge color="amber" variant="soft">Unverified</Badge>
                            </Flex>
                            <Badge color="amber" variant="outline" style={{ pointerEvents: "none" }}>
                              Sign on Solana →
                            </Badge>
                          </Flex>
                          <Code size="1" mt="2" style={{ wordBreak: "break-all", display: "block" }}>
                            {cap.objectId}
                          </Code>
                        </Card>
                      ))}
                    </Flex>
                  )}
                </Flex>
              </Flex>
            ) : (
              <>
                <Flex direction="column" gap="1">
                  <Text as="label" size="2" weight="medium">Destination Solana Address</Text>
                  <TextField.Root
                    placeholder="Enter Solana address"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                  />
                </Flex>
                <Flex direction="column" gap="1">
                  <Text as="label" size="2" weight="medium">Amount (SOL)</Text>
                  <TextField.Root
                    type="number"
                    placeholder="0.00"
                    min="0"
                    step="0.01"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                  />
                </Flex>
              </>
            )}

            {signMode !== "presign" && (
              <>
                {status && (
                  <Flex align="center" gap="2">
                    <Spinner />
                    <Text size="2" color="gray">{status}</Text>
                  </Flex>
                )}

                {error && (
                  <Callout.Root color="red">
                    <Callout.Icon><TriangleAlertIcon size={16} /></Callout.Icon>
                    <Callout.Text>{error}</Callout.Text>
                  </Callout.Root>
                )}

                <Button
                  size="3"
                  onClick={handleWithdraw}
                  disabled={pending || dwallets.length === 0}
                >
                  {pending ? (
                    <>
                      <Spinner />
                      {signMode === "future" ? "Creating future sign..." : "Withdrawing..."}
                    </>
                  ) : (
                    `${activeMode.label} & Withdraw`
                  )}
                </Button>
              </>
            )}
          </Flex>
        )}
      </Card>
    </>
  );
}
