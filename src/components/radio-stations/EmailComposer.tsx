"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { AlertTriangle, CheckCircle2, CircleX } from "lucide-react";
import type { RadioStation } from "./RadioStationForm";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../ui/dialog";

import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";
import { Button } from "@/components/ui/button";
interface Template {
  id: string;
  name: string;
  subject: string;
  body: string;
  description?: string | null;
}

interface Campaign {
  id: string;
  campaign_name: string;
  artist_name?: string | null;
  release_title?: string | null;
}

interface SendResult {
  station_id: string;
  email: string;
  status: string;
  error?: string;
}

export function EmailComposer({
  selectedStations,
  templates,
  campaigns,
  onClose,
}: {
  selectedStations: RadioStation[];
  templates: Template[];
  campaigns: Campaign[];
  onClose: () => void;
}) {
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [campaignId, setCampaignId] = useState("");
  const [sending, setSending] = useState(false);
  const [showSendConfirmation, setShowSendConfirmation] = useState(false);
  const [results, setResults] = useState<SendResult[] | null>(null);
  const reviewButtonRef = useRef<HTMLButtonElement>(null);
  const restoreFocusOnCloseRef = useRef(false);

  const stationsWithEmail = selectedStations.filter((s) => s.email);
  const stationsWithoutEmail = selectedStations.filter((s) => !s.email);

  // First station with email for placeholder preview
  const previewStation = stationsWithEmail[0] ?? selectedStations[0];
  const selectedCampaign = campaigns.find((c) => c.id === campaignId);

  // Template placeholders → expanded preview
  const PLACEHOLDER_VARS: Record<string, string> = previewStation
    ? {
        station_name: previewStation.name,
        dj_name: previewStation.dj_name ?? "(DJ name)",
        call_sign: previewStation.call_sign ?? "(call sign)",
        city: previewStation.city ?? "(city)",
        release_title: selectedCampaign?.release_title ?? "(release title)",
        artist_name: selectedCampaign?.artist_name ?? "(artist name)",
        campaign_name: selectedCampaign?.campaign_name ?? "(campaign name)",
      }
    : {};

  function expandForPreview(text: string): string {
    return text.replace(
      /\{\{(\w+)\}\}/g,
      (_, key: string) => PLACEHOLDER_VARS[key] ?? `{{${key}}}`,
    );
  }

  const previewSubject = useMemo(
    () => (subject ? expandForPreview(subject) : ""),
    [subject, previewStation, selectedCampaign],
  );
  const previewBody = useMemo(
    () => (body ? expandForPreview(body) : ""),
    [body, previewStation, selectedCampaign],
  );

  function selectTemplate(id: string) {
    setSelectedTemplateId(id);
    if (!id) {
      setSubject("");
      setBody("");
      return;
    }
    const tmpl = templates.find((t) => t.id === id);
    if (tmpl) {
      setSubject(tmpl.subject);
      setBody(tmpl.body);
    }
  }

  function handleSend() {
    if (!subject.trim() || !body.trim()) return;
    restoreFocusOnCloseRef.current = false;
    setShowSendConfirmation(true);
  }

  function closeSendConfirmation() {
    if (sending) return;
    restoreFocusOnCloseRef.current = true;
    setShowSendConfirmation(false);
  }

  useEffect(() => {
    if (showSendConfirmation || !restoreFocusOnCloseRef.current) return;
    restoreFocusOnCloseRef.current = false;
    queueMicrotask(() => reviewButtonRef.current?.focus());
  }, [showSendConfirmation]);

  function containConfirmationFocus(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Tab") return;
    const focusable = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>(
        "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])",
      ),
    ).filter((element) => element.getAttribute("aria-hidden") !== "true");
    if (focusable.length === 0) return;
    const currentIndex = focusable.indexOf(document.activeElement as HTMLElement);
    const nextIndex = event.shiftKey ? currentIndex - 1 : currentIndex + 1;
    if (currentIndex === -1 || nextIndex < 0 || nextIndex >= focusable.length) {
      event.preventDefault();
      (event.shiftKey ? focusable.at(-1) : focusable[0])?.focus();
    }
  }

  async function confirmSend() {
    if (!showSendConfirmation || !subject.trim() || !body.trim() || sending) return;
    setShowSendConfirmation(false);
    setSending(true);
    setResults(null);
    try {
      const res = await fetch("/api/email/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          station_ids: selectedStations.map((s) => s.id),
          subject: subject.trim(),
          body: body.trim(),
          campaign_id: campaignId || undefined,
          template_id: selectedTemplateId || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to send");
      setResults(data.results);
    } catch (err: any) {
      setResults([
        {
          station_id: "",
          email: "",
          status: "error",
          error: err.message,
        },
      ]);
    } finally {
      setSending(false);
    }
  }

  const sentCount = results?.filter((r) => r.status === "sent").length ?? 0;
  const failedCount = results?.filter((r) => r.status === "failed").length ?? 0;
  const skippedCount = results?.filter((r) => r.status === "skipped").length ?? 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={sending ? undefined : onClose}
    >
      <div
        className="bg-card rounded-2xl shadow-xl p-6 w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-xl font-bold mb-4">Send Email</h2>

        {results ? (
          /* ── Results screen ── */
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="bg-emerald-50 dark:bg-emerald-900/20 rounded-xl p-3">
                <p className="text-2xl font-bold text-emerald-700 dark:text-emerald-400">
                  {sentCount}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">Sent</p>
              </div>
              <div className="bg-red-50 dark:bg-red-900/20 rounded-xl p-3">
                <p className="text-2xl font-bold text-red-700 dark:text-red-400">
                  {failedCount}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">Failed</p>
              </div>
              <div className="bg-amber-50 dark:bg-amber-900/20 rounded-xl p-3">
                <p className="text-2xl font-bold text-amber-700 dark:text-amber-400">
                  {skippedCount}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">Skipped</p>
              </div>
            </div>

            {results.length > 0 && (
              <div className="border border-border rounded-lg divide-y divide-border max-h-60 overflow-y-auto">
                {results.map((r, i) => {
                  const station = selectedStations.find(
                    (s) => s.id === r.station_id,
                  );
                  return (
                    <div
                      key={i}
                      className="flex items-center justify-between px-3 py-2 text-sm"
                    >
                      <span className="truncate min-w-0">
                        {station?.name ?? r.email ?? r.station_id}
                      </span>
                      <span
                        className={
                          r.status === "sent"
                            ? "inline-flex shrink-0 items-center gap-1 ml-2 text-emerald-600"
                            : r.status === "skipped"
                              ? "inline-flex shrink-0 items-center gap-1 ml-2 text-amber-600"
                              : "inline-flex shrink-0 items-center gap-1 ml-2 text-red-600"
                        }
                      >
                        {r.status === "sent"
                          ? <><CheckCircle2 className="h-4 w-4" />Sent</>
                          : r.status === "skipped"
                            ? <><AlertTriangle className="h-4 w-4" />Skipped</>
                            : <><CircleX className="h-4 w-4" />{r.error ?? "Failed"}</>}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="flex justify-end pt-2">
              <Button
                onClick={onClose}
                className="px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:opacity-90"
              >
                Done
              </Button>
            </div>
          </div>
        ) : showSendConfirmation ? (
          <Dialog open={showSendConfirmation} onOpenChange={(open) => !open && closeSendConfirmation()}>
            <DialogContent
              showCloseButton={false}
              onKeyDown={containConfirmationFocus}
              className="max-h-[90vh] max-w-2xl overflow-y-auto"
            >
              <DialogHeader>
                <DialogTitle>Confirm email send</DialogTitle>
                <DialogDescription>
                  Review the complete recipients, campaign context, subject, and body before sending.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4 rounded-lg border border-border bg-muted/20 p-4">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Recipients</p>
                  <ul className="mt-1 space-y-1 text-sm text-foreground">
                    {stationsWithEmail.map((station) => (
                      <li key={station.id}>{station.name} &lt;{station.email}&gt;</li>
                    ))}
                  </ul>
                  {stationsWithoutEmail.length > 0 && (
                    <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
                      {stationsWithoutEmail.length} selected station{stationsWithoutEmail.length === 1 ? "" : "s"} without email will be skipped.
                    </p>
                  )}
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Campaign</p>
                  <p className="mt-1 text-sm text-foreground">{selectedCampaign?.campaign_name ?? "No campaign linked"}</p>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Preview (for {previewStation?.name ?? "first station"})</p>
                  <p className="mt-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Subject</p>
                  <p className="text-sm text-foreground whitespace-pre-wrap">{previewSubject || subject.trim()}</p>
                  <p className="mt-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">Body</p>
                  <div className="mt-1 max-h-48 overflow-y-auto whitespace-pre-wrap rounded-md border border-border bg-background p-3 text-sm text-foreground">
                    {previewBody || body.trim()}
                  </div>
                </div>
              </div>

              <div className="flex gap-2 justify-end pt-1">
                <Button variant="ghost"
                  type="button"
                  onClick={closeSendConfirmation}
                  autoFocus
                  className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground disabled:opacity-50"
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  onClick={confirmSend}
                  disabled={sending}
                  className="px-5 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:opacity-90 disabled:opacity-50"
                >
                  {sending ? "Sending…" : `Confirm send to ${stationsWithEmail.length} station${stationsWithEmail.length === 1 ? "" : "s"}`}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        ) : (
          /* ── Compose form ── */
          <div className="space-y-5">
            {/* Template selector */}
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">
                Template
              </label>
              <NativeSelect
                value={selectedTemplateId}
                onChange={(e) => selectTemplate(e.target.value)}
                className="w-full px-3 py-2 border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring bg-background"
              >
                <option value="">— Blank (compose from scratch) —</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </NativeSelect>
              {selectedTemplateId && (
                <p className="text-xs text-muted-foreground mt-1">
                  {templates.find((t) => t.id === selectedTemplateId)
                    ?.description ?? ""}
                </p>
              )}
            </div>

            {/* Subject */}
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">
                Subject *
              </label>
              <Input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Email subject line…"
                className="w-full px-3 py-2 border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring bg-background"
              />
            </div>

            {/* Body */}
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">
                Body (HTML) *
              </label>
              <Textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={8}
                placeholder="Email body — HTML supported…"
                className="w-full px-3 py-2 border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring bg-background font-mono resize-y"
              />
            </div>

            {/* Placeholder preview — only show if subject or body has placeholders */}
            {(subject.includes("{{") || body.includes("{{")) && (
              <div className="border border-border rounded-lg p-3 bg-muted/30 space-y-2">
                <p className="text-xs font-medium text-foreground">
                  Preview (for {previewStation?.name ?? "first station"})
                </p>
                {subject.includes("{{") && (
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wide">
                      Subject
                    </p>
                    <p className="text-sm">{previewSubject}</p>
                  </div>
                )}
                {body.includes("{{") && (
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wide mt-1">
                      Body
                    </p>
                    <iframe
                      sandbox=""
                      srcDoc={previewBody}
                      title="Email body preview"
                      className="mt-1 h-48 w-full rounded-md border border-border bg-white"
                    />
                  </div>
                )}
              </div>
            )}

            {/* Campaign association */}
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">
                Link to Campaign{" "}
                <span className="text-muted-foreground font-normal">
                  (optional)
                </span>
              </label>
              <NativeSelect
                value={campaignId}
                onChange={(e) => setCampaignId(e.target.value)}
                className="w-full px-3 py-2 border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring bg-background"
              >
                <option value="">— None —</option>
                {campaigns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.campaign_name}{c.artist_name ? ` · ${c.artist_name}` : ""}{c.release_title ? ` · ${c.release_title}` : ""}
                  </option>
                ))}
              </NativeSelect>
            </div>

            {/* Station summary */}
            <div className="border border-border rounded-lg p-3 space-y-2">
              <p className="text-sm font-medium text-foreground">
                Recipients:{" "}
                <span className="text-muted-foreground font-normal">
                  {selectedStations.length} selected
                </span>
              </p>
              {stationsWithEmail.length > 0 && (
                <div className="text-sm text-emerald-600 flex items-center gap-1">
                  <CheckCircle2 className="h-4 w-4" />
                  <span>{stationsWithEmail.length} with email</span>
                  <span className="text-xs text-muted-foreground ml-2 truncate">
                    {stationsWithEmail
                      .slice(0, 3)
                      .map((s) => s.name)
                      .join(", ")}
                    {stationsWithEmail.length > 3 ? "…" : ""}
                  </span>
                </div>
              )}
              {stationsWithoutEmail.length > 0 && (
                <div className="text-sm text-amber-600 flex items-center gap-1">
                  <AlertTriangle className="h-4 w-4" />
                  <span>
                    {stationsWithoutEmail.length} without email (will be skipped)
                  </span>
                  <span className="text-xs text-muted-foreground ml-2 truncate">
                    {stationsWithoutEmail
                      .slice(0, 3)
                      .map((s) => s.name)
                      .join(", ")}
                    {stationsWithoutEmail.length > 3 ? "…" : ""}
                  </span>
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex gap-2 justify-end pt-1">
              <Button variant="ghost"
                type="button"
                onClick={onClose}
                disabled={sending}
                className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground disabled:opacity-50"
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={handleSend}
                ref={reviewButtonRef}
                disabled={sending || !subject.trim() || !body.trim()}
                className="px-5 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:opacity-90 disabled:opacity-50"
              >
                {sending ? (
                  <span className="flex items-center gap-2">
                    <svg
                      className="animate-spin w-4 h-4"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                      />
                    </svg>
                    Sending…
                  </span>
                ) : (
                  `Send to ${stationsWithEmail.length} station${stationsWithEmail.length === 1 ? "" : "s"}`
                )}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
