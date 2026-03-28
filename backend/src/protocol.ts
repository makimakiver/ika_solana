export const PROTOCOL = "URCHIN_PROTOCOL_V1";

// Must match exactly what the frontend signs in CreateDWallet.tsx
export function buildCreateDWalletMessage(address: string): string {
  return [
    `protocol:${PROTOCOL}`,
    `action:CREATE_DWALLET`,
    `address:${address}`,
  ].join("\n");
}
