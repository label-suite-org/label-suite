"use client";

import { CampaignEditButton, CampaignDeleteButton } from "./CampaignActionButtons";
import { CampaignCreateDialog } from "./CampaignCreateDialog";

interface CampaignRow {
  id: string;
  campaign_name: string;
  campaign_type: string | null;
  revision: number;
  status: string | null;
  start_date: string | null;
  end_date: string | null;
  owner: string | null;
  budget_planned: number | null;
  performance_rating: number | null;
  main_platform: string | null;
  release_title: string | null;
  artist_name: string | null;
}

const STATUS_ORDER = ["planning", "active", "completed"];
const STATUS_LABELS: Record<string, string> = {
  planning: "Planning",
  active: "Active",
  completed: "Completed",
};

const STATUS_COLORS: Record<string, string> = {
  planning: "bg-blue-100 text-blue-700 border-blue-200",
  active: "bg-green-100 text-green-700 border-green-200",
  completed: "bg-muted text-muted-foreground border-border",
};

function KpiBadge({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium bg-muted/60">
      <span className="text-muted-foreground">{label}:</span>
      <span>{value}</span>
    </span>
  );
}

function BudgetBadge({ value }: { value: number | null }) {
  if (value == null) return null;
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium bg-muted/60">
      <span className="text-muted-foreground">Budget:</span>
      <span>{value.toLocaleString()} DKK</span>
    </span>
  );
}

function PlatformBadge({ platform }: { platform: string | null }) {
  if (!platform) return null;
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium bg-muted/60">
      {platform}
    </span>
  );
}

export function CampaignManager({
  campaigns,
  releases,
  artists,
  canMutate = true,
}: {
  campaigns: CampaignRow[];
  releases: Array<{ id: string; title: string }>;
  artists: Array<{ id: string; name: string }>;
  canMutate?: boolean;
}) {
  const grouped = STATUS_ORDER.map((status) => ({
    status,
    label: STATUS_LABELS[status] || status,
    items: campaigns.filter((c) => (c.status || "planning") === status),
  }));

  const otherStatuses = campaigns.filter(
    (c) => !STATUS_ORDER.includes(c.status || "planning")
  );
  const otherLabel = otherStatuses.length > 0 ? "Other" : null;

  return (
    <div className="space-y-6">
      <section className="space-y-2 border-b border-border pb-6">
        <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">Campaigns</p>
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">Campaign board</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">Track campaign status, linked releases, owners, budgets, and quick edits from one board.</p>
      </section>

      {!canMutate && <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">Read-only for fundraiser</p>}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {grouped.map((col, index) => (
          <div key={col.status} className="space-y-3">
            <div className="flex min-h-9 items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold text-foreground">{col.label}</h2>
                <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5">{col.items.length}</span>
              </div>
              {canMutate && index === grouped.length - 1 ? (
                <CampaignCreateDialog releases={releases} artists={artists} />
              ) : null}
            </div>
            <div className="space-y-2">
              {col.items.length === 0 ? (
                <div className="p-6 text-center text-xs text-muted-foreground border-2 border-dashed border-border">
                  No {col.label.toLowerCase()} campaigns
                </div>
              ) : (
                col.items.map((c) => (
                  <a
                    key={c.id}
                    href={`/campaigns/${c.id}`}
                    className="block p-3 border border-border bg-card hover:bg-accent transition-colors space-y-2"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-medium text-sm leading-snug">{c.campaign_name}</p>
                      <span className={`shrink-0 text-[10px] px-1.5 py-0.5 font-medium border ${STATUS_COLORS[c.status || "planning"]}`}>
                        {STATUS_LABELS[c.status || "planning"] || c.status}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      <KpiBadge label="Type" value={c.campaign_type} />
                      <PlatformBadge platform={c.main_platform} />
                      <BudgetBadge value={c.budget_planned} />
                    </div>
                    <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                      {c.artist_name && <span>{c.artist_name}</span>}
                      {c.release_title && <span>· {c.release_title}</span>}
                      {c.owner && <span>· {c.owner}</span>}
                    </div>
                    {canMutate && <div className="flex gap-1.5 pt-1">
                      <CampaignEditButton campaign={c} releases={releases} artists={artists} />
                      <CampaignDeleteButton campaign={c} />
                    </div>}
                  </a>
                ))
              )}
            </div>
          </div>
        ))}
      </div>

      {otherLabel && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-foreground">{otherLabel}</h2>
          <div className="space-y-2">
            {otherStatuses.map((c) => (
              <a
                key={c.id}
                href={`/campaigns/${c.id}`}
                className="block p-3 border border-border bg-card hover:bg-accent transition-colors space-y-2"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="font-medium text-sm leading-snug">{c.campaign_name}</p>
                  <span className="shrink-0 text-[10px] px-1.5 py-0.5 font-medium bg-muted text-muted-foreground">
                    {c.status}
                  </span>
                </div>
                <div className="flex flex-wrap gap-1">
                  <KpiBadge label="Type" value={c.campaign_type} />
                  <PlatformBadge platform={c.main_platform} />
                  <BudgetBadge value={c.budget_planned} />
                </div>
                <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                  {c.artist_name && <span>{c.artist_name}</span>}
                  {c.release_title && <span>· {c.release_title}</span>}
                  {c.owner && <span>· {c.owner}</span>}
                </div>
                {canMutate && <div className="flex gap-1.5 pt-1">
                  <CampaignEditButton campaign={c} releases={releases} artists={artists} />
                  <CampaignDeleteButton campaign={c} />
                </div>}
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
