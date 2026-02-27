"use client";

import { useState } from "react";
import {
  Button,
  Card,
  Code,
  Flex,
  Heading,
  Spinner,
  Text,
} from "@radix-ui/themes";
import { Wallet } from "lucide-react";
import { toast } from "sonner";
import { useCurrentAccount, useDAppKit } from "@mysten/dapp-kit-react";
import { createdWallet, type CreateDwalletResult } from "./lib/dWallet";

export function CreateDWallet() {
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<CreateDwalletResult | null>(null);
  const dAppKit = useDAppKit();
  const account = useCurrentAccount();

  async function handleCreate() {
    setPending(true);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    const toastId = toast.loading("Creating dWallet...");
    try {
      const res = await createdWallet({
        senderAddress: account!.address,
        signAndExecuteTransaction: (args) =>
          dAppKit.signAndExecuteTransaction({ transaction: args.transaction }),
        onStatus: (msg) => toast.loading(msg, { id: toastId }),
      });
      setResult(res);
      toast.success("dWallet created successfully", { id: toastId });
    } catch (err) {
      console.error("[CreateDWallet]", err);
      toast.error(
        err instanceof Error ? err.message : "Failed to create dWallet",
        { id: toastId },
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <Card size="3">
      <Flex align="center" gap="2" mb="3">
        <Wallet size={16} />
        <Heading size="3">Create dWallet</Heading>
      </Flex>

      <Flex direction="column" gap="3">
        {result ? (
          <>
            <ResultRow label="dWallet Cap ID" value={result.dwalletCapId} />
            <ResultRow
              label="Encryption Key ID"
              value={result.encryptionKeyId}
            />
            <ResultRow label="Session ID" value={result.sessionId} />
            <ResultRow
              label="Transaction Digest"
              value={result.transactionDigest}
            />
            <Button variant="outline" onClick={() => setResult(null)}>
              Create Another
            </Button>
          </>
        ) : (
          <Button
            size="3"
            onClick={handleCreate}
            disabled={pending || !account}
          >
            {pending ? (
              <span
                style={{
                  display: "flex",
                  alignItems: "center",
                  borderRadius: "6px",
                }}
              >
                <Spinner /> Creating...
              </span>
            ) : (
              "Create dWallet"
            )}
          </Button>
        )}
      </Flex>
    </Card>
  );
}

function ResultRow({ label, value }: { label: string; value: string }) {
  return (
    <Flex direction="column" gap="1">
      <Text size="1" color="gray">
        {label}
      </Text>
      <Code size="1" style={{ wordBreak: "break-all" }}>
        {value}
      </Code>
    </Flex>
  );
}
