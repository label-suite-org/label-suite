"use client";

import { useEffect, useState, type SubmitEvent } from "react";
import { getAuthenticatorName, type Passkey } from "@better-auth/passkey";
import { KeyRound, Plus, RefreshCw, Trash2 } from "lucide-react";
import { passkey } from "../../lib/auth-client";
import { Button } from "../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { SettingsStatus } from "./SettingsControls";

import { Input } from "@/components/ui/input";
export function PasskeySettings() {
  const [passkeys, setPasskeys] = useState<Passkey[]>([]);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(true);
  const [mutating, setMutating] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  useEffect(() => {
    void loadPasskeys();
  }, []);

  async function loadPasskeys() {
    setLoading(true);
    setStatusError(null);
    try {
      const result = await passkey.listUserPasskeys();
      if (result.error) throw new Error(result.error.message || "Unable to load passkeys.");
      setPasskeys(result.data ?? []);
    } catch (error) {
      setStatusError(error instanceof Error ? error.message : "Unable to load passkeys.");
    } finally {
      setLoading(false);
    }
  }

  async function addPasskey(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!window.PublicKeyCredential) {
      setStatusError("Passkeys are not supported by this browser.");
      return;
    }

    setMutating(true);
    setStatusError(null);
    setStatusMessage(null);
    try {
      const result = await passkey.addPasskey({
        name: name.trim() || undefined,
      });
      if (result.error) throw new Error(result.error.message || "Passkey registration was not completed.");
      setName("");
      setStatusMessage("Passkey added.");
      await loadPasskeys();
    } catch (error) {
      setStatusError(error instanceof Error ? error.message : "Passkey registration was not completed.");
    } finally {
      setMutating(false);
    }
  }

  async function removePasskey(id: string, displayName: string) {
    if (!window.confirm(`Remove “${displayName}”? You will no longer be able to sign in with it.`)) return;

    setMutating(true);
    setStatusError(null);
    setStatusMessage(null);
    try {
      const result = await passkey.deletePasskey({ id });
      if (result.error) throw new Error(result.error.message || "Unable to remove passkey.");
      setStatusMessage("Passkey removed.");
      await loadPasskeys();
    } catch (error) {
      setStatusError(error instanceof Error ? error.message : "Unable to remove passkey.");
    } finally {
      setMutating(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="size-4" />
          Passkeys
        </CardTitle>
        <CardDescription>
          Use a device biometric, PIN, password manager, or security key to sign in without your password.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <SettingsStatus statusError={statusError} statusMessage={statusMessage} />

        <form className="flex flex-col gap-3 sm:flex-row" onSubmit={addPasskey}>
          <label className="flex-1 space-y-1">
            <span className="text-sm font-medium">Passkey name</span>
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={100}
              placeholder="MacBook, phone, security key…"
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </label>
          <Button type="submit" disabled={mutating} className="sm:self-end">
            <Plus className="size-4" />
            Add passkey
          </Button>
        </form>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <RefreshCw className="size-4 animate-spin" />
            Loading passkeys…
          </div>
        ) : passkeys.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
            No passkeys registered yet.
          </p>
        ) : (
          <ul className="space-y-2">
            {passkeys.map((item) => {
              const displayName = item.name || getAuthenticatorName(item.aaguid) || "Passkey";
              return (
                <li key={item.id} className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{displayName}</p>
                    <p className="text-xs text-muted-foreground">
                      Added {formatPasskeyDate(item.createdAt)}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={mutating}
                    onClick={() => void removePasskey(item.id, displayName)}
                    aria-label={`Remove ${displayName}`}
                  >
                    <Trash2 className="size-4" />
                    Remove
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function formatPasskeyDate(value: Date | string | undefined): string {
  if (!value) return "recently";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "recently";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date);
}
