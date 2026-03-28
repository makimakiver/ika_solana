import { SolanaWalletProvider } from "./SolanaWalletProvider";
import { SolanaHomeClient } from "./SolanaHomeClient";

export default function SolanaPage() {
  return (
    <SolanaWalletProvider>
      <SolanaHomeClient />
    </SolanaWalletProvider>
  );
}
