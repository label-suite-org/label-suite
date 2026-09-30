import { useState } from "react";
import { signIn } from "../../lib/auth-client";
import { Button } from "../ui/button";

export function NativePasskeySignIn({ challenge, state }: { challenge: string; state: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function authenticate() {
    setBusy(true); setError("");
    try {
      const result = await signIn.passkey();
      if (result.error) throw new Error("Passkey sign-in was not completed. Try again or return to the app.");
      const res = await fetch("/api/native/browser-sign-in", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "authorize", challenge, state }) });
      if (!res.ok) throw new Error("Unable to return to the app. Close this window and try again.");
      const { callback } = await res.json();
      window.location.assign(callback);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Sign-in failed. Please try again."); setBusy(false); }
  }
  return <div className="space-y-4">
    <p>Use your existing Label Suite passkey to sign in to the iPhone app.</p>
    <Button onClick={authenticate} disabled={busy}>{busy ? "Signing in…" : "Use a passkey"}</Button>
    {error && <p role="alert">{error}</p>}
    <p className="text-sm text-muted-foreground">If you have not added a passkey, sign in with your password in the app. You can add a passkey in the website’s account settings.</p>
  </div>;
}
