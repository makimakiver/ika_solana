"use client";

import { useEffect, useState } from "react";
import {
  Badge,
  Box,
  Button,
  Card,
  Flex,
  Heading,
  Spinner,
  Text,
} from "@radix-ui/themes";
import { ArrowDownToLineIcon, CopyIcon, RefreshCwIcon, CheckCircleIcon } from "lucide-react";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";
const SUI_TESTNET_RPC = "https://fullnode.testnet.sui.io:443";
const SUI_MAINNET_RPC = "https://fullnode.mainnet.sui.io:443";
const USDC_MAINNET = "0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC";

interface DWalletEntry {
  capId: string;
  dwalletId: string;
  isActive: boolean;
  suiAddress: string | null;
}

interface Balances {
  suiTestnet: string;
  suiMainnet: string;
  usdcMainnet: string;
}

function shorten(s: string) {
  return `${s.slice(0, 6)}...${s.slice(-4)}`;
}

async function getBalance(rpc: string, address: string, coinType: string): Promise<bigint> {
  const res = await fetch(rpc, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "suix_getBalance",
      params: [address, coinType],
    }),
  });
  const data = await res.json();
  return BigInt(data.result?.totalBalance ?? "0");
}

async function fetchBalances(address: string): Promise<Balances> {
  const [suiTestnetMist, suiMainnetMist, usdcMainnetRaw] = await Promise.all([
    getBalance(SUI_TESTNET_RPC, address, "0x2::sui::SUI").catch(() => 0n),
    getBalance(SUI_MAINNET_RPC, address, "0x2::sui::SUI").catch(() => 0n),
    getBalance(SUI_MAINNET_RPC, address, USDC_MAINNET).catch(() => 0n),
  ]);
  return {
    suiTestnet: (Number(suiTestnetMist) / 1_000_000_000).toFixed(4),
    suiMainnet: (Number(suiMainnetMist) / 1_000_000_000).toFixed(4),
    usdcMainnet: (Number(usdcMainnetRaw) / 1_000_000).toFixed(2),
  };
}

export function SolanaDeposit() {
  const [dWallets, setDWallets] = useState<DWalletEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [depositing, setDepositing] = useState<string | null>(null);
  const [depositResult, setDepositResult] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState<string | null>(null);
  const [balances, setBalances] = useState<Record<string, Balances>>({});

  async function fetchDWallets() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${BACKEND_URL}/api/dwallet/list`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `Server returned ${res.status}`);
      }
      const data = await res.json();
      const active: DWalletEntry[] = data.dWallets.filter((d: DWalletEntry) => d.isActive);
      setDWallets(active);
      const entries = await Promise.all(
        active.map(async (d) => {
          if (!d.suiAddress) return [d.dwalletId, { suiTestnet: "0.0000", suiMainnet: "0.0000", usdcMainnet: "0.00" }] as const;
          const bals = await fetchBalances(d.suiAddress).catch(() => ({ suiTestnet: "—", suiMainnet: "—", usdcMainnet: "—" }));
          return [d.dwalletId, bals] as const;
        }),
      );
      setBalances(Object.fromEntries(entries));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load dWallets");
    } finally {
      setLoading(false);
    }
  }

  async function handleDeposit(entry: DWalletEntry) {
    setDepositing(entry.dwalletId);
    setError(null);
    try {
      const res = await fetch(`${BACKEND_URL}/api/deposit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dWalletId: entry.dwalletId, capId: entry.capId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `Server returned ${res.status}`);
      }
      const data = await res.json();
      setDepositResult((prev) => ({ ...prev, [entry.dwalletId]: data.digest }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Deposit failed");
    } finally {
      setDepositing(null);
    }
  }

  function copy(text: string, key: string) {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  }

  useEffect(() => {
    fetchDWallets();
  }, []);

  return (
    <Card size="3">
      <Flex align="center" justify="between" mb="3">
        <Flex align="center" gap="2">
          <ArrowDownToLineIcon size={16} />
          <Heading size="3">Deposit</Heading>
          <Badge color="gray" variant="soft">{dWallets.length}</Badge>
        </Flex>
        <Button variant="ghost" size="1" onClick={fetchDWallets} disabled={loading}>
          <RefreshCwIcon size={14} />
        </Button>
      </Flex>

      <Text size="2" color="gray" as="p" mb="3">
        Select a dWallet to deposit into.
      </Text>

      {loading ? (
        <Flex align="center" gap="2">
          <Spinner />
          <Text size="2" color="gray">Loading dWallets...</Text>
        </Flex>
      ) : error ? (
        <Text size="2" color="red">{error}</Text>
      ) : dWallets.length === 0 ? (
        <Text size="2" color="gray">No active dWallets. Create one first.</Text>
      ) : (
        <Flex direction="column" gap="3">
          {dWallets.map((entry) => {
            const txDigest = depositResult[entry.dwalletId];
            const bals = balances[entry.dwalletId];

            return (
              <Card key={entry.capId} variant="surface">
                <Flex direction="column" gap="2">
                  <Flex align="center" justify="between">
                    <Text size="2" weight="bold">{shorten(entry.dwalletId)}</Text>
                    <Badge color="green" variant="soft">Active</Badge>
                  </Flex>

                  {entry.suiAddress && (
                    <Box
                      p="2"
                      style={{
                        background: "var(--blue-a3)",
                        borderRadius: "var(--radius-2)",
                        border: "1px solid var(--blue-a6)",
                      }}
                    >
                      <Flex align="center" justify="between" mb="1">
                        <Text size="1" color="blue">Sui address</Text>
                        <Button
                          variant="ghost"
                          size="1"
                          onClick={() => copy(entry.suiAddress!, `sui-${entry.capId}`)}
                          style={{ flexShrink: 0 }}
                        >
                          <CopyIcon size={12} />
                          {copied === `sui-${entry.capId}` ? "Copied!" : "Copy"}
                        </Button>
                      </Flex>
                      <Text size="1" style={{ fontFamily: "monospace", color: "var(--gray-12)" }}>
                        {shorten(entry.suiAddress)}
                      </Text>
                      {bals && (
                        <Flex gap="3" mt="2">
                          <Flex direction="column">
                            <Text size="1" color="gray">SUI (testnet)</Text>
                            <Text size="1" weight="medium">{bals.suiTestnet}</Text>
                          </Flex>
                          <Flex direction="column">
                            <Text size="1" color="gray">SUI (mainnet)</Text>
                            <Text size="1" weight="medium">{bals.suiMainnet}</Text>
                          </Flex>
                          <Flex direction="column">
                            <Text size="1" color="gray">USDC (mainnet)</Text>
                            <Text size="1" weight="medium">{bals.usdcMainnet}</Text>
                          </Flex>
                        </Flex>
                      )}
                    </Box>
                  )}

                  {txDigest ? (
                    <Flex align="center" gap="2" mt="1">
                      <CheckCircleIcon size={14} color="var(--green-9)" />
                      <Text size="1" color="green" style={{ fontFamily: "monospace" }}>
                        {shorten(txDigest)}
                      </Text>
                    </Flex>
                  ) : (
                    <Button
                      size="2"
                      onClick={() => handleDeposit(entry)}
                      loading={depositing === entry.dwalletId}
                      disabled={!!depositing}
                    >
                      Register Deposit
                    </Button>
                  )}
                </Flex>
              </Card>
            );
          })}
        </Flex>
      )}
    </Card>
  );
}
