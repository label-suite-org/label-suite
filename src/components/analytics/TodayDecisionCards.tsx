"use client";

import { ArrowRight } from "lucide-react";
import type { TodayHubData, TodayHubCard } from "../../server/analytics";

interface Props {
  data: TodayHubData;
}

const TONE_CLASSES: Record<TodayHubCard["tone"], string> = {
  good: "bg-emerald-50/55 dark:bg-emerald-950/18",
  watch: "bg-amber-50/55 dark:bg-amber-950/18",
  neutral: "bg-blue-50/55 dark:bg-blue-950/18",
};

const TONE_DOT: Record<TodayHubCard["tone"], string> = {
  good: "bg-emerald-500",
  watch: "bg-amber-500",
  neutral: "bg-blue-500",
};

const TONE_LINK: Record<TodayHubCard["tone"], string> = {
  good: "text-emerald-700 dark:text-emerald-300",
  watch: "text-amber-700 dark:text-amber-300",
  neutral: "text-blue-700 dark:text-blue-300",
};

export default function TodayDecisionCards({ data }: Props) {
  const hoursAgo = data.dataHealth.lastSeenAt
    ? hoursSince(data.dataHealth.lastSeenAt)
    : null;

  return (
    <section className="space-y-4">
      {/* Data freshness badge */}
      <div className="flex flex-wrap items-center gap-3">
        {hoursAgo !== null ? (
          <span className="inline-flex items-center gap-1.5 bg-muted/35 px-3 py-1 text-xs text-[var(--muted-foreground)]">
            <span className={`inline-block h-1.5 w-1.5 rounded-full ${hoursAgo < 24 ? "bg-emerald-500" : hoursAgo < 48 ? "bg-amber-500" : "bg-red-400"}`} />
            Opdateret for {hoursAgo >= 48
              ? `${Math.floor(hoursAgo / 24)}d siden`
              : hoursAgo >= 1
                ? `${hoursAgo}t siden`
                : "under 1t siden"}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 bg-muted/35 px-3 py-1 text-xs text-[var(--muted-foreground)]">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-muted-foreground/40" />
            Afventer dataimport
          </span>
        )}
        {data.dataHealth.totalRows > 0 && (
          <span className="text-xs text-[var(--muted-foreground)]">
            {formatCompact(data.dataHealth.totalRows)} rækker · {data.dataHealth.totalWidgets} kilder
          </span>
        )}
        {data.dataHealth.evidencePartial && <span className="text-xs font-medium text-amber-700 dark:text-amber-300">Evidence sample is truncated</span>}
      </div>

      {/* Decision cards grid */}
      {data.cards.length === 0 ? (
        <p className="bg-muted/25 p-6 text-sm text-[var(--muted-foreground)]">
          Ingen analytics-signaler endnu. Kør en Sisense-import for at få data.
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {data.cards.map((card) => (
            <DecisionCard key={card.key} card={card} />
          ))}
        </div>
      )}
    </section>
  );
}

function DecisionCard({ card }: { card: TodayHubCard }) {
  return (
    <article
      className={`group relative p-4 transition ${TONE_CLASSES[card.tone]}`}
    >
      <div className="flex items-start gap-2.5">
        <span className={`mt-0.5 inline-block h-2 w-2 shrink-0 rounded-full ${TONE_DOT[card.tone]}`} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="text-sm font-semibold leading-tight truncate">{card.title}</h3>
            {card.metric && (
              <span className="shrink-0 bg-white/50 px-2 py-0.5 text-xs font-semibold tabular-nums dark:bg-black/20">
                {card.metric}
              </span>
            )}
          </div>
          <p className="mt-1.5 text-xs opacity-75 line-clamp-2">{card.detail}</p>
        </div>
      </div>

      {card.linkUrl && (
        <a
          href={card.linkUrl}
          className={`mt-3 inline-flex items-center gap-1 text-xs font-medium ${TONE_LINK[card.tone]} opacity-70 transition group-hover:opacity-100`}
        >
          <span>{card.linkLabel ?? "Open"}</span>
          <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
        </a>
      )}
    </article>
  );
}

function hoursSince(isoDate: string): number {
  const parsed = new Date(isoDate.length <= 10 ? `${isoDate}T00:00:00Z` : isoDate);
  if (Number.isNaN(parsed.getTime())) return 0;
  return Math.max(0, Math.round((Date.now() - parsed.getTime()) / 36e5));
}

function formatCompact(value: number): string {
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}
