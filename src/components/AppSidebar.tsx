"use client";

import { useEffect, useState } from "react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarRail,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import {
  LayoutDashboard,
  Users,
  Disc3,
  CalendarDays,
  DollarSign,
  Music,
  ContactRound,
  Megaphone,
  Radio,
  Banknote,
  CheckSquare,
  Image,
  FileText,
  TrendingUp,
  BarChart3,
  Settings,
  HandCoins,
  Moon,
  Search,
  Sun,
  PlugZap,
  CircleHelp,
  ChevronDown,
  type LucideIcon,
} from "lucide-react";
import { APP_NAV_ITEMS, APP_NAV_SECTIONS, isActiveNavRoute, isCurrentNavPage, navItemHref, type AppNavItem } from "@/lib/navigation";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

const navIcons: Record<string, LucideIcon> = {
  dashboard: LayoutDashboard,
  today: CalendarDays,
  events: CalendarDays,
  "ops-tasks": CheckSquare,
  forecast: TrendingUp,
  analytics: BarChart3,
  artists: Users,
  releases: Disc3,
  works: Music,
  contacts: ContactRound,
  campaigns: Megaphone,
  "radio-plugging": Radio,
  "radio-stations": Radio,
  royalties: Banknote,
  "media-assets": Image,
  documents: FileText,
  budget: DollarSign,
  grants: HandCoins,
  integrations: PlugZap,
  help: CircleHelp,
};

const NAV_ITEMS = APP_NAV_ITEMS as readonly AppNavItem[];

export function AppSidebar({
  orgName,
  dark,
  onToggleTheme,
}: {
  orgName: string;
  dark: boolean;
  onToggleTheme: () => void;
}) {
  const [currentUrl, setCurrentUrl] = useState("");
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const syncCurrentPath = () => {
      setCurrentUrl(`${window.location.pathname}${window.location.search}`);
    };

    syncCurrentPath();
    window.addEventListener("popstate", syncCurrentPath);

    return () => {
      window.removeEventListener("popstate", syncCurrentPath);
    };
  }, []);

  function openSearch() {
    window.dispatchEvent(new Event("label-suite:open-command-palette"));
  }

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="relative h-16 shrink-0 border-b border-sidebar-border/70 p-2 group-data-[collapsible=icon]:h-24">
        <Tooltip>
          <TooltipTrigger
            render={
              <a
                href="/dashboard"
                className="flex min-h-12 items-center gap-3 rounded-md px-2.5 py-2 text-sidebar-foreground no-underline transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground group-data-[collapsible=icon]:mx-auto group-data-[collapsible=icon]:size-8 group-data-[collapsible=icon]:min-h-8 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0"
                aria-label="Open dashboard"
                title="Open dashboard"
              />
            }
          >
            <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-sidebar-primary text-xs font-semibold text-sidebar-primary-foreground shadow-sm">
              LS
            </span>
            <span
              data-sidebar-hover="label"
              className="flex min-w-0 flex-col gap-0.5 group-data-[collapsible=icon]:hidden"
            >
              <span className="truncate text-sm font-semibold leading-tight tracking-tight">
                {orgName}
              </span>
              <span className="truncate text-xs text-sidebar-foreground">Workspace</span>
            </span>
          </TooltipTrigger>
          <TooltipContent side="right" align="center">
            Open dashboard
          </TooltipContent>
        </Tooltip>
        <SidebarTrigger className="absolute right-2 top-4 transition-[background-color,color,transform] duration-200 ease-out hover:scale-105 group-data-[collapsible=icon]:left-1/2 group-data-[collapsible=icon]:bottom-2 group-data-[collapsible=icon]:top-auto group-data-[collapsible=icon]:-translate-x-1/2" />
      </SidebarHeader>
      <SidebarContent className="px-1 py-2 group-data-[collapsible=icon]:px-0">
        {APP_NAV_SECTIONS.map((section) => {
          const sectionItems = NAV_ITEMS.filter((item) => item.section === section.id);
          const childrenByParent = NAV_ITEMS.reduce<Map<string, AppNavItem[]>>((buckets, item) => {
            if (!item.parentId) return buckets;

            const existing = buckets.get(item.parentId) ?? [];
            buckets.set(item.parentId, [...existing, item]);
            return buckets;
          }, new Map());
          const topLevelItems = sectionItems.filter((item) => !item.parentId);

          if (!sectionItems.length) return null;

          return (
            <Collapsible key={section.id} open={section.id === "primary" || (expandedGroups[section.id] ?? sectionItems.some(item => isActiveNavRoute(currentUrl, item.url)))} onOpenChange={open => setExpandedGroups(groups => ({ ...groups, [section.id]: open }))}>
            <SidebarGroup className="group-data-[collapsible=icon]:p-1">
              {section.id === "primary" ? <SidebarGroupLabel>{section.label}</SidebarGroupLabel> : (
                <CollapsibleTrigger className="group flex h-8 w-full items-center justify-between px-2 text-xs text-sidebar-foreground/70 hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring group-data-[collapsible=icon]:hidden">
                  {section.label}<ChevronDown aria-hidden className="size-3 transition-transform duration-300 motion-reduce:transition-none group-data-[panel-open]:rotate-180" />
                </CollapsibleTrigger>
              )}
              <CollapsibleContent className="h-(--collapsible-panel-height) overflow-hidden transition-[height] duration-300 ease-out data-ending-style:h-0 data-starting-style:h-0 motion-reduce:transition-none">
              <SidebarGroupContent>
                <SidebarMenu className="gap-1">
                  {topLevelItems.map((item) => {
                    const children = childrenByParent.get(item.id) ?? [];
                    const itemHref = navItemHref(item, currentUrl);
                    const isCurrentPage = isCurrentNavPage(currentUrl, itemHref);
                    const hasActiveChild = children.some((child) => isActiveNavRoute(currentUrl, navItemHref(child, currentUrl)));
                    const isActive = isActiveNavRoute(currentUrl, itemHref) || hasActiveChild;
                    const Icon = navIcons[item.id] ?? LayoutDashboard;

                    return (
                      <SidebarMenuItem key={item.id}>
                        <SidebarMenuButton
                          render={
                            <a
                              href={item.url}
                              aria-current={isCurrentPage ? "page" : undefined}
                              aria-label={item.title}
                              aria-expanded={children.length > 0 ? isActive : undefined}
                            />
                          }
                          tooltip={item.title}
                          isActive={isActive}
                          data-sidebar-hover="button"
                          className="h-8 gap-2.5 px-2 text-[13px] transition-colors group-data-[collapsible=icon]:mx-auto group-data-[collapsible=icon]:size-9! group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0!"
                        >
                          <Icon className="size-4" />
                          <span data-sidebar-hover="label" className="group-data-[collapsible=icon]:hidden">
                            {item.title}
                          </span>
                        </SidebarMenuButton>

                        {children.length > 0 && isActive ? (
                          <SidebarMenuSub>
                            {children.map((child) => {
                              const childHref = navItemHref(child, currentUrl);
                              const childActive = isCurrentNavPage(currentUrl, childHref);
                              const ChildIcon = navIcons[child.id] ?? LayoutDashboard;

                              return (
                                <SidebarMenuSubItem key={child.id}>
                                  <SidebarMenuSubButton
                                    render={
                                      <a
                                        href={childHref}
                                        aria-current={childActive ? "page" : undefined}
                                        aria-label={child.title}
                                      />
                                    }
                                    isActive={childActive}
                                  >
                                    <ChildIcon className="size-4" />
                                    <span>{child.title}</span>
                                  </SidebarMenuSubButton>
                                </SidebarMenuSubItem>
                              );
                            })}
                          </SidebarMenuSub>
                        ) : null}
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
              </CollapsibleContent>
            </SidebarGroup>
            </Collapsible>
          );
        })}
      </SidebarContent>
      <SidebarFooter className="mt-auto border-t border-sidebar-border/70 p-2 group-data-[collapsible=icon]:p-1">
        <div className="rounded-lg border border-sidebar-border/80 bg-sidebar-accent/40 p-1 transition-[border-color,background-color,padding] duration-200 ease-out group-data-[collapsible=icon]:border-transparent group-data-[collapsible=icon]:bg-transparent group-data-[collapsible=icon]:p-0">
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                aria-label="Open search"
                onClick={openSearch}
                tooltip={{
                  children: "Search",
                  side: "right",
                }}
                data-sidebar-hover="button"
                className="h-11 gap-3 px-2.5 text-[13px] transition-[background-color,color,box-shadow] duration-200 ease-out group-data-[collapsible=icon]:mx-auto group-data-[collapsible=icon]:size-9! group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0!"
              >
                <Search className="size-4" />
                <span data-sidebar-hover="label" className="group-data-[collapsible=icon]:hidden">
                  Search
                </span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton
                render={
                  <a
                    href="/settings"
                    aria-current={isCurrentNavPage(currentUrl, "/settings") ? "page" : undefined}
                    aria-label="Open settings"
                  />
                }
                isActive={isActiveNavRoute(currentUrl, "/settings")}
                tooltip={{
                  children: "Settings",
                  side: "right",
                }}
                data-sidebar-hover="button"
                className="h-11 gap-3 px-2.5 text-[13px] transition-[background-color,color,box-shadow] duration-200 ease-out group-data-[collapsible=icon]:mx-auto group-data-[collapsible=icon]:size-9! group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0!"
              >
                <Settings className="size-4" />
                <span
                  data-sidebar-hover="label"
                  className="flex min-w-0 flex-col gap-0.5 group-data-[collapsible=icon]:hidden"
                >
                  <span className="truncate font-medium leading-none">Settings</span>
                  <span className="truncate text-[11px] font-normal leading-none text-sidebar-foreground">
                    Workspace
                  </span>
                </span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton
                aria-label={dark ? "Light mode" : "Dark mode"}
                onClick={onToggleTheme}
                tooltip={{
                  children: dark ? "Light mode" : "Dark mode",
                  side: "right",
                }}
                data-sidebar-hover="button"
                className="h-11 gap-3 px-2.5 text-[13px] transition-[background-color,color,box-shadow] duration-200 ease-out group-data-[collapsible=icon]:mx-auto group-data-[collapsible=icon]:size-9! group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0!"
              >
                {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
                <span data-sidebar-hover="label" className="group-data-[collapsible=icon]:hidden">
                  {dark ? "Light mode" : "Dark mode"}
                </span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </div>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
