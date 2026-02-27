"use client";

import { useState } from "react";
import { Box, Button, Callout, Card, Code, Flex, Heading, Spinner, Text, TextField } from "@radix-ui/themes";
import { ArrowUpFromLineIcon, CheckCircleIcon, TriangleAlertIcon } from "lucide-react";

export function Withdraw() {
  const [address, setAddress] = useState("");
  const [amount, setAmount] = useState("");
  const [pending, setPending] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleWithdraw() {
    if (!address || !amount) return setError("Please fill in all fields.");
    setPending(true);
    setError(null);
    try {
      // TODO: replace with actual IKA SDK withdraw call
      await new Promise((res) => setTimeout(res, 1800));
      setTxHash("withdraw_" + Math.random().toString(36).slice(2, 14));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Withdrawal failed");
    } finally {
      setPending(false);
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

      {txHash ? (
        <Flex direction="column" gap="3">
          <Callout.Root color="green">
            <Callout.Icon><CheckCircleIcon size={16} /></Callout.Icon>
            <Callout.Text>Withdrawal submitted successfully</Callout.Text>
          </Callout.Root>
          <Box p="3" style={{ background: "var(--gray-a3)", borderRadius: "var(--radius-3)" }}>
            <Text size="1" color="gray" as="p">Transaction</Text>
            <Code size="1" style={{ wordBreak: "break-all" }}>{txHash}</Code>
          </Box>
          <Button variant="outline" onClick={() => { setTxHash(null); setAddress(""); setAmount(""); }}>
            New Withdrawal
          </Button>
        </Flex>
      ) : (
        <Flex direction="column" gap="3">
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
          {error && (
            <Callout.Root color="red">
              <Callout.Icon><TriangleAlertIcon size={16} /></Callout.Icon>
              <Callout.Text>{error}</Callout.Text>
            </Callout.Root>
          )}
          <Button size="3" onClick={handleWithdraw} disabled={pending}>
            {pending ? <><Spinner />Withdrawing...</> : "Withdraw Funds"}
          </Button>
        </Flex>
      )}
    </Card>
  );
}
