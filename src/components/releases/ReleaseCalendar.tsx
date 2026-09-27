import { useCallback, useEffect, useState } from "react";
import type { calendarStatus } from "../../server/calendar-sync";

import { NativeSelect } from "@/components/ui/native-select";
import { Button } from "@/components/ui/button";
type Status = Awaited<ReturnType<typeof calendarStatus>>;
export function ReleaseCalendar({ releaseId, canManage }: { releaseId: string; canManage: boolean }) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [calendars, setCalendars] = useState<Array<{ id: string; summary: string }>>([]);
  const [selected, setSelected] = useState("");
  const refresh = useCallback(async () => {
    const response = await fetch(`/api/calendar?releaseId=${encodeURIComponent(releaseId)}`);
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "Could not load calendar status.");
    setStatus(body);
    setSelected((current) => current || body.calendarId || "");
  }, [releaseId]);
  useEffect(() => {
    const message = new URLSearchParams(window.location.search).get("calendarError");
    if (message) { setError(message); setOpen(true); }
    if (new URLSearchParams(window.location.search).get("calendar") === "connected") setOpen(true);
    void refresh().catch((cause) => setError(cause.message));
  }, [refresh]);
  useEffect(() => {
    if (!open) return;
    const timer = setInterval(() => { void refresh().catch((cause) => setError(cause.message)); }, 10_000);
    return () => clearInterval(timer);
  }, [open, refresh]);
  const act = async (payload: Record<string, unknown>) => {
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/calendar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not update calendar sync.");
      if (body.authUrl) { window.location.assign(body.authUrl); return; }
      setNotice(payload.action === "sync" || payload.action === "resolve" ? "Sync queued. Status updates here; refresh the schedule after it finishes." : "Saved");
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not update calendar sync."); }
    finally { setBusy(false); }
  };
  const loadCalendars = async () => {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/calendar?calendars=true");
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not list calendars.");
      setCalendars(body.calendars);
      if (!body.calendars.length) setNotice("No writable calendars found. Give this Google account permission to edit the True Nature calendar.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not list calendars."); }
    finally { setBusy(false); }
  };
  const conflicts = status?.links.filter((link) => link.conflict && !link.ignored) ?? [];
  const button = "min-h-9 border border-border px-3 py-2 text-xs disabled:opacity-50";
  return <details className="border border-border p-3" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary className="cursor-pointer text-sm font-medium">Google Calendar · {status?.enabled && status.connected ? status.calendarName : "Not syncing"}{conflicts.length ? ` · ${conflicts.length} need review` : ""}</summary>
    <div className="mt-3 space-y-3 text-sm">
      <p className="text-muted-foreground">Two-way date sync for this release, its milestones and dated tasks. Updates run about every 5 minutes. Keep events as single all-day deadlines.</p>
      {error && <p role="alert" className="text-red-700 dark:text-red-300">{error}</p>}
      {status?.error && <p role="alert" className="text-red-700 dark:text-red-300">{status.error}</p>}
      {notice && <p role="status">{notice}</p>}
      {!status && !error && <p>Loading calendar status…</p>}
      {status && <>
        {status.connected && <p>{status.email} · {status.calendarName || "Choose a calendar"}</p>}
        <p className="text-xs text-muted-foreground">Last successful sync: {status.lastSyncedAt ? new Date(status.lastSyncedAt).toLocaleString() : "Not synced yet"}</p>
        {canManage ? <>
          {!status.configured && <p>Google Calendar needs configuration by the suite administrator.</p>}
          <div className="flex flex-wrap gap-2">
            <Button className={button} disabled={busy || !status.configured} onClick={() => void act({ action: "connect", releaseId })}>{status.connected ? "Reconnect Google" : "Connect Google Calendar"}</Button>
            {status.connected && <>
              <Button className={button} disabled={busy} onClick={() => void loadCalendars()}>Choose calendar</Button>
              {status.calendarId && <><Button className={button} disabled={busy} onClick={() => void act({ action: "enable", releaseId, enabled: !status.enabled })}>{status.enabled ? "Pause this release" : "Enable this release"}</Button><Button className={button} disabled={busy || !status.enabled} onClick={() => void act({ action: "sync" })}>Sync now</Button><Button className={button} disabled={busy} onClick={() => window.location.reload()}>Refresh schedule</Button></>}
              <Button className={button} disabled={busy} onClick={() => void act({ action: "disconnect" })}>Disconnect workspace</Button>
            </>}
          </div>
          {calendars.length > 0 && <div className="flex flex-wrap items-end gap-2"><label className="grid min-w-0 gap-1">Calendar<NativeSelect className="max-w-full border border-border bg-background p-2" value={selected} onChange={(event) => setSelected(event.target.value)}><option value="">Select a writable calendar</option>{calendars.map((calendar) => <option key={calendar.id} value={calendar.id}>{calendar.summary}</option>)}</NativeSelect></label><Button className={button} disabled={busy || !selected} onClick={() => void act({ action: "select", calendarId: selected })}>Save calendar</Button></div>}
          <p className="text-xs text-muted-foreground">Enabling shares task names, assignees, labels and status with people who can see this calendar. Pausing or disconnecting keeps existing events. Assignees are not sent invitations.</p>
        </> : <p>A workspace owner or operator can connect and manage calendar sync.</p>}
        {conflicts.length > 0 && <section aria-label="Calendar conflicts" className="space-y-2"><h3 className="font-medium">Review changes</h3>{conflicts.map((link) => <div key={link.id} className="space-y-2 border border-amber-500 p-3"><p className="font-medium">{link.title}</p><p>{link.conflict} · Suite: {link.localDate || "No date"}{link.googleDate ? ` · Google: ${link.googleDate}` : ""}</p>{link.resolution ? <p role="status">Resolution queued</p> : canManage && <div className="flex flex-wrap gap-2">{link.conflict === "Dates changed in both places" && link.googleDate && <><Button className={button} disabled={busy} onClick={() => void act({ action: "resolve", releaseId, id: link.id, localDate: link.localDate, etag: link.etag, choice: "suite" })}>Use suite date</Button><Button className={button} disabled={busy} onClick={() => void act({ action: "resolve", releaseId, id: link.id, localDate: link.localDate, etag: link.etag, choice: "google" })}>Use Google date</Button></>}<Button className={button} disabled={busy} onClick={() => void act({ action: "resolve", releaseId, id: link.id, localDate: link.localDate, etag: link.etag, choice: "ignore" })}>Keep both, stop syncing this item</Button></div>}</div>)}</section>}
      </>}
    </div>
  </details>;
}
