"use client";

import { useState, useEffect, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const queryClient = new QueryClient();

export function DAppKitClientProvider({ children }: { children: ReactNode }) {
  const [Provider, setProvider] = useState<React.ComponentType<any> | null>(
    null,
  );
  const [kit, setKit] = useState<any>(null);

  useEffect(() => {
    (async () => {
      const [{ DAppKitProvider }, { dAppKit }] = await Promise.all([
        import("@mysten/dapp-kit-react"),
        import("./dapp-kit"),
      ]);
      setKit(dAppKit);
      // Wrap in arrow so React doesn't call it as a state initializer
      setProvider(() => DAppKitProvider);
    })();
  }, []);

  if (!Provider || !kit) {
    return null;
  }

  return (
    <QueryClientProvider client={queryClient}>
      <Provider dAppKit={kit}>{children}</Provider>
    </QueryClientProvider>
  );
}
