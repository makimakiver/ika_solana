"use client";

import { useEffect, useState } from "react";
import {
  Card,
  Flex,
  Heading,
  Select,
  SegmentedControl,
  Spinner,
  Text,
} from "@radix-ui/themes";
import {
  ArrowUpFromLineIcon,
  ClockIcon,
  PenLineIcon,
  ZapIcon,
} from "lucide-react";
import { useCurrentAccount, useCurrentClient } from "@mysten/dapp-kit-react";
import { IkaClient } from "@ika.xyz/sdk";
import ikaConfigJson from "../../ika_config.json";
import { getLocalNetworkConfig } from "./lib/dWallet_utils";
import { PresignMode } from "./PresignMode";
import { DirectSignMode } from "./DirectSignMode";
import { FutureSignMode } from "./FutureSignMode";

type SignMode = "presign" | "direct" | "future";

const SIGN_MODES: {
  value: SignMode;
  label: string;
  icon: React.ReactNode;
  description: string;
}[] = [
  {
    value: "presign",
    label: "Presign",
    icon: <PenLineIcon size={13} />,
    description: "Pre-compute part of the signature now; finalize withdrawal later.",
  },
  {
    value: "direct",
    label: "Direct Sign",
    icon: <ZapIcon size={13} />,
    description: "Sign and submit the withdrawal transaction immediately.",
  },
  {
    value: "future",
    label: "Future Sign",
    icon: <ClockIcon size={13} />,
    description: "Create a partial signature commitment to complete at a future time.",
  },
];

interface DWalletOption {
  capId: string;
  dwalletId: string;
}

export function Withdraw() {
  const account = useCurrentAccount();
  const suiClient = useCurrentClient();

  const [signMode, setSignMode] = useState<SignMode>("direct");
  const [dwallets, setDwallets] = useState<DWalletOption[]>([]);
  const [selectedDWallet, setSelectedDWallet] = useState<DWalletOption | null>(null);
  const [loadingDWallets, setLoadingDWallets] = useState(false);

  const activeMode = SIGN_MODES.find((m) => m.value === signMode)!;

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

  return (
    <Card size="3">
      <Flex align="center" gap="2" mb="1">
        <ArrowUpFromLineIcon size={16} />
        <Heading size="3">Withdraw</Heading>
      </Flex>
      <Text size="2" color="gray" mb="4" as="p">
        Withdraw funds from your IKA dWallet to a Solana address.
      </Text>

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
            <Text size="2" color="amber">No dWallets found. Create one first.</Text>
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

        {/* Signing mode tabs */}
        <Flex direction="column" gap="2">
          <Text size="2" weight="medium">Signing Method</Text>
          <SegmentedControl.Root
            value={signMode}
            onValueChange={(v) => setSignMode(v as SignMode)}
            style={{ width: "100%" }}
          >
            {SIGN_MODES.map((mode) => (
              <SegmentedControl.Item key={mode.value} value={mode.value}>
                <Flex align="center" gap="1">
                  {mode.icon}
                  {mode.label}
                </Flex>
              </SegmentedControl.Item>
            ))}
          </SegmentedControl.Root>
          <Text size="1" color="gray">{activeMode.description}</Text>
        </Flex>

        {/* Active mode component — only rendered when a dWallet is selected */}
        {selectedDWallet && signMode === "presign" && (
          <PresignMode selectedDWallet={selectedDWallet} />
        )}
        {selectedDWallet && signMode === "direct" && (
          <DirectSignMode selectedDWallet={selectedDWallet} />
        )}
        {selectedDWallet && signMode === "future" && (
          <FutureSignMode selectedDWallet={selectedDWallet} />
        )}
      </Flex>
    </Card>
  );
}
