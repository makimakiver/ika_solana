"use client";

import { useState, useEffect, useRef } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { VersionedTransaction, Transaction } from "@solana/web3.js";
import {
  Badge,
  Box,
  Button,
  Card,
  Flex,
  Heading,
  Select,
  Spinner,
  Text,
  TextField,
} from "@radix-ui/themes";
import {
  ArrowRightIcon,
  CheckCircleIcon,
  CopyIcon,
  RefreshCwIcon,
  XCircleIcon,
} from "lucide-react";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";
const POLL_INTERVAL_MS = 6_000;
const POLL_TIMEOUT_MS = 300_000; // LI.FI can take up to 5 min

type DepositStep =
  | "idle"
  | "quoting"
  | "quoted"
  | "sending"
  | "polling"
  | "done"
  | "failed";

interface DWalletEntry {
  capId: string;
  dwalletId: string;
  isActive: boolean;
  suiAddress: string | null;
}

interface DepositQuote {
  quoteId: string;
  tool: string;
  transactionRequest: { data: string; [key: string]: unknown };
  inputAmount: string;
  outputAmount: string;
  outputAmountMin: string;
  executionDuration: number;
  suiAddress: string;
}

function shorten(s: string) {
  return `${s.slice(0, 6)}...${s.slice(-4)}`;
}

function formatUsdc(baseUnits: string) {
  return (Number(baseUnits) / 1_000_000).toFixed(2);
}

export function LiFiDeposit() {
  const { publicKey, sendTransaction } = useWallet();
  const { connection } = useConnection();

  const [dWallets, setDWallets] = useState<DWalletEntry[]>([]);
  const [loadingDWallets, setLoadingDWallets] = useState(false);
  const [selectedId, setSelectedId] = useState<string>("");
  const [amount, setAmount] = useState("");
  const [step, setStep] = useState<DepositStep>("idle");
  const [quote, setQuote] = useState<DepositQuote | null>(null);
  const [solanaTxId, setSolanaTxId] = useState<string | null>(null);
  const [bridgeStatus, setBridgeStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    fetchDWallets();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  async function fetchDWallets() {
    setLoadingDWallets(true);
    setError(null);
    try {
      const res = await fetch(`${BACKEND_URL}/api/dwallet/list`);
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      const data = await res.json();
      const active: DWalletEntry[] = data.dWallets.filter((d: DWalletEntry) => d.isActive);
      setDWallets(active);
      if (active.length > 0) setSelectedId(active[0].dwalletId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load dWallets");
    } finally {
      setLoadingDWallets(false);
    }
  }

  const selectedDWallet = dWallets.find((d) => d.dwalletId === selectedId) ?? null;

  async function handleGetQuote() {
    if (!selectedDWallet || !publicKey || !amount) return;
    setError(null);
    setStep("quoting");
    try {
      const res = await fetch(`${BACKEND_URL}/api/lifi/deposit-quote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dWalletId: selectedDWallet.dwalletId,
          solanaAddress: publicKey.toBase58(),
          amount,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `Server returned ${res.status}`);
      }
      const data: DepositQuote = await res.json();
      setQuote(data);
      setStep("quoted");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to get quote");
      setStep("idle");
    }
  }

  async function handleSend() {
    if (!quote || !publicKey || !sendTransaction) return;
    setError(null);
    setStep("sending");
    try {
      // LI.FI returns the Solana transaction as base64
      const txBytes = Buffer.from(quote.transactionRequest.data as string, "base64");

      // Try versioned transaction first, fall back to legacy
      let tx: VersionedTransaction | Transaction;
      try {
        tx = VersionedTransaction.deserialize(txBytes);
      } catch {
        tx = Transaction.from(txBytes);
      }

      const signature = await sendTransaction(tx as VersionedTransaction, connection);
      setSolanaTxId(signature);

      setStep("polling");
      startPolling(signature);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Transaction failed");
      setStep("quoted");
    }
  }

  function startPolling(txHash: string) {
    const start = Date.now();
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(
          `${BACKEND_URL}/api/lifi/status?txHash=${encodeURIComponent(txHash)}&fromChain=SOL&toChain=SUI`,
        );
        if (!res.ok) return;
        const data = await res.json();
        setBridgeStatus(data.status);

        const terminal = ["DONE", "FAILED"].includes(data.status);
        const timedOut = Date.now() - start > POLL_TIMEOUT_MS;

        if (terminal || timedOut) {
          clearInterval(pollRef.current!);
          pollRef.current = null;
          setStep(data.status === "DONE" ? "done" : "failed");
        }
      } catch {
        // ignore transient poll errors
      }
    }, POLL_INTERVAL_MS);
  }

  function reset() {
    if (pollRef.current) clearInterval(pollRef.current);
    setStep("idle");
    setQuote(null);
    setSolanaTxId(null);
    setBridgeStatus(null);
    setError(null);
    setAmount("");
  }

  function copyTx() {
    if (!solanaTxId) return;
    navigator.clipboard.writeText(solanaTxId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const busy = step === "quoting";

  return (
    <Card size="3">
      <Flex align="center" gap="2" mb="3">
        <ArrowRightIcon size={16} />
        <Heading size="3">Bridge USDC → Sui</Heading>
        <Badge color="violet" variant="soft">LI.FI</Badge>
      </Flex>

      <Text size="2" color="gray" as="p" mb="4">
        Bridge USDC from your Solana wallet to your dWallet's Sui address via LI.FI.
        Requires mainnet USDC on Solana.
      </Text>

      {(step === "idle" || step === "quoting") && (
        <Flex direction="column" gap="3">
          <Box>
            <Text size="1" color="gray" as="p" mb="1">Destination dWallet</Text>
            {loadingDWallets ? (
              <Flex align="center" gap="2">
                <Spinner size="1" />
                <Text size="2" color="gray">Loading dWallets…</Text>
              </Flex>
            ) : dWallets.length === 0 ? (
              <Flex align="center" gap="2">
                <Text size="2" color="gray">No active dWallets.</Text>
                <Button variant="ghost" size="1" onClick={fetchDWallets}>
                  <RefreshCwIcon size={12} />
                </Button>
              </Flex>
            ) : (
              <Select.Root value={selectedId} onValueChange={setSelectedId}>
                <Select.Trigger style={{ width: "100%" }} />
                <Select.Content>
                  {dWallets.map((d) => (
                    <Select.Item key={d.dwalletId} value={d.dwalletId}>
                      {shorten(d.dwalletId)}
                      {d.suiAddress ? ` → ${shorten(d.suiAddress)}` : ""}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select.Root>
            )}
          </Box>

          <Box>
            <Text size="1" color="gray" as="p" mb="1">Amount (USDC)</Text>
            <TextField.Root
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              disabled={busy}
            />
          </Box>

          <Button
            onClick={handleGetQuote}
            loading={step === "quoting"}
            disabled={busy || !publicKey || !selectedId || !amount || dWallets.length === 0}
          >
            Get Quote
          </Button>

          {error && <Text size="2" color="red" as="p">{error}</Text>}
        </Flex>
      )}

      {step === "quoted" && quote && (
        <Flex direction="column" gap="3">
          <Box
            p="3"
            style={{
              background: "var(--violet-a3)",
              borderRadius: "var(--radius-2)",
              border: "1px solid var(--violet-a6)",
            }}
          >
            <Flex direction="column" gap="2">
              <QuoteRow label="You send" value={`${formatUsdc(quote.inputAmount)} USDC (Solana)`} />
              <QuoteRow label="You receive (min)" value={`${formatUsdc(quote.outputAmountMin)} USDC (Sui)`} />
              <QuoteRow label="Destination" value={shorten(quote.suiAddress)} />
              <QuoteRow label="Bridge" value={quote.tool} />
              <QuoteRow label="Est. time" value={`~${quote.executionDuration}s`} />
            </Flex>
          </Box>

          <Flex gap="2">
            <Button onClick={handleSend} style={{ flex: 1 }}>Send USDC</Button>
            <Button variant="soft" onClick={reset}>Cancel</Button>
          </Flex>

          {error && <Text size="2" color="red" as="p">{error}</Text>}
        </Flex>
      )}

      {step === "sending" && (
        <Flex align="center" gap="2">
          <Spinner />
          <Text size="2" color="gray">Confirm in Phantom…</Text>
        </Flex>
      )}

      {step === "polling" && (
        <Flex direction="column" gap="3">
          <Flex align="center" gap="2">
            <Spinner />
            <Text size="2" color="gray">LI.FI bridge in progress…</Text>
          </Flex>

          {bridgeStatus && (
            <Badge
              color={bridgeStatus === "PENDING" ? "blue" : "gray"}
              variant="soft"
              style={{ width: "fit-content" }}
            >
              {bridgeStatus}
            </Badge>
          )}

          {solanaTxId && (
            <Flex align="center" gap="2">
              <Text size="1" color="gray" style={{ fontFamily: "monospace" }}>
                Solana tx: {shorten(solanaTxId)}
              </Text>
              <Button variant="ghost" size="1" onClick={copyTx}>
                <CopyIcon size={12} />
                {copied ? "Copied!" : "Copy"}
              </Button>
            </Flex>
          )}
        </Flex>
      )}

      {step === "done" && quote && (
        <Flex direction="column" gap="3">
          <Flex align="center" gap="2">
            <CheckCircleIcon size={18} color="var(--green-9)" />
            <Text size="3" weight="bold" color="green">Bridge complete</Text>
          </Flex>
          <Text size="2" color="gray" as="p">
            USDC delivered to{" "}
            <span style={{ fontFamily: "monospace" }}>{shorten(quote.suiAddress)}</span> on Sui.
          </Text>
          {solanaTxId && (
            <Flex align="center" gap="2">
              <Text size="1" color="gray" style={{ fontFamily: "monospace" }}>
                {shorten(solanaTxId)}
              </Text>
              <Button variant="ghost" size="1" onClick={copyTx}>
                <CopyIcon size={12} />
                {copied ? "Copied!" : "Copy"}
              </Button>
            </Flex>
          )}
          <Button variant="soft" onClick={reset}>Bridge again</Button>
        </Flex>
      )}

      {step === "failed" && (
        <Flex direction="column" gap="3">
          <Flex align="center" gap="2">
            <XCircleIcon size={18} color="var(--red-9)" />
            <Text size="3" weight="bold" color="red">Bridge failed</Text>
          </Flex>
          {bridgeStatus && (
            <Text size="2" color="gray" as="p">Status: {bridgeStatus}</Text>
          )}
          <Button variant="soft" onClick={reset}>Try again</Button>
        </Flex>
      )}
    </Card>
  );
}

function QuoteRow({ label, value }: { label: string; value: string }) {
  return (
    <Flex justify="between" align="center">
      <Text size="2" color="gray">{label}</Text>
      <Text size="2" weight="medium">{value}</Text>
    </Flex>
  );
}
