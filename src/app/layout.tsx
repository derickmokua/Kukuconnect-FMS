import type { Metadata } from "next";
import { Manrope, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/components/AuthProvider";
import RequireAuth from "@/components/RequireAuth";
import AppShell from "@/components/AppShell";

const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
  weight: ["400", "600", "700", "800"],
});

const jetbrains = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
  weight: ["500", "600"],
});

export const metadata: Metadata = {
  title: {
    default: "KukuConnect · Kitui",
    template: "%s · KukuConnect",
  },
  description:
    "KukuConnect poultry hatchery — chicks, inventory, orders, and farm admin for Kitui.",
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL || "https://kukuconnect.co.ke"
  ),
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`light ${manrope.variable} ${jetbrains.variable}`}
    >
      <body className={`${manrope.className} antialiased`}>
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@24,400,0,0&display=swap"
          rel="stylesheet"
        />
        <AuthProvider>
          <RequireAuth>
            <AppShell>{children}</AppShell>
          </RequireAuth>
        </AuthProvider>
      </body>
    </html>
  );
}
