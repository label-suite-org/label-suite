import { useMemo, useState } from "react";
import type {
  DashboardPreferences,
  DashboardSectionId,
} from "../../lib/dashboard-preferences";
import type {
  DashboardIndicator,
  DashboardSection,
  PersonalDashboardModel,
} from "../../server/dashboard-view-model";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

const urgencyBadge = {
  critical: { label: "Blocker", variant: "destructive" },
  warning: { label: "Review", variant: "secondary" },
  normal: { label: "Next", variant: "outline" },
} as const;

export function PersonalDashboard({
  model,
  initialPreferences,
  canMutate = false,
}: {
  model: PersonalDashboardModel;
  initialPreferences: DashboardPreferences;
  canMutate?: boolean;
}) {
  const [preferences, setPreferences] = useState(initialPreferences);
  const [draft, setDraft] = useState(initialPreferences);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const indicatorById = useMemo(
    () => new Map(model.allIndicators.map((item) => [item.id, item])),
    [model.allIndicators],
  );
  const sectionById = useMemo(
    () => new Map(model.allSections.map((item) => [item.id, item])),
    [model.allSections],
  );
  const indicators = preferences.pinnedIndicatorIds
    .map((id) => indicatorById.get(id))
    .filter(Boolean) as DashboardIndicator[];
  const sections = preferences.sectionOrder
    .filter((id) => !preferences.hiddenSectionIds.includes(id))
    .map((id) => sectionById.get(id))
    .filter(Boolean) as DashboardSection[];

  function setEditorOpen(next: boolean) {
    setOpen(next);
    if (next) {
      setDraft(clonePreferences(preferences));
      setMessage("");
    }
  }

  async function persistPreferences({
    method,
    body,
    successMessage,
    failureMessage,
  }: {
    method: "PUT" | "DELETE";
    body?: DashboardPreferences;
    successMessage: string;
    failureMessage: string;
  }) {
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/dashboard/preferences", {
        method,
        ...(body
          ? {
              headers: { "content-type": "application/json" },
              body: JSON.stringify(body),
            }
          : {}),
      });
      const result = (await response.json().catch(() => null)) as
        | DashboardPreferences
        | { error?: string }
        | null;
      if (!response.ok)
        throw new Error(
          result && "error" in result
            ? (result.error ?? failureMessage)
            : failureMessage,
        );
      const nextPreferences = result as DashboardPreferences;
      setPreferences(nextPreferences);
      setDraft(clonePreferences(nextPreferences));
      setMessage(successMessage);
      setOpen(false);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : failureMessage);
    } finally {
      setSaving(false);
    }
  }

  async function save() {
    await persistPreferences({
      method: "PUT",
      body: draft,
      successMessage: "Dashboard saved",
      failureMessage: "Could not save dashboard",
    });
  }

  async function restoreDefault() {
    await persistPreferences({
      method: "DELETE",
      successMessage: "Default dashboard restored",
      failureMessage: "Could not restore dashboard",
    });
  }

  function togglePin(id: DashboardPreferences["pinnedIndicatorIds"][number]) {
    setDraft((current) =>
      current.pinnedIndicatorIds.includes(id)
        ? {
            ...current,
            pinnedIndicatorIds: current.pinnedIndicatorIds.filter(
              (item) => item !== id,
            ),
          }
        : current.pinnedIndicatorIds.length < 3
          ? {
              ...current,
              pinnedIndicatorIds: [...current.pinnedIndicatorIds, id],
            }
          : current,
    );
  }

  function toggleSection(id: DashboardSectionId) {
    setDraft((current) => ({
      ...current,
      hiddenSectionIds: current.hiddenSectionIds.includes(id)
        ? current.hiddenSectionIds.filter((item) => item !== id)
        : [...current.hiddenSectionIds, id],
    }));
  }

  function moveSection(id: DashboardSectionId, direction: -1 | 1) {
    setDraft((current) => {
      const from = current.sectionOrder.indexOf(id);
      const to = from + direction;
      if (from < 0 || to < 0 || to >= current.sectionOrder.length)
        return current;
      const sectionOrder = [...current.sectionOrder];
      [sectionOrder[from], sectionOrder[to]] = [
        sectionOrder[to],
        sectionOrder[from],
      ];
      return { ...current, sectionOrder };
    });
  }

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-6">
        <div><p className="mb-2 text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">Workspace</p><h1 className="text-3xl font-semibold tracking-tight">Dashboard</h1><p className="mt-2 text-sm text-muted-foreground">{model.setup ? "Your artists, releases, and next steps — together." : "What needs your attention, and what comes next."}</p></div>
        <Sheet open={open} onOpenChange={setEditorOpen}>
          <SheetTrigger render={<Button variant="ghost" type="button" className="min-h-11 px-3 text-sm text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />}>Edit dashboard</SheetTrigger>
          <SheetContent className="w-full sm:max-w-md">
            <SheetHeader>
              <SheetTitle>Edit dashboard</SheetTitle>
              <SheetDescription>
                Choose up to three indicators, then show and order your
                sections.
              </SheetDescription>
            </SheetHeader>
            <div className="flex-1 space-y-7 overflow-y-auto px-4 pb-4">
              <fieldset className="space-y-2">
                <legend className="text-sm font-semibold">
                  Pinned indicators{" "}
                  <span className="font-normal text-muted-foreground">
                    ({draft.pinnedIndicatorIds.length}/3)
                  </span>
                </legend>
                {model.allIndicators.map((item) => (
                  <Label
                    key={item.id}
                    className="flex min-h-11 items-center gap-3 border-b border-border/60 py-2 text-sm font-normal"
                  >
                    <Checkbox
                      checked={draft.pinnedIndicatorIds.includes(item.id)}
                      onCheckedChange={() => togglePin(item.id)}
                      disabled={
                        !draft.pinnedIndicatorIds.includes(item.id) &&
                        draft.pinnedIndicatorIds.length >= 3
                      }
                    />
                    <span>{item.label}</span>
                  </Label>
                ))}
              </fieldset>
              <fieldset className="space-y-2">
                <legend className="text-sm font-semibold">Sections</legend>
                {draft.sectionOrder.map((id, index) => {
                  const item = sectionById.get(id);
                  if (!item) return null;
                  const visible = !draft.hiddenSectionIds.includes(id);
                  return (
                    <div
                      key={id}
                      className="flex min-h-12 items-center gap-2 border-b border-border/60 py-2"
                    >
                      <Label className="flex min-w-0 flex-1 items-center gap-3 text-sm font-normal">
                        <Checkbox
                          checked={visible}
                          onCheckedChange={() => toggleSection(id)}
                        />
                        <span className="truncate">{item.title}</span>
                      </Label>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        aria-label={`Move ${item.title} up`}
                        disabled={index === 0}
                        onClick={() => moveSection(id, -1)}
                      >
                        ↑
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        aria-label={`Move ${item.title} down`}
                        disabled={index === draft.sectionOrder.length - 1}
                        onClick={() => moveSection(id, 1)}
                      >
                        ↓
                      </Button>
                    </div>
                  );
                })}
              </fieldset>
              <p
                aria-live="polite"
                className="min-h-5 text-sm text-muted-foreground"
              >
                {message}
              </p>
            </div>
            <SheetFooter className="border-t border-border sm:flex-row sm:justify-between">
              <Button
                type="button"
                variant="ghost"
                disabled={saving}
                onClick={restoreDefault}
                className="text-muted-foreground"
              >
                Restore default
              </Button>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={saving}
                  onClick={() => setEditorOpen(false)}
                >
                  Cancel
                </Button>
                <Button type="button" disabled={saving} onClick={save}>
                  {saving ? "Saving…" : "Save dashboard"}
                </Button>
              </div>
            </SheetFooter>
          </SheetContent>
        </Sheet>
      </header>

      {model.setup ? (
        <section aria-labelledby="setup-title" className="grid gap-8 border-b border-border py-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] lg:gap-16 lg:py-10">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">Getting started</p>
            <h2 id="setup-title" className="mt-4 max-w-sm text-3xl font-semibold leading-tight tracking-tight">{model.setup.hasArtists ? "Give your first release a home." : "Start with your artists."}</h2>
            <p className="mt-4 max-w-sm text-sm leading-relaxed text-muted-foreground">{canMutate ? "Add an artist, bring in a release, then plan the work around it. You can fill in the details as you go." : "Your workspace is ready for its first records. An owner or operator can add artists, releases, and tasks."}</p>
            <a href={model.setup.hasArtists ? "/releases" : "/artists"} className="mt-6 inline-flex min-h-11 items-center gap-6 bg-foreground px-5 py-3 text-sm font-medium text-background hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">{canMutate ? model.setup.hasArtists ? "Create your first release" : "Add your first artist" : "Explore the roster"}<span aria-hidden="true">→</span></a>
          </div>
          <ol className="divide-y divide-border border-t border-border">
            <li><a href="/artists" className="flex gap-4 py-5 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><span className="pt-1 text-xs tabular-nums text-muted-foreground">01</span><div><h3 className="font-semibold">{model.setup.hasArtists ? "Your roster has started" : "Add an artist"}</h3><p className="mt-1 text-sm leading-relaxed text-muted-foreground">{model.setup.hasArtists ? "Keep building your roster, or move on to a release." : "A name is enough to begin. Add a photo and profile details when ready."}</p></div><span aria-hidden="true" className="ml-auto">↗</span></a></li>
            <li><a href="/releases" className="flex gap-4 py-5 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><span className="pt-1 text-xs tabular-nums text-muted-foreground">02</span><div><h3 className="font-semibold">Create a release</h3><p className="mt-1 text-sm leading-relaxed text-muted-foreground">Bring the music, artwork, and release details together.</p></div><span aria-hidden="true" className="ml-auto">↗</span></a></li>
            <li><a href="/ops-tasks" className="flex gap-4 py-5 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><span className="pt-1 text-xs tabular-nums text-muted-foreground">03</span><div><h3 className="font-semibold">Plan the next task</h3><p className="mt-1 text-sm leading-relaxed text-muted-foreground">Choose what needs doing next and give it a deadline.</p></div><span aria-hidden="true" className="ml-auto">↗</span></a></li>
          </ol>
          <p className="text-sm text-muted-foreground lg:col-span-2">Release readiness and priorities will appear here as your workspace takes shape. <a href="/analytics?section=data-health" className="underline underline-offset-4 hover:text-foreground">Import analytics when you’re ready.</a></p>
        </section>
      ) : <>
      <section aria-labelledby="attention-title" className="space-y-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
            Today
          </p>
          <h2 id="attention-title" className="mt-1 text-xl font-semibold">
            Needs attention
          </h2>
        </div>
        {model.attention.length ? (
          <div className="space-y-2">
            {model.attention.map((item) => {
              const badge =
                urgencyBadge[item.urgency as keyof typeof urgencyBadge] ??
                urgencyBadge.normal;
              return (
                <Card
                  key={item.id}
                  className={
                    item.urgency === "critical"
                      ? "border-destructive/30 bg-destructive/5"
                      : undefined
                  }
                >
                  <CardContent>
                    <a
                      href={item.href}
                      className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant={badge.variant}>{badge.label}</Badge>
                          <span className="text-xs text-muted-foreground">
                            {item.domain}
                          </span>
                          <p className="font-medium">{item.title}</p>
                        </div>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {item.detail}
                        </p>
                        <p className="mt-2 text-sm">
                          <span className="font-medium">Next action:</span>{" "}
                          {item.action}
                        </p>
                      </div>
                      {item.meta && (
                        <span className="text-xs text-muted-foreground sm:text-right">
                          {item.meta}
                        </span>
                      )}
                    </a>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        ) : (
          <p className="p-5 text-sm text-muted-foreground">
            Nothing needs immediate attention.
          </p>
        )}
      </section>

      <section aria-labelledby="pinned-title" className="space-y-3">
        <h2 id="pinned-title" className="text-sm font-semibold">
          Pinned
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {indicators.map((item) => (
            <Card
              key={item.id}
              className="transition-colors hover:bg-accent/45"
            >
              <CardContent>
                <a href={item.href} className="block">
                  <p className="text-xs text-muted-foreground">{item.label}</p>
                  <p className="mt-2 text-2xl font-semibold tabular-nums">
                    {item.value}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {item.detail}
                  </p>
                </a>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-2">
        {sections.map((section) => (
          <Card key={section.id}>
            <div className="flex items-start justify-between gap-3 p-4">
              <div>
                <h2 id={`section-${section.id}`} className="font-semibold">
                  {section.title}
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {section.summary}
                </p>
              </div>
              <a
                href={section.href}
                className="text-xs font-medium text-muted-foreground hover:text-foreground"
              >
                View all
              </a>
            </div>
            <CardContent className="border-t border-border/60 p-0">
              {section.rows.length ? (
                <div className="divide-y divide-border/60">
                  {section.rows.map((row) => (
                    <a
                      key={row.id}
                      href={row.href}
                      className="grid gap-1 px-4 py-3 transition-colors hover:bg-accent/45 sm:grid-cols-[minmax(0,1fr)_auto]"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          {row.title}
                        </p>
                        <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                          {row.detail}
                        </p>
                      </div>
                      {row.meta && (
                        <span className="text-xs text-muted-foreground sm:text-right">
                          {row.meta}
                        </span>
                      )}
                    </a>
                  ))}
                </div>
              ) : (
                <p className="px-4 py-5 text-sm text-muted-foreground">
                  No items to show.
                </p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
      </>}
    </div>
  );
}

function clonePreferences(
  preferences: DashboardPreferences,
): DashboardPreferences {
  return {
    ...preferences,
    pinnedIndicatorIds: [...preferences.pinnedIndicatorIds],
    sectionOrder: [...preferences.sectionOrder],
    hiddenSectionIds: [...preferences.hiddenSectionIds],
  };
}
