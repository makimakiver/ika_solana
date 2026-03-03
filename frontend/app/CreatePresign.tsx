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
import { CheckCircleIcon, PenLineIcon, TriangleAlertIcon } from "lucide-react";
import {
  useCurrentAccount,
  useCurrentClient,
  useDAppKit,
} from "@mysten/dapp-kit-react";
import { IkaClient } from "@ika.xyz/sdk";
import ikaConfigJson from "../ika_config.json";
import {
  getLocalNetworkConfig,
  deriveRootSeedKeyFromPassword,
} from "./lib/dWallet_utils";
import { createPresign, type PresignResult } from "./lib/presign_utils";

interface DWalletOption {
  capId: string;
  dwalletId: string;
}

export function CreatePresign() {
  const account = useCurrentAccount();
  const suiClient = useCurrentClient();
  const dAppKit = useDAppKit();

  const [dwallets, setDwallets] = useState<DWalletOption[]>([]);
  const [selectedDWallet, setSelectedDWallet] = useState<DWalletOption | null>(null);
  const [loadingDWallets, setLoadingDWallets] = useState(false);
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [result, setResult] = useState<PresignResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!account) return;
    setLoadingDWallets(true);
    suiClient.core
      .listOwnedObjects({
        owner: account.address,
        type: `${ikaConfigJson.packages.ika_dwallet_2pc_mpc_package_id}::coordinator_inner::DWalletCap`,
        include: { content: true, json: true },
      })
      .then(async (owned) => {
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
            // skip
          }
        }
        setDwallets(results);
        if (results.length > 0) setSelectedDWallet(results[0]);
      })
      .finally(() => setLoadingDWallets(false));
  }, [account?.address]);

  function reset() {
    setResult(null);
    setPassword("");
    setError(null);
    setStatus(null);
  }

  async function handleCreatePresign() {
    if (!account || !selectedDWallet) return setError("Please select a dWallet.");
    if (!password) return setError("Please enter a password.");

    setPending(true);
    setError(null);
    setStatus(null);

    try {
      const rootSeedKey = deriveRootSeedKeyFromPassword(password);
      const presignResult = await createPresign({
        senderAddress: account.address,
        suiClient,
        signAndExecuteTransaction: (args) =>
          dAppKit.signAndExecuteTransaction({ transaction: args.transaction }),
        dWalletObjectID: selectedDWallet.dwalletId,
        rootSeedKey,
        onStatus: setStatus,
      });
      setResult(presignResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Presign failed");
    } finally {
      setPending(false);
      setStatus(null);
    }
  }

  return (
    <Card size="3">
      <Flex align="center" gap="2" mb="1">
        <PenLineIcon size={16} />
        <Heading size="3">Create Presign</Heading>
      </Flex>
      <Text size="2" color="gray" mb="4" as="p">
        Pre-compute part of the signature for your dWallet.
      </Text>

      {result ? (
        <Flex direction="column" gap="3">
          <Callout.Root color="green">
            <Callout.Icon><CheckCircleIcon size={16} /></Callout.Icon>
            <Callout.Text>Presign created successfully</Callout.Text>
          </Callout.Root>
          <Flex direction="column" gap="2" p="3" style={{ background: "var(--gray-a3)", borderRadius: "var(--radius-3)" }}>
            <Box>
              <Text size="1" color="gray">Transaction</Text>
              <Code size="1" style={{ wordBreak: "break-all", display: "block" }}>
                {result.transactionDigest}
              </Code>
            </Box>
            <Box>
              <Text size="1" color="gray">Presign ID</Text>
              <Code size="1" style={{ wordBreak: "break-all", display: "block" }}>
                {result.presignId}
              </Code>
            </Box>
            <Box>
              <Text size="1" color="gray">Presign Cap ID</Text>
              <Code size="1" style={{ wordBreak: "break-all", display: "block" }}>
                {result.presignCapId}
              </Code>
            </Box>
          </Flex>
          <Button variant="outline" onClick={reset}>
            Create Another
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
          </Flex>

          {/* Password */}
          <Flex direction="column" gap="1">
            <Text as="label" size="2" weight="medium">Password</Text>
            <TextField.Root
              type="password"
              placeholder="Password used to create your dWallet"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <Text size="1" color="gray">
              Must match the password used when creating the dWallet.
            </Text>
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

          <Button
            size="3"
            onClick={handleCreatePresign}
            disabled={pending || dwallets.length === 0 || !password}
          >
            {pending ? <><Spinner />Creating Presign...</> : "Create Presign"}
          </Button>
        </Flex>
      )}
    </Card>
  );
}
