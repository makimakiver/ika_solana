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
import { RefreshCwIcon, WalletIcon } from "lucide-react";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";

interface DWalletEntry {
  capId: string;
  dwalletId: string;
  isActive: boolean;
  publicKey: string | null;
}

export function DWalletList() {
  const [entries, setEntries] = useState<DWalletEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      setEntries(data.dWallets);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load dWallets");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchDWallets();
  }, []);

  return (
    <Card size="3">
      <Flex align="center" justify="between" mb="3">
        <Flex align="center" gap="2">
          <WalletIcon size={16} />
          <Heading size="3">dWallets</Heading>
          <Badge color="gray" variant="soft">{entries.length}</Badge>
        </Flex>
        <Button variant="ghost" size="1" onClick={fetchDWallets} disabled={loading}>
          <RefreshCwIcon size={14} />
        </Button>
      </Flex>

      {loading ? (
        <Flex align="center" gap="2">
          <Spinner />
          <Text size="2" color="gray">Loading...</Text>
        </Flex>
      ) : error ? (
        <Text size="2" color="red">{error}</Text>
      ) : entries.length === 0 ? (
        <Text size="2" color="gray">No dWallets found.</Text>
      ) : (
        <Flex direction="column" gap="3">
          {entries.map((entry, i) => (
            <Card
              key={entry.capId}
              variant="surface"
              style={{ borderLeft: `4px solid ${entry.isActive ? "var(--green-9)" : "var(--amber-9)"}` }}
            >
              <Flex align="center" justify="between" mb="2">
                <Flex align="center" gap="2">
                  <WalletIcon size={14} />
                  <Text size="2" weight="bold">dWallet #{i + 1}</Text>
                </Flex>
                <Badge color={entry.isActive ? "green" : "amber"} variant="soft">
                  {entry.isActive ? "Active" : "Pending"}
                </Badge>
              </Flex>

              <Flex direction="column" gap="2">
                <Row label="Cap ID" value={entry.capId} />
                <Row label="dWallet ID" value={entry.dwalletId} />
                {entry.publicKey && (
                  <Row label="Public Key" value={entry.publicKey} />
                )}
              </Flex>
            </Card>
          ))}
        </Flex>
      )}
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <Box>
      <Text size="1" color="gray" as="p">{label}</Text>
      <Text
        size="1"
        style={{ fontFamily: "monospace", wordBreak: "break-all", color: "var(--gray-12)" }}
      >
        {value.slice(0, 6)}...{value.slice(-4)}
      </Text>
    </Box>
  );
}
