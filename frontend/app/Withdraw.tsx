"use client";

import { useEffect, useState } from "react";
import {
  Box,
  Button,
  Callout,
  Card,
  Code,
  Flex,
  Heading,
  Select,
  SegmentedControl,
  Spinner,
  Text,
  TextField,
} from "@radix-ui/themes";
import {
  ArrowUpFromLineIcon,
  CheckCircleIcon,
  ClockIcon,
  PenLineIcon,
  TriangleAlertIcon,
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
  depositWithPresign,
  depositWithDirectSign,
  depositWithFutureSign,
  getLocalNetworkConfig,
  type DepositResult,
} from "./lib/dWallet_utils";

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
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [result, setResult] = useState<DepositResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [dwallets, setDwallets] = useState<DWalletOption[]>([]);
  const [selectedDWallet, setSelectedDWallet] = useState<DWalletOption | null>(null);
  const [loadingDWallets, setLoadingDWallets] = useState(false);

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

  function reset() {
    setResult(null);
    setAddress("");
    setAmount("");
    setError(null);
    setStatus(null);
  }

  async function handleWithdraw() {
    if (!account || !selectedDWallet) return setError("Please select a dWallet.");
    if (!address || !amount) return setError("Please fill in all fields.");

    setPending(true);
    setError(null);
    setStatus(null);

    const message = new TextEncoder().encode(`${address}:${amount}`);

    const params = {
      senderAddress: account.address,
      suiClient,
      signAndExecuteTransaction: (args: { transaction: any }) =>
        dAppKit.signAndExecuteTransaction({ transaction: args.transaction }),
      dWalletCapId: selectedDWallet.capId,
      dWalletId: selectedDWallet.dwalletId,
      message,
      onStatus: setStatus,
    };

    try {
      let withdrawResult: DepositResult;
      if (signMode === "presign") {
        withdrawResult = await depositWithPresign(params);
      } else if (signMode === "direct") {
        withdrawResult = await depositWithDirectSign(params);
      } else {
        withdrawResult = await depositWithFutureSign(params);
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
            <Callout.Icon>
              <CheckCircleIcon size={16} />
            </Callout.Icon>
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
              onValueChange={(v) => { setSignMode(v as SignMode); setError(null); }}
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
                {signMode === "presign"
                  ? "Presigning..."
                  : signMode === "future"
                    ? "Creating future sign..."
                    : "Withdrawing..."}
              </>
            ) : (
              `${activeMode.label} & Withdraw`
            )}
          </Button>
        </Flex>
      )}
    </Card>
  );
}
