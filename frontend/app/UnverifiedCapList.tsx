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
import { PenLineIcon, RefreshCw } from "lucide-react";
import { useCurrentAccount, useCurrentClient } from "@mysten/dapp-kit-react";
import { getLocalNetworkConfig } from "./lib/config";


interface UnverifiedCap {
  objectId: string;
  json: Record<string, any> | null;
}

export function UnverifiedCapList() {
  const UNVERIFIED_CAP_PACKAGE = getLocalNetworkConfig().packages.ikaDwallet2pcMpcPackage;
  console.log("Unverified Cap Package:", UNVERIFIED_CAP_PACKAGE);
  const UNVERIFIED_PRESIGN_CAP_TYPE =
    `${UNVERIFIED_CAP_PACKAGE}::coordinator_inner::UnverifiedPresignCap`;
  const account = useCurrentAccount();
  const suiClient = useCurrentClient();
  const [caps, setCaps] = useState<UnverifiedCap[]>([]);
  const [loading, setLoading] = useState(false);

  async function fetchCaps() {
    if (!account) return;
    setLoading(true);
    try {
      const owned = await suiClient.core.listOwnedObjects({
        owner: account.address,
        type: UNVERIFIED_PRESIGN_CAP_TYPE,
        include: { content: true, json: true },
      });

      const results: UnverifiedCap[] = owned.objects.map((obj) => ({
        objectId: obj.objectId,
        json: (obj as any).json ?? null,
      }));

      setCaps(results);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchCaps();
  }, [account?.address]);

  if (!account) return null;

  return (
    <Card size="3">
      <Flex align="center" justify="between" mb="3">
        <Flex align="center" gap="2">
          <PenLineIcon size={16} />
          <Heading size="3">Unverified Presign Caps</Heading>
          <Badge color="gray" variant="soft">
            {caps.length}
          </Badge>
        </Flex>
        <Button variant="ghost" size="1" onClick={fetchCaps} disabled={loading}>
          <RefreshCw size={14} />
        </Button>
      </Flex>

      {loading ? (
        <Flex align="center" gap="2">
          <Spinner />
          <Text size="2" color="gray">Loading...</Text>
        </Flex>
      ) : caps.length === 0 ? (
        <Text size="2" color="gray">No unverified presign caps found.</Text>
      ) : (
        <Flex direction="column" gap="3">
          {caps.map((cap, i) => (
            <Card
              key={cap.objectId}
              variant="surface"
              style={{ borderLeft: "4px solid var(--amber-9)" }}
            >
              <Flex align="center" justify="between" mb="2">
                <Flex align="center" gap="2">
                  <PenLineIcon size={14} />
                  <Text size="2" weight="bold">Presign Cap #{i + 1}</Text>
                </Flex>
                <Badge color="amber" variant="soft">Unverified</Badge>
              </Flex>
              <Flex direction="column" gap="2">
                <Box>
                  <Text size="1" color="gray">Object ID</Text>
                  <Code size="1" style={{ wordBreak: "break-all", display: "block" }}>
                    {cap.objectId}
                  </Code>
                </Box>
                {cap.json && Object.entries(cap.json).map(([key, value]) => (
                  <Box key={key}>
                    <Text size="1" color="gray">{key}</Text>
                    <Code size="1" style={{ wordBreak: "break-all", display: "block" }}>
                      {typeof value === "object" ? JSON.stringify(value) : String(value)}
                    </Code>
                  </Box>
                ))}
              </Flex>
            </Card>
          ))}
        </Flex>
      )}
    </Card>
  );
}
