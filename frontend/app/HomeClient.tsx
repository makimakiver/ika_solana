"use client";

import { ConnectButton, useCurrentAccount } from "@mysten/dapp-kit-react";
import { useState } from "react";
import { Box, Card, Flex, Heading, SegmentedControl, Text } from "@radix-ui/themes";
import { WalletIcon, ArrowDownToLineIcon, ArrowUpFromLineIcon } from "lucide-react";
import { CreateDWallet } from "./CreateDWallet";
import { DepositSolana } from "./DepositSolana";
import { Withdraw } from "./Withdraw";

type Page = "create-dwallet" | "deposit-solana" | "withdraw";

export function HomeClient() {
  const currentAccount = useCurrentAccount();
  const [activePage, setActivePage] = useState<Page>("create-dwallet");

  return (
    <Box minHeight="100vh">

      {/* Topbar */}
      <Box
        px="4" py="3"
        style={{ borderBottom: "1px solid var(--gray-a5)", backdropFilter: "blur(8px)", position: "sticky", top: 0, zIndex: 10 }}
      >
        <Flex align="center" justify="between" style={{ maxWidth: 480, margin: "0 auto" }}>
          <Heading size="4">IKA · Solana</Heading>
          <ConnectButton />
        </Flex>
      </Box>

      {/* Contained content */}
      <Flex justify="center" p="6">
        <Box width="100%" style={{ maxWidth: 480 }}>

          <SegmentedControl.Root
            value={activePage}
            onValueChange={(v) => setActivePage(v as Page)}
            style={{ width: "100%" }}
            mb="4"
          >
            <SegmentedControl.Item value="create-dwallet">
              <Flex align="center" gap="2"><WalletIcon size={14} />Create dWallet</Flex>
            </SegmentedControl.Item>
            <SegmentedControl.Item value="deposit-solana">
              <Flex align="center" gap="2"><ArrowDownToLineIcon size={14} />Deposit</Flex>
            </SegmentedControl.Item>
            <SegmentedControl.Item value="withdraw">
              <Flex align="center" gap="2"><ArrowUpFromLineIcon size={14} />Withdraw</Flex>
            </SegmentedControl.Item>
          </SegmentedControl.Root>

          {!currentAccount ? (
            <Card size="3">
              <Flex align="center" gap="2" mb="2">
                <WalletIcon size={16} />
                <Heading size="3">Connect Wallet</Heading>
              </Flex>
              <Text size="2" color="gray">Connect your wallet to get started.</Text>
            </Card>
          ) : activePage === "create-dwallet" ? (
            <CreateDWallet />
          ) : activePage === "deposit-solana" ? (
            <DepositSolana />
          ) : (
            <Withdraw />
          )}

        </Box>
      </Flex>

    </Box>
  );
}
