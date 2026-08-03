import type { Metadata } from "next";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";

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
      <body className="min-h-screen bg-background text-foreground antialiased">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
