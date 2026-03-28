"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { useState } from "react";
import {
  Box,
  Button,
  Card,
  Flex,
  Heading,
  SegmentedControl,
  Text,
} from "@radix-ui/themes";
import {
  WalletIcon,
  ArrowDownToLineIcon,
  ArrowUpFromLineIcon,
  PenLineIcon,
  FlaskConicalIcon,
} from "lucide-react";
import { SignMessage } from "./SignMessage";
import { CreateDWallet } from "./CreateDWallet";
import { DWalletList } from "./DWalletList";
import { SolanaDeposit } from "./SolanaDeposit";
import { SolanaTest } from "./SolanaTest";

type Page = "create-dwallet" | "deposit" | "withdraw" | "sign" | "test";

export function SolanaHomeClient() {
  const { publicKey, disconnect, connecting } = useWallet();
  const { setVisible } = useWalletModal();
  const [activePage, setActivePage] = useState<Page>("create-dwallet");

  const shortAddress = publicKey
    ? `${publicKey.toBase58().slice(0, 4)}...${publicKey.toBase58().slice(-4)}`
    : null;

  return (
    <Box minHeight="100vh">
      {/* Topbar */}
      <Box
        px="4"
        py="3"
        style={{
          borderBottom: "1px solid var(--gray-a5)",
          backdropFilter: "blur(8px)",
          position: "sticky",
          top: 0,
          zIndex: 10,
        }}
      >
        <Flex
          align="center"
          justify="between"
          style={{ maxWidth: 480, margin: "0 auto" }}
        >
          <Heading size="4">IKA · Solana</Heading>
          {publicKey ? (
            <Button variant="soft" onClick={disconnect}>
              {shortAddress}
            </Button>
          ) : (
            <Button
              variant="soft"
              loading={connecting}
              onClick={() => setVisible(true)}
            >
              Connect Phantom
            </Button>
          )}
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
              <Flex align="center" gap="2">
                <WalletIcon size={14} />
                Create dWallet
              </Flex>
            </SegmentedControl.Item>
            <SegmentedControl.Item value="deposit">
              <Flex align="center" gap="2">
                <ArrowDownToLineIcon size={14} />
                Deposit
              </Flex>
            </SegmentedControl.Item>
            <SegmentedControl.Item value="withdraw">
              <Flex align="center" gap="2">
                <ArrowUpFromLineIcon size={14} />
                Withdraw
              </Flex>
            </SegmentedControl.Item>
            <SegmentedControl.Item value="sign">
              <Flex align="center" gap="2">
                <PenLineIcon size={14} />
                Sign
              </Flex>
            </SegmentedControl.Item>
            <SegmentedControl.Item value="test">
              <Flex align="center" gap="2">
                <FlaskConicalIcon size={14} />
                Test
              </Flex>
            </SegmentedControl.Item>
          </SegmentedControl.Root>

          {!publicKey ? (
            <Card size="3">
              <Flex align="center" gap="2" mb="2">
                <WalletIcon size={16} />
                <Heading size="3">Connect Wallet</Heading>
              </Flex>
              <Text size="2" color="gray">
                Connect your Phantom wallet to get started.
              </Text>
            </Card>
          ) : activePage === "create-dwallet" ? (
            <Flex direction="column" gap="4">
              <CreateDWallet />
              <DWalletList />
            </Flex>
          ) : activePage === "deposit" ? (
            <SolanaDeposit />
          ) : activePage === "withdraw" ? (
            <Card size="3">
              <Text size="2" color="gray">
                Withdraw via li.fi or Near Intents coming soon.
              </Text>
            </Card>
          ) : activePage === "sign" ? (
            <SignMessage />
          ) : (
            <SolanaTest />
          )}
        </Box>
      </Flex>
    </Box>
  );
}
