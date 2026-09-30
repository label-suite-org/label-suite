import { useEffect, useState } from "react";
import { signIn } from "../../lib/auth-client";
import { Button } from "../ui/button";

export function NativePasskeySignIn({ challenge, state, ssoEnabled = false, complete = false }: { challenge: string; state: string; ssoEnabled?: boolean; complete?: boolean }) {
  const [busy, setBusy] = useState(complete);
  const [error, setError] = useState("");
  async function returnToApp() {
    const res = await fetch("/api/native/browser-sign-in", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "authorize", challenge, state }) });
    if (!res.ok) throw new Error("Unable to return to the app. Close this window and try again.");
    const { callback } = await res.json();
    window.location.assign(callback);
  }
  useEffect(() => {
    if (complete) void returnToApp().catch(cause => { setError(cause.message); setBusy(false); });
  }, [complete]);
  async function authenticate(pocketId: boolean) {
    setBusy(true); setError("");
    try {
      if (pocketId) {
        const callbackURL = `/native-sign-in?${new URLSearchParams({ challenge, state, complete: "1" })}`;
        const result = await signIn.oauth2({ providerId: "pocket-id", callbackURL, errorCallbackURL: `/native-sign-in?${new URLSearchParams({ challenge, state })}` });
        if (result.error) throw new Error("Pocket ID sign-in was not completed. Please try again.");
      } else {
        const result = await signIn.passkey();
        if (result.error) throw new Error("Label Suite passkey sign-in was not completed. Please try again.");
        await returnToApp();
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Sign-in failed. Please try again."); setBusy(false); }
  }
  return <div className="space-y-4">
    <p>{ssoEnabled ? "Sign in with your Pocket ID passkey, then return to the Label Suite app." : "Use your existing Label Suite passkey to sign in to the iPhone app."}</p>
    {ssoEnabled && <Button onClick={() => void authenticate(true)} disabled={busy}>{busy ? "Signing in…" : "Continue with Pocket ID"}</Button>}
    <Button variant={ssoEnabled ? "outline" : "default"} onClick={() => void authenticate(false)} disabled={busy}>{ssoEnabled ? "Use a Label Suite passkey" : busy ? "Signing in…" : "Use a passkey"}</Button>
    {error && <p role="alert">{error}</p>}
    <p className="text-sm text-muted-foreground">{ssoEnabled ? "Pocket ID uses the passkey you already registered there. You can also close this window and sign in with your password in the app." : "If you have not added a passkey, sign in with your password in the app. You can add a passkey in the website’s account settings."}</p>
  </div>;
}
