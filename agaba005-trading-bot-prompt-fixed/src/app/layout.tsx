import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Space_Grotesk, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

const grotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-grotesk",
  weight: ["400", "500", "600", "700"],
});
const plex = IBM_Plex_Mono({
  subsets: ["latin"],
  variable: "--font-plex",
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "AGABA005 — Autonomous FX & Commodities Desk",
  description:
    "AGABA005 autonomous trading engine: real-time market scanning, confluence-based setup selection, disciplined risk management, and full trade reporting.",
};

export const viewport: Viewport = {
  themeColor: "#04070a",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${grotesk.variable} ${plex.variable}`}>
      <body className="bg-ink-950 text-fog antialiased">{children}</body>
    </html>
  );
}
