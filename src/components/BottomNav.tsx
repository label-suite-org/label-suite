"use client";

import { useState, useEffect } from "react";
import {
  LayoutDashboard,
  CalendarDays,
  Users,
  Disc3,
  MoreHorizontal,
  Search,
  Music,
  CheckSquare,
  TrendingUp,
  ContactRound,
  Megaphone,
  Radio,
  Banknote,
  Image,
  FileText,
  DollarSign,
  HandCoins,
  PlugZap,
  CircleHelp,
} from "lucide-react";
import {
  APP_NAV_ITEMS,
  APP_NAV_MORE_ITEMS,
  APP_NAV_PRIMARY_ITEMS,
  isActiveNavRoute,
  isCurrentNavPage,
  navItemHref,
} from "@/lib/navigation";
import type { AppNavItem } from "@/lib/navigation";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

const navIcons = {
  dashboard: LayoutDashboard,
  today: CalendarDays,
  events: CalendarDays,
  artists: Users,
  releases: Disc3,
  analytics: TrendingUp,
  campaigns: Megaphone,
  "ops-tasks": CheckSquare,
  royalties: Banknote,
  grants: HandCoins,
  contacts: ContactRound,
  forecast: TrendingUp,
  works: Music,
  catalog: Disc3,
  "radio-plugging": Radio,
  "radio-stations": Radio,
  "media-assets": Image,
  documents: FileText,
  budget: DollarSign,
  integrations: PlugZap,
  help: CircleHelp,
} as const;

const PRIMARY = APP_NAV_PRIMARY_ITEMS as readonly AppNavItem[];
const MORE = APP_NAV_MORE_ITEMS as readonly AppNavItem[];
const APP_ITEMS = APP_NAV_ITEMS as readonly AppNavItem[];

function isMenuActive(
  currentUrl: string,
  item: AppNavItem,
  allItems: readonly AppNavItem[],
) {
  if (isActiveNavRoute(currentUrl, navItemHref(item, currentUrl))) {
    return true;
  }

  return allItems.some(
    (candidate) =>
      candidate.parentId === item.id &&
      isActiveNavRoute(currentUrl, navItemHref(candidate, currentUrl)),
  );
}

export function BottomNav() {
  const [currentUrl, setCurrentUrl] = useState("");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setCurrentUrl(`${window.location.pathname}${window.location.search}`);
  }, []);

  const isActive = (url: string) => isActiveNavRoute(currentUrl, url);
  const topLevelMoreItems = [
    ...MORE.filter((item) => !item.parentId),
    ...APP_ITEMS.filter((item) => {
      const hasChildInMore = MORE.some(
        (candidate) => candidate.parentId === item.id,
      );
      return item.mobilePrimary && hasChildInMore;
    }),
  ].filter(
    (item, index, items) =>
      items.findIndex((candidate) => candidate.id === item.id) === index,
  );

  const moreActive = topLevelMoreItems.some((item) =>
    isMenuActive(currentUrl, item, MORE),
  );

  function openSearch() {
    window.dispatchEvent(new Event("label-suite:open-command-palette"));
    setOpen(false);
  }

  return (
    <>
      {/* Bottom tab bar */}
      <nav
        className="fixed bottom-0 left-0 right-0 z-50 flex h-16 items-end border-t border-border bg-background md:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {PRIMARY.map((item) => {
          const active = isActive(item.url);
          const Icon = navIcons[item.id as keyof typeof navIcons];
          return (
            <a
              key={item.url}
              href={navItemHref(item, currentUrl)}
              aria-current={
                isCurrentNavPage(currentUrl, navItemHref(item, currentUrl))
                  ? "page"
                  : undefined
              }
              className={cn(
                "flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium transition-colors",
                active
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {Icon ? (
                <Icon className={cn("size-5", active && "stroke-[2.5]")} />
              ) : null}
              <span>{item.title}</span>
            </a>
          );
        })}

        {/* More drawer — bottom sheet (trigger lives in the tab bar) */}
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                aria-expanded={open}
                className={cn(
                  "flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium transition-colors",
                  moreActive
                    ? "text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <MoreHorizontal className="size-5" />
                <span>More</span>
              </Button>
            }
          />
          <SheetContent
            side="bottom"
            className="max-h-[min(42rem,calc(100dvh-1rem))] rounded-t-2xl p-0"
          >
            <SheetHeader className="flex-row items-center justify-between border-b-0 pb-2 pt-4">
              <SheetTitle className="text-sm font-semibold text-muted-foreground">
                More
              </SheetTitle>
              <SheetDescription className="sr-only">
                All workspace navigation
              </SheetDescription>
            </SheetHeader>

            <ScrollArea className="min-h-0 h-[calc(min(42rem,calc(100dvh-1rem))-4rem)]">
              <div
                className="flex-1 space-y-3 px-2 pb-4"
                style={{
                  paddingBottom: "max(1rem, env(safe-area-inset-bottom))",
                }}
              >
                <Button
                  type="button"
                  variant="outline"
                  onClick={openSearch}
                  aria-label="Open search"
                  className="w-full justify-start gap-2 bg-background/60 px-4 py-3 text-left text-sm font-semibold"
                >
                  <Search className="size-4" />
                  <span>Search</span>
                </Button>

                {topLevelMoreItems.map((item) => {
                  const active = isMenuActive(currentUrl, item, MORE);
                  const children = MORE.filter(
                    (candidate) => candidate.parentId === item.id,
                  );
                  const isParent = children.length > 0;
                  const Icon = navIcons[item.id as keyof typeof navIcons];

                  return (
                    <div
                      key={item.id}
                      className="rounded-xl border border-border/70 bg-background/60 p-2"
                    >
                      <a
                        href={navItemHref(item, currentUrl)}
                        onClick={() => setOpen(false)}
                        aria-current={
                          isCurrentNavPage(
                            currentUrl,
                            navItemHref(item, currentUrl),
                          )
                            ? "page"
                            : undefined
                        }
                        className={cn(
                          "mb-2 flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-xs font-semibold transition-colors",
                          active
                            ? "bg-accent text-foreground"
                            : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                        )}
                      >
                        {Icon ? (
                          <Icon
                            className={cn("size-4", active && "stroke-[2.5]")}
                          />
                        ) : null}
                        <span className="leading-tight">{item.title}</span>
                      </a>

                      {isParent ? (
                        <div className="grid grid-cols-2 gap-2">
                          {children.map((child) => {
                            const childHref = navItemHref(child, currentUrl);
                            const childActive = isCurrentNavPage(
                              currentUrl,
                              childHref,
                            );
                            const ChildIcon =
                              navIcons[child.id as keyof typeof navIcons];

                            return (
                              <a
                                key={child.id}
                                href={childHref}
                                aria-current={childActive ? "page" : undefined}
                                onClick={() => setOpen(false)}
                                className={cn(
                                  "flex flex-col items-center gap-1 rounded-lg px-1 py-2.5 text-center text-[11px] font-medium transition-colors active:scale-95",
                                  childActive
                                    ? "bg-accent text-foreground"
                                    : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                                )}
                              >
                                {ChildIcon ? (
                                  <ChildIcon
                                    className={cn(
                                      "size-5",
                                      childActive && "stroke-[2.5]",
                                    )}
                                  />
                                ) : null}
                                <span className="leading-tight">
                                  {child.title}
                                </span>
                              </a>
                            );
                          })}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          </SheetContent>
        </Sheet>
      </nav>
    </>
  );
}
