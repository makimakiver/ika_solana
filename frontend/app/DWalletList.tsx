"use client";

import { useEffect, useState } from "react";
import {
  Badge,
  Box,
  Button,
  Card,
  Code,
  Flex,
  Heading,
  Spinner,
  Text,
} from "@radix-ui/themes";
import { RefreshCw, Wallet } from "lucide-react";
import { useCurrentAccount, useCurrentClient } from "@mysten/dapp-kit-react";
import ikaConfigJson from "../ika_config.json";

interface DWalletEntry {
  capId: string;
  dwalletId: string;
}

export function DWalletList() {
  const account = useCurrentAccount();
  const suiClient = useCurrentClient();
  const [entries, setEntries] = useState<DWalletEntry[]>([]);
  const [loading, setLoading] = useState(false);

  async function fetchDWallets() {
    if (!account) return;
    setLoading(true);
    try {
      const ownedObjects = await suiClient.core.listOwnedObjects({
        owner: account.address,
        type: `${ikaConfigJson.packages.ika_dwallet_2pc_mpc_package_id}::coordinator_inner::DWalletCap`,
        include: { content: true, json: true },
      });

      const results: DWalletEntry[] = [];
      for (const obj of ownedObjects.objects) {
        const capObj = await suiClient.core.getObject({
          objectId: obj.objectId,
          include: { content: true, json: true },
        });
        const dwalletId = capObj.object?.json?.dwallet_id as string | undefined;
        if (dwalletId) {
          results.push({ capId: obj.objectId, dwalletId });
        }
      }
      setEntries(results);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchDWallets();
  }, [account?.address]);

  if (!account) return null;

  return (
    <Card size="3">
      <Flex align="center" justify="between" mb="3">
        <Flex align="center" gap="2">
          <Wallet size={16} />
          <Heading size="3">My dWallets</Heading>
          <Badge color="gray" variant="soft">
            {entries.length}
          </Badge>
        </Flex>
        <Button
          variant="ghost"
          size="1"
          onClick={fetchDWallets}
          disabled={loading}
        >
          <RefreshCw size={14} />
        </Button>
      </Flex>

      {loading ? (
        <Flex align="center" gap="2">
          <Spinner />
          <Text size="2" color="gray">Loading...</Text>
        </Flex>
      ) : entries.length === 0 ? (
        <Text size="2" color="gray">No dWallets found.</Text>
      ) : (
        <Flex direction="column" gap="3">
          {entries.map((entry, i) => (
            <Card key={entry.capId} variant="surface">
              <Flex align="center" gap="2" mb="2">
                <Wallet size={14} />
                <Text size="2" weight="bold">dWallet #{i + 1}</Text>
              </Flex>
              <Flex direction="column" gap="2">
                <Box>
                  <Text size="1" color="gray">Cap ID</Text>
                  <Code size="1" style={{ wordBreak: "break-all", display: "block" }}>
                    {entry.capId}
                  </Code>
                </Box>
                <Box>
                  <Text size="1" color="gray">dWallet ID</Text>
                  <Code size="1" style={{ wordBreak: "break-all", display: "block" }}>
                    {entry.dwalletId}
                  </Code>
                </Box>
              </Flex>
            </Card>
          ))}
        </Flex>
      )}
    </Card>
  );
}
