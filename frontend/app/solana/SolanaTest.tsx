"use client";

import { useWallet } from "@solana/wallet-adapter-react";
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
import { FlaskConicalIcon, CheckCircleIcon, RefreshCwIcon } from "lucide-react";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";
const PROTOCOL = "URCHIN_PROTOCOL_V1";

function buildKeySeedMessage(address: string): string {
  return [`protocol:${PROTOCOL}`, `action:CREATE_DWALLET`, `address:${address}`].join("\n");
}

interface DWalletEntry {
  capId: string;
  dwalletId: string;
  isActive: boolean;
  suiAddress: string | null;
}

export function SolanaTest() {
  const { signMessage, publicKey } = useWallet();
  const [dWallets, setDWallets] = useState<DWalletEntry[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [signing, setSigning] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  async function fetchDWallets() {
    setLoadingList(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/dwallet/list`);
      const data = await res.json();
      setDWallets(data.dWallets.filter((d: DWalletEntry) => d.isActive));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load dWallets");
    } finally {
      setLoadingList(false);
    }
  }

  async function handleSignSui(dWalletId: string) {
    if (!signMessage || !publicKey) return;
    setSigning(dWalletId);
    setError(null);
    try {
      // Re-derive the deterministic Solana signature (same as used at creation)
      const message = buildKeySeedMessage(publicKey.toBase58());
      const encoded = new TextEncoder().encode(message);
      const sig = await signMessage(encoded);
      const signature = Array.from(sig).map((b) => b.toString(16).padStart(2, "0")).join("");

      const res = await fetch(`${BACKEND_URL}/api/test/sign-sui`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dWalletId, signature }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `Server returned ${res.status}`);
      }

      const data = await res.json();
      setResults((prev) => ({ ...prev, [dWalletId]: data.digest }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Signing failed");
    } finally {
      setSigning(null);
    }
  }

  useEffect(() => {
    if (publicKey) fetchDWallets();
  }, [publicKey]);

  if (!publicKey) return null;

  return (
    <Card size="3">
      <Flex align="center" justify="between" mb="3">
        <Flex align="center" gap="2">
          <FlaskConicalIcon size={16} />
          <Heading size="3">Test</Heading>
          <Badge color="gray" variant="soft">{dWallets.length}</Badge>
        </Flex>
        <Button variant="ghost" size="1" onClick={fetchDWallets} disabled={loadingList}>
          <RefreshCwIcon size={14} />
        </Button>
      </Flex>

      <Text size="2" color="gray" as="p" mb="3">
        Signs a Sui transaction using the selected dWallet via IKA MPC.
      </Text>

      {loadingList ? (
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
            const digest = results[entry.dwalletId];
            const isSigning = signing === entry.dwalletId;

            return (
              <Card key={entry.capId} variant="surface">
                <Flex direction="column" gap="2">
                  <Flex align="center" justify="between">
                    <Text size="2" weight="bold" style={{ fontFamily: "monospace" }}>
                      {entry.dwalletId.slice(0, 6)}...{entry.dwalletId.slice(-4)}
                    </Text>
                    <Badge color="green" variant="soft">Active</Badge>
                  </Flex>

                  {entry.suiAddress && (
                    <Text size="1" color="gray" style={{ fontFamily: "monospace" }}>
                      Sui: {entry.suiAddress.slice(0, 6)}...{entry.suiAddress.slice(-4)}
                    </Text>
                  )}

                  {digest ? (
                    <Box
                      p="2"
                      style={{
                        background: "var(--green-a3)",
                        borderRadius: "var(--radius-2)",
                        border: "1px solid var(--green-a6)",
                      }}
                    >
                      <Flex align="center" gap="2">
                        <CheckCircleIcon size={14} color="var(--green-9)" />
                        <Text size="1" color="green" style={{ fontFamily: "monospace" }}>
                          {digest.slice(0, 8)}...{digest.slice(-6)}
                        </Text>
                      </Flex>
                    </Box>
                  ) : (
                    <Button
                      size="2"
                      onClick={() => handleSignSui(entry.dwalletId)}
                      loading={isSigning}
                      disabled={!!signing}
                    >
                      {isSigning ? "Signing via IKA..." : "Sign Sui Transaction"}
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
