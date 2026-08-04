import type { Metadata } from "next";
import { Inter, Noto_Sans_Devanagari } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const notoDevanagari = Noto_Sans_Devanagari({
  subsets: ["devanagari"],
  variable: "--font-noto-devanagari",
  display: "swap",
});

export const metadata: Metadata = {
  title: "SSC Prep Hub — India's Most Advanced SSC Practice Platform",
  description:
    "SSC CGL, CHSL, CPO, MTS, GD mock tests, PYQ papers, daily practice, AI analytics and study material in Hindi & English.",
  keywords:
    "SSC CGL mock test, SSC CHSL PYQ, SSC practice, SSC mock test free, SSC CGL previous year paper",
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
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${inter.variable} ${notoDevanagari.variable} min-h-screen bg-background font-sans text-foreground antialiased`}
      >
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
