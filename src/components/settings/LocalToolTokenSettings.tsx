"use client";

import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { Check, Clipboard, KeyRound, ShieldCheck, Trash2 } from "lucide-react";
import { LOCAL_TOOL_SCOPES, type LocalToolScope } from "../../lib/campaign-enrichment-local-tool-contract";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Input } from "../ui/input";
import { SectionIntro } from "./SettingsControls";

export type LocalToolTokenClientRecord = {
  id: string;
  org_id: string;
  user_id: string;
  name: string;
  token_prefix: string;
  scopes: LocalToolScope[];
  expires_at: string;
  revoked_at: string | null;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
};

type Props = {
  tokens: LocalToolTokenClientRecord[];
  onTokensChange: Dispatch<SetStateAction<LocalToolTokenClientRecord[]>>;
  canMutate: boolean;
};

type CreateTokenResponse = {
  token: string;
  record: unknown;
};

export function LocalToolTokenSettings({ tokens, onTokensChange, canMutate }: Props) {
  const [hydrated, setHydrated] = useState(false);
  const [name, setName] = useState("");
  const [oneTimeSecret, setOneTimeSecret] = useState<string | null>(null);
  const oneTimeSecretRef = useRef<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busyTokenId, setBusyTokenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const createGenerationRef = useRef(0);
  const createAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    setHydrated(true);
    return () => {
      mountedRef.current = false;
      createGenerationRef.current += 1;
      createAbortRef.current?.abort();
      createAbortRef.current = null;
      oneTimeSecretRef.current = null;
    };
  }, []);

  function clearOneTimeSecret() {
    oneTimeSecretRef.current = null;
    setOneTimeSecret(null);
    setCopied(false);
  }

  async function createToken() {
    const trimmedName = name.trim();
    if (!canMutate || !trimmedName) return;
    setCreating(true);
    setError(null);
    setMessage(null);
    clearOneTimeSecret();
    const generation = ++createGenerationRef.current;
    createAbortRef.current?.abort();
    const controller = new AbortController();
    createAbortRef.current = controller;
    try {
      const response = await fetch("/api/settings/local-tool-tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmedName, scopes: [...LOCAL_TOOL_SCOPES], expires_in_days: 30 }),
        signal: controller.signal,
      });
      const payload = await response.json().catch(() => null) as CreateTokenResponse & { error?: string } | null;
      if (!mountedRef.current || controller.signal.aborted || generation !== createGenerationRef.current) return;
      if (!response.ok || !payload) throw new Error(payload?.error ?? "Could not create the token");
      if (typeof payload.token !== "string" || !payload.token) throw new Error("The token response was incomplete");
      const record = safeTokenRecord(payload.record);
      onTokensChange((current) => [record, ...current.filter((token) => token.id !== record.id)]);
      oneTimeSecretRef.current = payload.token;
      setOneTimeSecret(payload.token);
      setName("");
      setMessage("Token created. Store it before dismissing this panel.");
    } catch (caught) {
      if (!mountedRef.current || controller.signal.aborted || generation !== createGenerationRef.current) return;
      setError(errorMessage(caught, "Could not create the token"));
    } finally {
      if (createAbortRef.current === controller) createAbortRef.current = null;
      if (mountedRef.current && generation === createGenerationRef.current) setCreating(false);
    }
  }

  async function copyToken() {
    const secret = oneTimeSecretRef.current;
    if (!secret) return;
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
    } catch {
      setError("Could not copy the token. Select and copy it manually before dismissing.");
    }
  }

  async function revokeToken(token: LocalToolTokenClientRecord) {
    if (!canMutate || token.revoked_at) return;
    setBusyTokenId(token.id);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(`/api/settings/local-tool-tokens/${encodeURIComponent(token.id)}`, { method: "DELETE" });
      const payload = await response.json().catch(() => null) as unknown;
      if (!response.ok) {
        const detail = isRecord(payload) && typeof payload.error === "string" ? payload.error : "Could not revoke the token";
        throw new Error(detail);
      }
      const revoked = safeTokenRecord(payload);
      onTokensChange((current) => current.map((item) => item.id === revoked.id ? revoked : item));
      if (!mountedRef.current) return;
      setMessage(`${revoked.name} revoked.`);
    } catch (caught) {
      if (!mountedRef.current) return;
      setError(errorMessage(caught, "Could not revoke the token"));
    } finally {
      if (mountedRef.current) setBusyTokenId(null);
    }
  }

  return (
    <div id="codex-tools" className="space-y-4" data-local-tool-token-hydrated={hydrated ? "true" : "false"}>
      <SectionIntro title="Codex tools" description="Create a short-lived Label Suite credential for the local Codex MCP operator workflow." />
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><KeyRound className="size-4" />Connection boundary</CardTitle>
          <CardDescription>Codex OAuth stays in Codex. This separate Label Suite token authorizes the bounded diagnostic and proposal-only campaign tools listed below.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2" aria-label="Fixed token scopes">
            {LOCAL_TOOL_SCOPES.map((scope) => <Badge key={scope} variant="outline">{scope}</Badge>)}
          </div>
          <p className="text-xs text-muted-foreground">Fixed scopes · expires after 30 days · no publish, send, stage, lead, draft, or page mutation authority.</p>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
            <label className="grid gap-1.5 text-sm font-medium" htmlFor="local-tool-token-name">
              Token name
              <Input
                id="local-tool-token-name"
                name="local-tool-token-name"
                value={name}
                maxLength={120}
                disabled={!canMutate || creating}
                placeholder="Studio MacBook"
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <Button type="button" disabled={!canMutate || creating || !name.trim()} onClick={() => void createToken()}>
              <ShieldCheck className="size-4" />
              {creating ? "Creating…" : "Create 30-day token"}
            </Button>
          </div>
          {!canMutate && <p className="text-xs text-muted-foreground" role="status">Operations access is required to create or revoke Codex tool tokens.</p>}
          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
          {message && <p className="text-sm text-muted-foreground" role="status">{message}</p>}
        </CardContent>
      </Card>

      {oneTimeSecret && (
        <Card className="border-amber-500/50" aria-labelledby="one-time-token-title">
          <CardHeader>
            <CardTitle id="one-time-token-title">Store this token now</CardTitle>
            <CardDescription>This is the only time Label Suite will display the complete token.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <code className="block overflow-x-auto rounded-lg border border-border bg-muted/50 p-3 text-xs" tabIndex={0}>{oneTimeSecret}</code>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={() => void copyToken()}>
                {copied ? <Check className="size-4" /> : <Clipboard className="size-4" />}
                {copied ? "Copied" : "Copy token"}
              </Button>
              <Button type="button" onClick={clearOneTimeSecret}>I stored this</Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Existing tokens</CardTitle>
          <CardDescription>Only safe metadata is retained here. Complete token values cannot be retrieved.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="divide-y divide-border border-y border-border">
            {tokens.map((token) => {
              const status = tokenStatus(token);
              return (
                <article key={token.id} className="grid gap-3 py-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,2fr)_auto] lg:items-center">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium">{token.name}</p>
                      <Badge variant={status === "Active" ? "secondary" : "outline"}>{status}</Badge>
                    </div>
                    <code className="mt-1 block truncate text-xs text-muted-foreground">{token.token_prefix}</code>
                  </div>
                  <dl className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
                    <div><dt className="inline text-muted-foreground">Creator </dt><dd className="inline">{token.user_id}</dd></div>
                    <div><dt className="inline text-muted-foreground">Expires </dt><dd className="inline">{formatDateTime(token.expires_at)}</dd></div>
                    <div><dt className="inline text-muted-foreground">Last used </dt><dd className="inline">{token.last_used_at ? formatDateTime(token.last_used_at) : "Never"}</dd></div>
                    <div><dt className="inline text-muted-foreground">Created </dt><dd className="inline">{formatDateTime(token.created_at)}</dd></div>
                  </dl>
                  {status === "Active" && (
                    <Button type="button" variant="destructive" size="sm" disabled={!canMutate || busyTokenId === token.id} aria-label={`Revoke ${token.name}`} onClick={() => void revokeToken(token)}>
                      <Trash2 className="size-4" />{busyTokenId === token.id ? "Revoking…" : "Revoke"}
                    </Button>
                  )}
                </article>
              );
            })}
            {tokens.length === 0 && <p className="py-6 text-sm text-muted-foreground">No Codex tool tokens have been created.</p>}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function safeTokenRecord(value: unknown): LocalToolTokenClientRecord {
  if (!isRecord(value)) throw new Error("The token record was incomplete");
  const scopes = Array.isArray(value.scopes) && value.scopes.every(isLocalToolScope) ? [...value.scopes] : null;
  if (
    typeof value.id !== "string" || typeof value.org_id !== "string" || typeof value.user_id !== "string"
    || typeof value.name !== "string" || typeof value.token_prefix !== "string" || !scopes
    || typeof value.expires_at !== "string" || !isNullableString(value.revoked_at)
    || !isNullableString(value.last_used_at) || typeof value.created_at !== "string" || typeof value.updated_at !== "string"
  ) throw new Error("The token record was incomplete");
  return {
    id: value.id,
    org_id: value.org_id,
    user_id: value.user_id,
    name: value.name,
    token_prefix: value.token_prefix,
    scopes,
    expires_at: value.expires_at,
    revoked_at: value.revoked_at,
    last_used_at: value.last_used_at,
    created_at: value.created_at,
    updated_at: value.updated_at,
  };
}

function tokenStatus(token: LocalToolTokenClientRecord) {
  if (token.revoked_at) return "Revoked";
  if (new Date(token.expires_at).getTime() <= Date.now()) return "Expired";
  return "Active";
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function isLocalToolScope(value: unknown): value is LocalToolScope {
  return typeof value === "string" && LOCAL_TOOL_SCOPES.some((scope) => scope === value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}
