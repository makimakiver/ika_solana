import type { Metadata } from "next";
import "@radix-ui/themes/styles.css";
import "./globals.css";
import { Theme } from "@radix-ui/themes";
import { Toaster } from "sonner";
export const metadata: Metadata = {
  title: "SOLANA X IKA",
  description: "example app for demonstrating ika sdk on solana",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <Theme appearance="dark" accentColor="indigo" radius="medium">
          {children}
          <Toaster theme="dark" position="bottom-right" richColors />
        </Theme>
      </body>
    </html>
  );
}
