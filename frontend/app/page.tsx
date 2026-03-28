"use client";

import { useRouter } from "next/navigation";
import { Box, Card, Flex, Heading, Text } from "@radix-ui/themes";

export default function Home() {
  const router = useRouter();

  return (
    <Box minHeight="100vh">
      <Flex
        direction="column"
        align="center"
        justify="center"
        minHeight="100vh"
        gap="8"
        p="6"
      >
        <Heading size="6">Choose your chain</Heading>
        <Flex gap="6" wrap="wrap" justify="center">
          <Card
            size="4"
            style={{ cursor: "pointer", width: 220 }}
            onClick={() => router.push("/sui")}
          >
            <Flex direction="column" align="center" gap="4" py="4">
              <img
                src="/Logo_Sui_Droplet_Sui Blue.png"
                alt="Sui"
                width={64}
                height={64}
                style={{ borderRadius: 12 }}
              />
              <Heading size="4">Sui</Heading>
              <Text size="2" color="gray" align="center">
                Connect your Sui wallet
              </Text>
            </Flex>
          </Card>

          <Card
            size="4"
            style={{ cursor: "pointer", width: 220 }}
            onClick={() => router.push("/solana")}
          >
            <Flex direction="column" align="center" gap="4" py="4">
              <img
                src="/solanaLogoMark.png"
                alt="Solana"
                width={64}
                height={64}
                style={{ borderRadius: 12 }}
              />
              <Heading size="4">Solana</Heading>
              <Text size="2" color="gray" align="center">
                Connect your Phantom wallet
              </Text>
            </Flex>
          </Card>
        </Flex>
      </Flex>
    </Box>
  );
}
