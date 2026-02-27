"use client";

import { useState } from "react";
import { Box, Button, Callout, Card, Code, Flex, Heading, SegmentedControl, Spinner, Text, TextField } from "@radix-ui/themes";
import { ArrowDownToLineIcon, CheckCircleIcon, ClockIcon, PenLineIcon, TriangleAlertIcon, ZapIcon } from "lucide-react";

type SignMode = "presign" | "direct" | "future";

const SIGN_MODES: { value: SignMode; label: string; icon: React.ReactNode; description: string }[] = [
  {
    value: "presign",
    label: "Presign",
    icon: <PenLineIcon size={13} />,
    description: "Sign the transaction in advance and submit later.",
  },
  {
    value: "direct",
    label: "Direct Sign",
    icon: <ZapIcon size={13} />,
    description: "Sign and submit the transaction immediately.",
  },
  {
    value: "future",
    label: "Future Sign",
    icon: <ClockIcon size={13} />,
    description: "Schedule the transaction to be signed at a future time.",
  },
];

export function DepositSolana() {
  const [signMode, setSignMode] = useState<SignMode>("direct");
  const [address, setAddress] = useState("");
  const [amount, setAmount] = useState("");
  const [scheduleAt, setScheduleAt] = useState("");
  const [pending, setPending] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const activeMode = SIGN_MODES.find((m) => m.value === signMode)!;

  function reset() {
    setTxHash(null);
    setAddress("");
    setAmount("");
    setScheduleAt("");
    setError(null);
  }

  async function handleDeposit() {
    if (!address || !amount) return setError("Please fill in all fields.");
    if (signMode === "future" && !scheduleAt) return setError("Please select a schedule date and time.");
    setPending(true);
    setError(null);
    try {
      // TODO: replace with actual IKA SDK call per signMode
      await new Promise((res) => setTimeout(res, 1800));
      setTxHash(signMode + "_" + Math.random().toString(36).slice(2, 14));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Deposit failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <Card size="3">
      <Flex align="center" gap="2" mb="1">
        <ArrowDownToLineIcon size={16} />
        <Heading size="3">Deposit on Solana</Heading>
      </Flex>
      <Text size="2" color="gray" mb="4" as="p">
        Deposit funds from Solana into your IKA dWallet.
      </Text>

      {txHash ? (
        <Flex direction="column" gap="3">
          <Callout.Root color="green">
            <Callout.Icon><CheckCircleIcon size={16} /></Callout.Icon>
            <Callout.Text>
              {signMode === "presign" && "Transaction presigned successfully"}
              {signMode === "direct" && "Deposit submitted successfully"}
              {signMode === "future" && "Transaction scheduled successfully"}
            </Callout.Text>
          </Callout.Root>
          <Box p="3" style={{ background: "var(--gray-a3)", borderRadius: "var(--radius-3)" }}>
            <Text size="1" color="gray" as="p">
              {signMode === "presign" ? "Presign Hash" : signMode === "future" ? "Schedule ID" : "Transaction"}
            </Text>
            <Code size="1" style={{ wordBreak: "break-all" }}>{txHash}</Code>
          </Box>
          <Button variant="outline" onClick={reset}>
            New Deposit
          </Button>
        </Flex>
      ) : (
        <Flex direction="column" gap="3">
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
            <Text as="label" size="2" weight="medium">Solana Destination Address</Text>
            <TextField.Root placeholder="Enter Solana address" value={address} onChange={(e) => setAddress(e.target.value)} />
          </Flex>
          <Flex direction="column" gap="1">
            <Text as="label" size="2" weight="medium">Amount (SOL)</Text>
            <TextField.Root type="number" placeholder="0.00" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Flex>

          {signMode === "future" && (
            <Flex direction="column" gap="1">
              <Text as="label" size="2" weight="medium">Schedule Date & Time</Text>
              <TextField.Root type="datetime-local" value={scheduleAt} onChange={(e) => setScheduleAt(e.target.value)} />
            </Flex>
          )}

          {error && (
            <Callout.Root color="red">
              <Callout.Icon><TriangleAlertIcon size={16} /></Callout.Icon>
              <Callout.Text>{error}</Callout.Text>
            </Callout.Root>
          )}

          <Button size="3" onClick={handleDeposit} disabled={pending}>
            {pending ? <><Spinner />{activeMode.label === "Future Sign" ? "Scheduling..." : "Depositing..."}</> : `${activeMode.label} & Deposit`}
          </Button>
        </Flex>
      )}
    </Card>
  );
}
