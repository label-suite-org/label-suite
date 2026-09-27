"use client";

import { SidebarProvider } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { CommandPalette } from "@/components/command-palette/CommandPalette";
import { AppSidebar } from "./AppSidebar";
import { BottomNav } from "./BottomNav";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { ClientAccessContext, type ClientCapabilityMap } from "../lib/client-capabilities";
import type { MembershipRole } from "../server/tenant";

function useDarkMode() {
  const [dark, setDark] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem("dark-mode");
    if (stored !== null) {
      setDark(stored === "true");
    } else {
      setDark(window.matchMedia("(prefers-color-scheme: dark)").matches);
    }
    setReady(true);
  }, []);

  useEffect(() => {
    const onThemeChange = (event: Event) => {
      const mode = (event as CustomEvent<{ mode: "system" | "light" | "dark" }>).detail?.mode;
      if (mode === "dark") {
        setDark(true);
      } else if (mode === "light") {
        setDark(false);
      } else if (mode === "system") {
        setDark(window.matchMedia("(prefers-color-scheme: dark)").matches);
      }
    };

    window.addEventListener("label-suite:theme-change", onThemeChange);
    return () => window.removeEventListener("label-suite:theme-change", onThemeChange);
  }, []);

  useEffect(() => {
    if (!ready) return;

    const root = document.documentElement;
    if (dark) {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }
    localStorage.setItem("dark-mode", String(dark));
  }, [dark, ready]);

  return { dark, toggle: () => setDark((d) => !d) };
}

export function AppShell({ children, orgName, membershipRole, capabilities, isPayee = false }: { children: ReactNode; orgName: string; membershipRole: MembershipRole; capabilities: ClientCapabilityMap; isPayee?: boolean }) {
  const { dark, toggle } = useDarkMode();

  return (
    <ClientAccessContext.Provider value={{ role: membershipRole, capabilities }}>
      <div className="[--sidebar-width:14rem]" data-membership-role={membershipRole}>
        <SidebarProvider defaultOpen>
          <TooltipProvider delay={120}>
            {isPayee ? null : (
              /* Desktop sidebar — hidden on mobile */
              <div className="hidden md:contents">
                <AppSidebar orgName={orgName} dark={dark} onToggleTheme={toggle} />
              </div>
            )}

            <main className="min-w-0 flex-1 pb-16 md:pb-0">
              <div className="p-6">{children}</div>
            </main>

            {isPayee ? null : <BottomNav />}
            {isPayee ? null : <CommandPalette />}
          </TooltipProvider>
        </SidebarProvider>
      </div>
    </ClientAccessContext.Provider>
  );
}
