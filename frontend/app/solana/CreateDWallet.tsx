"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { useState } from "react";
import {
  Box,
  Button,
  Card,
  Flex,
  Heading,
  Spinner,
  Text,
} from "@radix-ui/themes";
import {
  WalletIcon,
  CheckCircleIcon,
  CopyIcon,
  ChevronRightIcon,
} from "lucide-react";

const PROTOCOL = "URCHIN_PROTOCOL_V1";
const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";

function buildKeySeedMessage(address: string): string {
  return [
    `protocol:${PROTOCOL}`,
    `action:CREATE_DWALLET`,
    `address:${address}`,
  ].join("\n");
}

type Step = "idle" | "signing" | "creating" | "done";

interface DWalletResult {
  dWalletId: string;
  solanaEscrowAddress: string;
}

export function CreateDWallet() {
  const { signMessage, publicKey } = useWallet();
  const [step, setStep] = useState<Step>("idle");
  const [dWallet, setDWallet] = useState<DWalletResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  async function handleCreate() {
    if (!signMessage || !publicKey) return;

    setError(null);
    setDWallet(null);

    // Step 1: sign key seed message in Phantom
    setStep("signing");
    let signature: string;
    try {
      const message = buildKeySeedMessage(publicKey.toBase58());
      const encoded = new TextEncoder().encode(message);
      const sig = await signMessage(encoded);
      signature = Buffer.from(sig).toString("hex");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Signing was rejected.");
      setStep("idle");
      return;
    }

    // Step 2: send signature to backend → backend calls IKA → creates dWallet
    setStep("creating");
    try {
      console.log(`${BACKEND_URL}/api/dwallet/create`);
      const res = await fetch(`${BACKEND_URL}/api/dwallet/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address: publicKey.toBase58(),
          signature,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `Backend returned ${res.status}`);
      }

      const data: DWalletResult = await res.json();
      setDWallet(data);
      setStep("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "dWallet creation failed.");
      setStep("idle");
    }
  }

  function copy(text: string, field: string) {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  }

  const busy = step === "signing" || step === "creating";

  return (
    <Card size="3">
      <Flex align="center" gap="2" mb="3">
        <WalletIcon size={16} />
        <Heading size="3">Create dWallet</Heading>
      </Flex>

      <Text size="2" color="gray" as="p" mb="4">
        Creates a dWallet on the IKA network controlled by your Solana address.
        You will sign one message in Phantom — no SOL is spent.
      </Text>

      {/* Step indicator */}
      <Flex align="center" gap="2" mb="4">
        <StepBadge
          index={1}
          label="Sign in Phantom"
          active={step === "signing"}
          done={step === "creating" || step === "done"}
        />
        <ChevronRightIcon size={14} color="var(--gray-8)" />
        <StepBadge
          index={2}
          label="Create on IKA"
          active={step === "creating"}
          done={step === "done"}
        />
      </Flex>

      {step === "done" && dWallet ? (
        <Box>
          <Flex align="center" gap="2" mb="3">
            <CheckCircleIcon size={16} color="var(--green-9)" />
            <Text size="2" weight="bold" color="green">
              dWallet created
            </Text>
          </Flex>

          <ResultRow
            label="dWallet ID"
            value={dWallet.dWalletId}
            copied={copiedField === "dWalletId"}
            onCopy={() => copy(dWallet.dWalletId, "dWalletId")}
          />
          <ResultRow
            label="Solana escrow address"
            value={dWallet.solanaEscrowAddress}
            copied={copiedField === "escrow"}
            onCopy={() => copy(dWallet.solanaEscrowAddress, "escrow")}
          />

          <Button
            variant="soft"
            size="2"
            mt="3"
            onClick={() => {
              setStep("idle");
              setDWallet(null);
            }}
          >
            Create another
          </Button>
        </Box>
      ) : (
        <Button onClick={handleCreate} loading={busy} disabled={busy}>
          {busy ? (
            <Flex align="center" gap="2">
              <Spinner size="1" />
              {step === "signing"
                ? "Waiting for Phantom…"
                : "Creating dWallet…"}
            </Flex>
          ) : (
            "Create dWallet"
          )}
        </Button>
      )}

      {error && (
        <Text size="2" color="red" mt="3" as="p">
          {error}
        </Text>
      )}
    </Card>
  );
}

function StepBadge({
  index,
  label,
  active,
  done,
}: {
  index: number;
  label: string;
  active: boolean;
  done: boolean;
}) {
  return (
    <Flex align="center" gap="1">
      <Box
        style={{
          width: 20,
          height: 20,
          borderRadius: "50%",
          background: done
            ? "var(--green-9)"
            : active
              ? "var(--accent-9)"
              : "var(--gray-a4)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        <Text
          size="1"
          style={{
            color: done || active ? "white" : "var(--gray-9)",
            fontWeight: 600,
          }}
        >
          {done ? "✓" : index}
        </Text>
      </Box>
      <Text
        size="1"
        color={done ? "green" : active ? undefined : "gray"}
        weight={active ? "bold" : "regular"}
      >
        {label}
      </Text>
    </Flex>
  );
}

function ResultRow({
  label,
  value,
  copied,
  onCopy,
}: {
  label: string;
  value: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <Box
      mb="2"
      p="2"
      style={{
        background: "var(--gray-a3)",
        borderRadius: "var(--radius-2)",
        border: "1px solid var(--gray-a6)",
      }}
    >
      <Text size="1" color="gray" as="p">
        {label}
      </Text>
      <Flex align="center" justify="between" gap="2" mt="1">
        <Text
          size="1"
          style={{
            fontFamily: "monospace",
            wordBreak: "break-all",
            color: "var(--gray-12)",
          }}
        >
          {value.slice(0, 6)}...
        </Text>
        <Button
          variant="ghost"
          size="1"
          onClick={onCopy}
          style={{ flexShrink: 0 }}
        >
          <CopyIcon size={12} />
          {copied ? "Copied!" : "Copy"}
        </Button>
      </Flex>
    </Box>
  );
}
