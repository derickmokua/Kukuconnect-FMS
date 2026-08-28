import type { Metadata, Viewport } from "next";
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
    process.env.NEXT_PUBLIC_SITE_URL || "https://app.kukuconnect.co.ke"
  ),
  icons: {
    icon: [
      { url: "/favicon.png", type: "image/png" },
      { url: "/icon.png", type: "image/png" },
      { url: "/logo_transparent.png", type: "image/png" },
    ],
    apple: [{ url: "/apple-icon.png", type: "image/png" }],
    shortcut: "/favicon.png",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "KukuConnect",
  },
  formatDetection: {
    telephone: false,
  },
};

/** Explicit mobile viewport — prevents desktop-scale layouts on phones. */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f9f9f9" },
    { media: "(prefers-color-scheme: dark)", color: "#f9f9f9" },
  ],
  colorScheme: "light",
};

import OutboxSync from "@/components/OutboxSync";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`light ${manrope.variable} ${jetbrains.variable}`}
    >
      <head>
        {/* Material icons — head (not body) so they load before paint on mobile */}
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@24,400,0,0&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className={`${manrope.className} antialiased`}>
        <OutboxSync />
        <AuthProvider>
          <RequireAuth>
            <AppShell>{children}</AppShell>
          </RequireAuth>
        </AuthProvider>
      </body>
    </html>
  );
}
