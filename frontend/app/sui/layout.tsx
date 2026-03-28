import { DAppKitClientProvider } from "./DappKitClientProvider";

export default function SuiLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <DAppKitClientProvider>{children}</DAppKitClientProvider>;
}
