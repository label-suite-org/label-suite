"use client";

import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Disc3, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { resolveFileUrl } from "../../lib/storage-client";
import { Badge } from "@/components/ui/badge";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Item, ItemActions, ItemContent, ItemGroup, ItemMedia, ItemTitle } from "@/components/ui/item";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

export type CampaignRailItem = {
  id: string;
  name: string;
  artist: string | null;
  purpose: string | null;
  cover: string | null;
};

function CampaignArtwork({ cover, name }: { cover: string | null; name: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setSrc(null);
    if (!cover) return;
    if (/^https?:\/\//i.test(cover)) {
      setSrc(cover);
      return;
    }
    resolveFileUrl(cover, 96).then((url) => {
      if (!cancelled) setSrc(url);
    }).catch(() => {
      if (!cancelled) setSrc(null);
    });
    return () => { cancelled = true; };
  }, [cover]);

  return src ? (
    <img src={src} alt="" className="size-full object-cover" onError={() => setSrc(null)} />
  ) : (
    <Disc3 aria-label={`No artwork for ${name}`} className="size-5 text-muted-foreground" />
  );
}

function CampaignList({ campaigns, selectedId, compact = false }: { campaigns: CampaignRailItem[]; selectedId: string; compact?: boolean }) {
  return <nav aria-label="Campaigns" className="flex flex-col gap-1">
    {campaigns.map((campaign) => <Item
      key={campaign.id}
      render={<a href={`/campaigns/${campaign.id}`} aria-current={campaign.id === selectedId ? "page" : undefined} aria-label={`${campaign.name}${campaign.artist ? ` by ${campaign.artist}` : ""}`} title={compact ? campaign.name : undefined} />}
      size="sm"
      className={`min-w-0 gap-3 rounded-md px-2 py-2 hover:bg-muted ${campaign.id === selectedId ? "bg-accent text-accent-foreground" : ""} ${compact ? "justify-center" : ""}`}
    >
      <ItemMedia className={`${compact ? "size-12" : "size-16"} shrink-0 overflow-hidden rounded-md bg-muted/70`} variant="image"><CampaignArtwork cover={campaign.cover} name={campaign.name} /></ItemMedia>
      {!compact && <ItemContent className="min-w-0 gap-0.5">
        <ItemTitle className="truncate">{campaign.name}</ItemTitle>
        {campaign.artist && <span className={`truncate text-xs ${campaign.id === selectedId ? "text-accent-foreground" : "text-muted-foreground"}`}>{campaign.artist}</span>}
        {campaign.purpose && <span className={`truncate text-xs ${campaign.id === selectedId ? "text-accent-foreground" : "text-muted-foreground"}`}>{campaign.purpose}</span>}
      </ItemContent>}
    </Item>)}
  </nav>;
}

export function CampaignContextRail({ campaigns, selectedId }: { campaigns: CampaignRailItem[]; selectedId: string }) {
  const [collapsed, setCollapsed] = useState(false);
  return <aside aria-label="Campaign list" className={`hidden shrink-0 overflow-hidden border-r border-border bg-background transition-[width] duration-300 ease-out motion-reduce:transition-none xl:block ${collapsed ? "w-[72px]" : "w-80"}`}>
    <div className="sticky top-0 max-h-[calc(100vh-3rem)] overflow-y-auto px-2 py-3">
      <div className={`mb-3 flex h-8 items-center ${collapsed ? "justify-center" : "justify-between px-2"}`}>
        {!collapsed && <span className="text-xs font-medium text-muted-foreground">Browse</span>}
        <Button variant="ghost" size="icon-sm" aria-label={collapsed ? "Expand campaign list" : "Collapse campaign list"} aria-expanded={!collapsed} aria-controls="campaign-rail-items" onClick={() => setCollapsed(!collapsed)}>
          {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
        </Button>
      </div>
      <div id="campaign-rail-items"><CampaignList campaigns={campaigns} selectedId={selectedId} compact={collapsed} /></div>
    </div>
  </aside>;
}

type Section = { key: string; label: string };

export function CampaignWorkspaceNavigation({ campaignId, campaignName, status, activeTab, sections, campaigns }: {
  campaignId: string;
  campaignName: string;
  status: string | null;
  activeTab: string;
  sections: Section[];
  campaigns: CampaignRailItem[];
}) {
  const primary = sections.filter((section) => ["overview", "outreach", "content"].includes(section.key));
  const more = sections.filter((section) => !["overview", "outreach", "content"].includes(section.key));
  const activeMore = more.find((section) => section.key === activeTab);
  const href = (key: string) => `/campaigns/${campaignId}?tab=${key}`;

  return <div className="space-y-4">
    <h1 className="sr-only">{campaignName}</h1>
    <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
      <Breadcrumb className="min-w-0 max-w-full">
        <BreadcrumbList className="min-w-0">
          <BreadcrumbItem><BreadcrumbLink href="/campaigns">Campaigns</BreadcrumbLink></BreadcrumbItem>
          <BreadcrumbSeparator><ChevronRight /></BreadcrumbSeparator>
          <BreadcrumbItem className="min-w-0 max-w-full"><BreadcrumbPage className="min-w-0 max-w-[calc(100vw-4rem)] truncate sm:max-w-72">{campaignName}</BreadcrumbPage></BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
      <div className="flex items-center gap-2">
        <Badge variant="ghost" className="capitalize">{status === "active" && <span className="size-1.5 rounded-full bg-emerald-600" />}{status || "planning"}</Badge>
        <Sheet>
          <SheetTrigger render={<Button variant="outline" size="sm" className="xl:hidden" />}><PanelLeftOpen /> Campaign list</SheetTrigger>
          <SheetContent side="left" className="w-[min(88vw,22rem)] overflow-y-auto">
            <SheetHeader><SheetTitle>Campaigns</SheetTitle></SheetHeader>
            <div className="px-3"><CampaignList campaigns={campaigns} selectedId={campaignId} /></div>
          </SheetContent>
        </Sheet>
      </div>
    </div>
    <nav aria-label="Campaign sections" className="grid grid-cols-2 border-b border-border sm:flex sm:items-center sm:gap-1">
      {primary.map((section) => <Button key={section.key} render={<a href={href(section.key)} aria-current={activeTab === section.key ? "page" : undefined} />} variant="ghost" className={`h-11 w-full rounded-none border-b-[3px] px-2 text-sm sm:w-auto sm:px-4 sm:text-base ${activeTab === section.key ? "border-b-primary text-primary" : "border-b-transparent text-muted-foreground"}`}>{section.label}</Button>)}
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" className={`h-11 w-full rounded-none border-b-[3px] px-2 text-sm sm:w-auto sm:px-4 sm:text-base ${activeMore ? "border-b-primary text-primary" : "border-b-transparent text-muted-foreground"}`} aria-label={activeMore ? `More: ${activeMore.label}` : "More campaign sections"} />}>
          {activeMore?.label ?? "More"} <ChevronDown />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {more.map((section) => <DropdownMenuItem key={section.key} render={<a href={href(section.key)} aria-current={activeTab === section.key ? "page" : undefined} />}>{section.label}</DropdownMenuItem>)}
        </DropdownMenuContent>
      </DropdownMenu>
    </nav>
  </div>;
}

export function CampaignWorkingTasks({ tasks }: { tasks: Array<{ id: string; title: string; nextAction: string | null; dueDate: string | null }> }) {
  return <section className="max-w-4xl" aria-label="Working now">
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="text-lg font-semibold">Working now</h2>
      <Button variant="link" size="sm" render={<a href="/ops-tasks" />}>All tasks <ChevronRight /></Button>
    </div>
    {tasks.length ? <ItemGroup className="gap-0 divide-y divide-border border-y border-border">
      {tasks.map((task) => <Item key={task.id} render={<a href={`/ops-tasks?task=${task.id}`} />} className="rounded-none px-1 py-3 hover:bg-muted">
        <ItemContent className="min-w-0"><ItemTitle className="truncate">{task.title}</ItemTitle>{task.nextAction && <span className="truncate text-xs text-muted-foreground">{task.nextAction}</span>}</ItemContent>
        {task.dueDate && <ItemActions className="text-xs text-muted-foreground">{task.dueDate}</ItemActions>}
      </Item>)}
    </ItemGroup> : <p className="border-y border-border py-4 text-sm text-muted-foreground">No open tasks linked to this campaign.</p>}
  </section>;
}
