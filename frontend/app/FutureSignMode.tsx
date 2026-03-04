"use client";

import { useState } from "react";
import {
  Box,
  Button,
  Callout,
  Code,
  Flex,
  Spinner,
  Text,
  TextField,
} from "@radix-ui/themes";
import { CheckCircleIcon, TriangleAlertIcon } from "lucide-react";
import {
  useCurrentAccount,
  useCurrentClient,
  useDAppKit,
} from "@mysten/dapp-kit-react";
import type { DepositResult } from "./lib/dWallet_utils";

async function withdrawWithFutureSign(_params: {
  senderAddress: string;
  suiClient: any;
  signAndExecuteTransaction: (args: { transaction: any }) => Promise<unknown>;
  dWalletCapId: string;
  dWalletId: string;
  destinationAddress: string;
  lamports: number;
  onStatus?: (msg: string) => void;
}): Promise<DepositResult> {
  // TODO: implement — see future_sign_utils.ts for the full design.
  return { transactionDigest: "" };
}

interface Props {
  selectedDWallet: { capId: string; dwalletId: string };
}

export function FutureSignMode({ selectedDWallet }: Props) {
  const account = useCurrentAccount();
  const suiClient = useCurrentClient();
  const dAppKit = useDAppKit();

  const [address, setAddress] = useState("");
  const [amount, setAmount] = useState("");
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DepositResult | null>(null);

  async function handleWithdraw() {
    if (!account) return;
    if (!address || !amount) return setError("Please fill in all fields.");
    setPending(true);
    setError(null);
    setStatus(null);
    try {
      const withdrawResult = await withdrawWithFutureSign({
        senderAddress: account.address,
        suiClient,
        signAndExecuteTransaction: (args) =>
          dAppKit.signAndExecuteTransaction({ transaction: args.transaction }),
        dWalletCapId: selectedDWallet.capId,
        dWalletId: selectedDWallet.dwalletId,
        destinationAddress: address,
        lamports: Math.round(parseFloat(amount) * 1e9),
        onStatus: setStatus,
      });
      setResult(withdrawResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Future sign failed");
    } finally {
      setPending(false);
      setStatus(null);
    }
  }

  if (result) {
    return (
      <Flex direction="column" gap="3">
        <Callout.Root color="green">
          <Callout.Icon><CheckCircleIcon size={16} /></Callout.Icon>
          <Callout.Text>Future sign commitment created</Callout.Text>
        </Callout.Root>
        <Flex direction="column" gap="2" p="3" style={{ background: "var(--gray-a3)", borderRadius: "var(--radius-3)" }}>
          <Box>
            <Text size="1" color="gray">Transaction</Text>
            <Code size="1" style={{ wordBreak: "break-all", display: "block" }}>{result.transactionDigest}</Code>
          </Box>
          {result.futureSignCapId && (
            <Box>
              <Text size="1" color="gray">Future Sign Cap ID</Text>
              <Code size="1" style={{ wordBreak: "break-all", display: "block" }}>{result.futureSignCapId}</Code>
            </Box>
          )}
        </Flex>
        <Button variant="outline" onClick={() => { setResult(null); setAddress(""); setAmount(""); }}>
          New Future Sign
        </Button>
      </Flex>
    );
  }

  return (
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

      <Button size="3" onClick={handleWithdraw} disabled={pending}>
        {pending ? <><Spinner />Creating future sign...</> : "Future Sign & Withdraw"}
      </Button>
    </Flex>
  );
}
