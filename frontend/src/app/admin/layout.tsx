import type { Metadata } from "next";
import { AdminShell } from "@/components/AdminShell";

export const metadata: Metadata = {
  title: "Admin | SSC Prep Hub",
  robots: { index: false, follow: false },
};

// Every /admin/* page is rendered inside the console frame (sidebar, badges, top bar).
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <AdminShell>{children}</AdminShell>;
}
