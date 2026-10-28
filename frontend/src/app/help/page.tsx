"use client";
import * as React from "react";
import { api } from "@/lib/api";
import HelpDeskPanel from "@/components/HelpDeskPanel";
import { useT } from "@/lib/i18n";
import { ShellHeader } from "@/components/AppShell";

export default function HelpPage() {
  const tr = useT();
  const [me, setMe] = React.useState<{ id: string; role: string } | null>(null);
  const [state, setState] = React.useState<"loading" | "in" | "out">("loading");

  React.useEffect(() => {
    const token = typeof window !== "undefined" ? localStorage.getItem("ssc_access_token") : null;
    if (!token) {
      setState("out");
      return;
    }
    api<{ id: string; role: string }>("/users/me")
      .then((u) => {
        setMe(u);
        setState("in");
      })
      .catch(() => setState("out"));
  }, []);

  return (
    <div className="min-h-screen bg-background text-foreground">
      {state === "out" ? (
        <header className="sticky top-0 z-40 border-b border-border bg-background/80 px-4 py-3 backdrop-blur-lg">
          <div className="mx-auto flex max-w-3xl items-center justify-between">
            <a href="/dashboard" className="text-lg font-bold">← <span className="text-primary">SSC</span>PrepHub</a>
          </div>
        </header>
      ) : (
        <ShellHeader />
      )}
      <main className="mx-auto max-w-3xl px-4 py-8">
        <h1 className="text-2xl font-bold">{tr("Help Center", "Help Center")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{tr("Quick answers, your tickets and live chat with our team - all in one place.", "Jaldi jawab, aapke tickets aur team ke saath live chat - sab ek jagah.")}</p>
        <div className="mt-6">
          {state === "loading" && <div className="skeleton h-[32rem] rounded-2xl" />}
          {state === "out" && (
            <div className="card p-8 text-center">
              <p className="text-sm text-muted-foreground">{tr("Please log in to contact support.", "Support se baat karne ke liye login karo.")}</p>
              <a href="/login" className="btn btn-primary mt-4">{tr("Log in", "Login")}</a>
            </div>
          )}
          {state === "in" && me && (me.role === "STUDENT" ? (
            <HelpDeskPanel currentUserId={me.id} variant="page" />
          ) : (
            <div className="card p-8 text-center text-sm text-muted-foreground">
              {tr("Staff answer tickets from the admin Help desk.", "Staff tickets admin Help desk se dekhte hain.")}
              <div><a href="/admin/support-chat" className="btn btn-primary mt-4">{tr("Open Help desk", "Help desk kholo")}</a></div>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
