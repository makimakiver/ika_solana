"use client";

import { useEffect, useState } from "react";
import {
  Box,
  Button,
  Callout,
  Card,
  Code,
  Flex,
  Heading,
  Select,
  Spinner,
  Text,
  TextField,
} from "@radix-ui/themes";
import { ArrowDownToLineIcon, CheckCircleIcon, CopyIcon, TriangleAlertIcon } from "lucide-react";
import { useCurrentAccount, useCurrentClient } from "@mysten/dapp-kit-react";
import { IkaClient, Curve, publicKeyFromDWalletOutput } from "@ika.xyz/sdk";
import { getLocalNetworkConfig } from "./lib/config";
import ikaConfigJson from "../ika_config.json";
import bs58 from "bs58";

interface DWalletOption {
  capId: string;
  dwalletId: string;
}

export function DepositSolana() {
  const account = useCurrentAccount();
  const suiClient = useCurrentClient();

  const [dwallets, setDwallets] = useState<DWalletOption[]>([]);
  const [selectedDWallet, setSelectedDWallet] = useState<DWalletOption | null>(null);
  const [loadingDWallets, setLoadingDWallets] = useState(false);
  const [solanaAddress, setSolanaAddress] = useState<string | null>(null);
  const [solanaBalance, setSolanaBalance] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);

  function copyAddress() {
    if (!solanaAddress) return;
    navigator.clipboard.writeText(solanaAddress);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const [address, setAddress] = useState("");
  const [amount, setAmount] = useState("");
  const [pending, setPending] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!account) return;

    async function loadDWallets() {
      setLoadingDWallets(true);
      try {
        const owned = await suiClient.core.listOwnedObjects({
          owner: account!.address,
          type: `${ikaConfigJson.packages.ika_dwallet_2pc_mpc_package_id}::coordinator_inner::DWalletCap`,
          include: { content: true, json: true },
        });
        const ikaClient = new IkaClient({ suiClient, config: getLocalNetworkConfig() });
        await ikaClient.initialize();
        const results: DWalletOption[] = [];
        for (const obj of owned.objects) {
          const cap = await suiClient.core.getObject({
            objectId: obj.objectId,
            include: { json: true },
          });
          const dwalletId = cap.object?.json?.dwallet_id as string | undefined;
          if (!dwalletId) continue;
          try {
            const dWallet = await ikaClient.getDWallet(dwalletId);
            if (dWallet.state?.$kind === "Active") {
              results.push({ capId: obj.objectId, dwalletId });
            }
          } catch {
            // skip dWallets that can't be fetched
          }
        }
        setDwallets(results);
        if (results.length > 0) setSelectedDWallet(results[0]);
      } finally {
        setLoadingDWallets(false);
      }
    }

    loadDWallets();
  }, [account?.address]);

  // Derive Solana public key and fetch balance when selected dWallet changes
  useEffect(() => {
    if (!selectedDWallet) { setSolanaAddress(null); setSolanaBalance(null); return; }
    setSolanaAddress(null);
    setSolanaBalance(null);
    const ikaClient = new IkaClient({ suiClient, config: getLocalNetworkConfig() });
    ikaClient.initialize().then(async () => {
      const dWallet = await ikaClient.getDWallet(selectedDWallet.dwalletId);
      const publicOutput = dWallet.state?.Active?.public_output as Uint8Array | undefined;
      if (!publicOutput) return;
      const pubKeyBytes = await publicKeyFromDWalletOutput(Curve.ED25519, publicOutput);
      const address = bs58.encode(pubKeyBytes);
      setSolanaAddress(address);
      // Fetch SOL balance from devnet
      try {
        const res = await fetch(
          process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? "https://api.devnet.solana.com",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              jsonrpc: "2.0",
              id: 1,
              method: "getBalance",
              params: [address],
            }),
          },
        );
        const json = await res.json();
        setSolanaBalance(json.result?.value ?? null);
      } catch {
        setSolanaBalance(null);
      }
    }).catch(() => { setSolanaAddress(null); setSolanaBalance(null); });
  }, [selectedDWallet?.dwalletId]);

  async function handleDeposit() {
    if (!selectedDWallet) return setError("Please select a dWallet.");
    if (!address || !amount) return setError("Please fill in all fields.");
    setPending(true);
    setError(null);
    try {
      // TODO: replace with actual IKA SDK deposit call using selectedDWallet
      await new Promise((res) => setTimeout(res, 1800));
      setTxHash("deposit_" + Math.random().toString(36).slice(2, 14));
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
            <Callout.Text>Deposit submitted successfully</Callout.Text>
          </Callout.Root>
          <Box p="3" style={{ background: "var(--gray-a3)", borderRadius: "var(--radius-3)" }}>
            <Text size="1" color="gray" as="p">Transaction</Text>
            <Code size="1" style={{ wordBreak: "break-all" }}>{txHash}</Code>
          </Box>
          <Button variant="outline" onClick={() => { setTxHash(null); setAddress(""); setAmount(""); }}>
            New Deposit
          </Button>
        </Flex>
      ) : (
        <Flex direction="column" gap="3">
          {/* dWallet selector */}
          <Flex direction="column" gap="1">
            <Text size="2" weight="medium">dWallet</Text>
            {loadingDWallets ? (
              <Flex align="center" gap="2">
                <Spinner />
                <Text size="2" color="gray">Loading dWallets...</Text>
              </Flex>
            ) : dwallets.length === 0 ? (
              <Text size="2" color="amber">No active dWallets found. Create one first.</Text>
            ) : (
              <Select.Root
                value={selectedDWallet?.capId ?? ""}
                onValueChange={(capId) =>
                  setSelectedDWallet(dwallets.find((d) => d.capId === capId) ?? null)
                }
              >
                <Select.Trigger style={{ width: "100%" }} />
                <Select.Content>
                  {dwallets.map((d, i) => (
                    <Select.Item key={d.capId} value={d.capId}>
                      dWallet #{i + 1} — {d.capId.slice(0, 10)}…
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select.Root>
            )}

            {/* Solana address and balance for selected dWallet */}
            {selectedDWallet && (
              <Box mt="2" p="3" style={{ background: "var(--gray-a3)", borderRadius: "var(--radius-3)" }}>
                {solanaAddress ? (
                  <Flex direction="column" gap="2">
                    <Flex align="baseline" justify="between">
                      <Text size="6" weight="bold">
                        {solanaBalance !== null
                          ? `${(solanaBalance / 1e9).toFixed(4)}`
                          : "—"}
                      </Text>
                      <Text size="3" color="gray">SOL</Text>
                    </Flex>
                    <Flex align="center" justify="between" gap="2">
                      <Code size="2" style={{ wordBreak: "break-all", flex: 1 }}>
                        {solanaAddress}
                      </Code>
                      <Button variant="ghost" size="1" onClick={copyAddress} style={{ flexShrink: 0 }}>
                        <CopyIcon size={13} />
                        {copied ? "Copied!" : "Copy"}
                      </Button>
                    </Flex>
                  </Flex>
                ) : (
                  <Flex align="center" gap="2">
                    <Spinner size="1" />
                    <Text size="1" color="gray">Deriving address...</Text>
                  </Flex>
                )}
              </Box>
            )}
          </Flex>

          <Flex direction="column" gap="1">
            <Text as="label" size="2" weight="medium">Source Solana Address</Text>
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
              color={
                solanaBalance !== null &&
                amount !== "" &&
                parseFloat(amount) * 1e9 > solanaBalance
                  ? "red"
                  : undefined
              }
            />
          </Flex>
          {error && (
            <Callout.Root color="red">
              <Callout.Icon><TriangleAlertIcon size={16} /></Callout.Icon>
              <Callout.Text>{error}</Callout.Text>
            </Callout.Root>
          )}
          <Button size="3" onClick={handleDeposit} disabled={pending || dwallets.length === 0}>
            {pending ? <><Spinner />Depositing...</> : "Deposit Funds"}
          </Button>
        </Flex>
      )}
    </Card>
  );
}
