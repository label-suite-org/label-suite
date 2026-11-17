"use client";

import { SidebarProvider } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { CommandPalette } from "@/components/command-palette/CommandPalette";
import { AppSidebar } from "./AppSidebar";
import { BottomNav } from "./BottomNav";
import { DevFeedback } from "./DevFeedback";
import { Button } from "@/components/ui/button";
import { Search, Settings } from "lucide-react";
import { useEffect, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { ClientAccessContext, type ClientCapabilityMap } from "../lib/client-capabilities";
import type { MembershipRole } from "../server/tenant";

function useDarkMode() {
  const [dark, setDark] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem("dark-mode");
    setDark(stored === "true" || (stored === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches));
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
  }, [dark, ready]);

  return { dark, toggle: () => setDark((d) => {
    localStorage.setItem("dark-mode", String(!d));
    return !d;
  }) };
}

export function AppShell({ children, orgName, membershipRole, capabilities, isPayee = false }: { children: ReactNode; orgName: string; membershipRole: MembershipRole; capabilities: ClientCapabilityMap; isPayee?: boolean }) {
  const { dark, toggle } = useDarkMode();

  return (
    <ClientAccessContext.Provider value={{ role: membershipRole, capabilities }}>
      <div data-membership-role={membershipRole}>
        <a href="#workspace-content" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-md focus:bg-card focus:p-3 focus:text-primary">Skip to content</a>
        <SidebarProvider defaultOpen style={{ "--sidebar-width": "14.375rem" } as CSSProperties}>
          <TooltipProvider delay={120}>
            {isPayee ? null : (
              /* Desktop sidebar — hidden on mobile */
              <div className="hidden md:contents">
                <AppSidebar orgName={orgName} dark={dark} onToggleTheme={toggle} />
              </div>
            )}

            <div className="min-w-0 flex-1 pb-[calc(4rem+env(safe-area-inset-bottom))] md:pb-0">
              {isPayee ? null : (
                <header aria-label="Workspace toolbar" className="flex min-h-16 items-center gap-3 border-b border-border bg-card px-4 sm:px-6">
                  <span className="min-w-0 flex-1 truncate text-sm font-medium" title={orgName}>{orgName}</span>
                  <Button variant="outline" className="min-h-11 shrink-0 gap-2 text-muted-foreground sm:w-72 sm:justify-start" aria-label="Search workspace" onClick={() => window.dispatchEvent(new Event("label-suite:open-command-palette"))}>
                    <Search className="size-4" aria-hidden="true" />
                    <span className="hidden sm:inline">Search your workspace</span>
                  </Button>
                  <Button nativeButton={false} variant="ghost" size="icon" className="size-11 shrink-0" render={<a href="/settings" aria-label="Account and workspace settings" />}><Settings className="size-4" aria-hidden="true" /></Button>
                </header>
              )}
              <main id="workspace-content" tabIndex={-1} className="min-w-0 p-4 outline-none sm:p-6 lg:p-8">{children}</main>
            </div>

            {isPayee ? null : <BottomNav />}
            {isPayee ? null : <CommandPalette />}
            <DevFeedback />
          </TooltipProvider>
        </SidebarProvider>
      </div>
    </ClientAccessContext.Provider>
  );
}
