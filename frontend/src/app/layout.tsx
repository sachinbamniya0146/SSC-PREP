import type { Metadata } from "next";
import "@fontsource/noto-sans-devanagari/devanagari-400.css";
import "@fontsource/noto-sans-devanagari/devanagari-500.css";
import "@fontsource/noto-sans-devanagari/devanagari-600.css";
import "@fontsource/noto-sans-devanagari/devanagari-700.css";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { SupportChatMount } from "@/components/SupportChatMount";
import { PushNotificationMount } from "@/components/PushNotificationMount";
import SessionSync from "@/components/SessionSync";

// FIX (Sep 2026 — "hindi font me mistake ho rahi hai matrao ki"): the app
// referenced 'Noto Sans Devanagari' by NAME in a CSS variable, but never
// actually loaded it — no next/font import, no Google Fonts <link>, no
// @font-face. So the browser silently fell through to whatever
// Devanagari-capable font happened to be installed on that OS (or none),
// which is exactly what produces inconsistent/broken matra and conjunct
// rendering across devices. Loading it for real via next/font/google
// self-hosts the font at build time (no runtime Google Fonts request,
// works offline, no layout-shift flash) and guarantees every device
// renders Hindi text with a font that actually shapes Devanagari
// correctly, instead of whatever gamble the OS's fallback picked.
//
// Also: the old '.font-hindi' opt-in class was applied to only 3 elements
// in the ENTIRE app — every other Hindi string everywhere else (the vast
// majority of the app's Hindi text, mixed inline with English on nearly
// every page) never got it and rendered in the pure-Latin font stack. See
// globals.css: this font is now folded into the BASE body font-family
// stack instead, so the browser's standard per-character font-fallback
// (Devanagari code points that Inter doesn't cover automatically fall
// through to this font) covers every Hindi character on the site with
// zero per-element tagging required.

export const metadata: Metadata = {
  title: "SSC Prep Hub — India's Most Advanced SSC Practice Platform",
  description:
    "SSC CGL, CHSL, CPO, MTS, GD mock tests, PYQ papers, daily practice, AI analytics and study material in Hindi & English.",
  keywords:
    "SSC CGL mock test, SSC CHSL PYQ, SSC practice, SSC mock test free, SSC CGL previous year paper",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "SSC Prep Hub",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: [
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  openGraph: {
    title: "SSC Prep Hub",
    description: "India's Most Advanced SSC Practice Platform",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      style={
        {
          "--font-inter":
            "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
          "--font-noto-devanagari": "'Noto Sans Devanagari'",
        } as React.CSSProperties
      }
    >
      <body className="min-h-screen bg-background font-sans text-foreground antialiased">
        <ThemeProvider>
          {children}
          <SupportChatMount />
          <PushNotificationMount />
          <SessionSync />
        </ThemeProvider>
      </body>
    </html>
  );
}
