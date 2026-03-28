"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { useState } from "react";
import {
  Box,
  Button,
  Card,
  Flex,
  Heading,
  Text,
} from "@radix-ui/themes";
import { PenLineIcon, CheckCircleIcon, CopyIcon } from "lucide-react";

const PROTOCOL = "URCHIN_PROTOCOL_V1";

// Operation 1: Create dWallet.
//
// This message MUST be deterministic — no nonce, no timestamp.
// The same Solana wallet must always produce the same signature so that
// the same dWallet encryption key can be re-derived (e.g. after page reload).
//
// Format agreed with IKA backend:
//   protocol:<PROTOCOL>
//   action:CREATE_DWALLET
//   address:<base58 solana pubkey>
function buildKeySeedMessage(address: string): string {
  return [
    `protocol:${PROTOCOL}`,
    `action:CREATE_DWALLET`,
    `address:${address}`,
  ].join("\n");
}

export function SignMessage() {
  const { signMessage, publicKey } = useWallet();
  const [result, setResult] = useState<{
    signedMessage: string;
    signature: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  async function handleSign() {
    if (!signMessage || !publicKey) {
      setError("Wallet not connected or does not support message signing.");
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const signedMessage = buildKeySeedMessage(publicKey.toBase58());
      const encoded = new TextEncoder().encode(signedMessage);
      const sig = await signMessage(encoded);
      const hex = Buffer.from(sig).toString("hex");

      const res = await fetch("http://localhost:3001/api/dwallet/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: publicKey.toBase58(), signature: hex }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `Server returned ${res.status}`);
      }

      setResult({ signedMessage, signature: hex });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Signing was rejected or failed.");
    } finally {
      setLoading(false);
    }
  }

  function handleCopy() {
    if (!result) return;
    navigator.clipboard.writeText(result.signature);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (!publicKey) return null;

  const preview = buildKeySeedMessage(publicKey.toBase58());

  return (
    <Card size="3">
      <Flex align="center" gap="2" mb="3">
        <PenLineIcon size={16} />
        <Heading size="3">Derive dWallet Key</Heading>
      </Flex>

      <Text size="1" color="gray" mb="3" as="p">
        Sign this message to generate the encryption key seed for your dWallet.
        The message is fixed — signing it always produces the same key, so your
        dWallet can be recovered at any time.
      </Text>

      {/* Show the exact fixed message before signing */}
      <Box
        p="3"
        mb="3"
        style={{
          background: "var(--gray-a3)",
          borderRadius: "var(--radius-2)",
          border: "1px solid var(--gray-a6)",
        }}
      >
        <Text size="1" weight="bold" color="gray" as="p" mb="1">
          Message to sign
        </Text>
        <Text
          size="1"
          as="p"
          style={{
            fontFamily: "monospace",
            whiteSpace: "pre",
            color: "var(--gray-11)",
          }}
        >
          {preview}
        </Text>
      </Box>

      <Button onClick={handleSign} loading={loading}>
        Sign with Phantom
      </Button>

      {error && (
        <Text size="2" color="red" mt="3" as="p">
          {error}
        </Text>
      )}

      {result && (
        <Box
          mt="3"
          p="3"
          style={{
            background: "var(--green-a3)",
            borderRadius: "var(--radius-2)",
            border: "1px solid var(--green-a6)",
          }}
        >
          <Flex align="center" gap="2" mb="2">
            <CheckCircleIcon size={14} color="var(--green-9)" />
            <Text size="2" weight="bold" color="green">
              Encryption Key Seed Signature
            </Text>
          </Flex>
          <Text
            size="1"
            style={{
              fontFamily: "monospace",
              wordBreak: "break-all",
              color: "var(--gray-12)",
            }}
          >
            {result.signature}
          </Text>
          <Button variant="ghost" size="1" mt="2" onClick={handleCopy}>
            <CopyIcon size={12} />
            {copied ? "Copied!" : "Copy"}
          </Button>
        </Box>
      )}
    </Card>
  );
}
