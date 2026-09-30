"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Eye, EyeOff, KeyRound } from "lucide-react";
import { useState, useEffect, type FormEvent } from "react";
import { requestPasswordReset, signIn } from "@/lib/auth-client";
import { safeInternalPath } from "@/lib/navigation";

export function LoginForm({ ssoEnabled = false }: { ssoEnabled?: boolean }) {
  const [showPassword, setShowPassword] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [resetMode, setResetMode] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const [error, setError] = useState("");
  const [hydrated, setHydrated] = useState(false);

  // The middleware validates the HttpOnly session before rendering this form.
  useEffect(() => {
    setHydrated(true);
  }, []);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const result = await signIn.email({ email, password, rememberMe: true });
      if (result.error) {
        setError(result.error.message || "Sign in failed");
      } else {
        window.location.replace(safeInternalPath("/dashboard"));
      }
    } catch (err: any) {
      setError(err.message || "Sign in failed");
    } finally {
      setLoading(false);
    }
  }

  async function onRequestReset(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      await requestPasswordReset({
        email,
        redirectTo: `${window.location.origin}/reset-password`,
      });
    } finally {
      // The same public result is shown for unknown users and provider errors.
      setResetSent(true);
      setLoading(false);
    }
  }

  async function onPasskeySignIn() {
    if (!window.PublicKeyCredential) {
      setError("Passkeys are not supported by this browser.");
      return;
    }

    setLoading(true);
    setError("");
    try {
      const result = await signIn.passkey();
      if (result.error) {
        setError(result.error.message || "Passkey sign-in was not completed.");
      } else {
        window.location.replace(safeInternalPath("/dashboard"));
      }
    } catch {
      setError("Passkey sign-in was not completed.");
    } finally {
      setLoading(false);
    }
  }

  async function onPocketIdSignIn() {
    setLoading(true);
    setError("");
    try {
      const result = await signIn.oauth2({
        providerId: "pocket-id",
        callbackURL: "/dashboard",
      });
      if (result.error) {
        setError(result.error.message || "Pocket ID sign in failed.");
        setLoading(false);
      }
    } catch {
      setError("Pocket ID sign in failed.");
      setLoading(false);
    }
  }

  if (resetMode) {
    return (
      <Card className="w-full max-w-sm">
        <CardContent className="space-y-6 p-8">
          <div className="space-y-1 text-center">
            <h1 className="text-2xl font-bold tracking-tight">
              Reset password
            </h1>
            <p className="text-sm text-muted-foreground">
              {resetSent
                ? "If an account exists for that email, a reset link has been sent."
                : "Enter your email to request a password reset link."}
            </p>
          </div>
          {!resetSent && (
            <form onSubmit={onRequestReset} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="reset-email">Email</Label>
                <Input
                  id="reset-email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                />
              </div>
              <Button type="submit" disabled={loading} className="w-full">
                {loading ? "Requesting..." : "Send reset link"}
              </Button>
            </form>
          )}
          <Button
            type="button"
            variant="ghost"
            className="w-full text-muted-foreground"
            onClick={() => {
              setResetMode(false);
              setResetSent(false);
              setError("");
            }}
          >
            Back to sign in
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <section className="w-full max-w-[352px]" aria-labelledby="suite-title">
      <h1
        id="suite-title"
        className="mb-9 text-center text-4xl font-semibold tracking-tight"
      >
        Suite
      </h1>
      <form
        onSubmit={onSubmit}
        data-login-hydrated={hydrated ? "true" : "false"}
        aria-busy={loading}
      >
        <Button
          type="button"
          variant="outline"
          disabled={loading || !hydrated}
          onClick={() => void onPasskeySignIn()}
          className="h-12 w-full gap-3"
        >
          <KeyRound size={18} aria-hidden="true" />
          Use a passkey
        </Button>
        {ssoEnabled && (
          <Button
            type="button"
            variant="outline"
            disabled={loading || !hydrated}
            onClick={() => void onPocketIdSignIn()}
            className="mt-3 h-12 w-full gap-3"
          >
            Continue with Pocket ID
          </Button>
        )}
        <div
          className="my-5 flex items-center gap-5 text-xs text-muted-foreground"
          aria-hidden="true"
        >
          <span className="h-px flex-1 bg-border" />
          <span>or</span>
          <span className="h-px flex-1 bg-border" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="username webauthn"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="h-12 text-base sm:text-sm"
          />
        </div>
        <div className="mt-6 space-y-2">
          <Label htmlFor="password">Password</Label>
          <div className="relative">
            <Input
              id="password"
              name="password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="h-12 pr-12 text-base sm:text-sm"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={showPassword ? "Hide password" : "Show password"}
              aria-pressed={showPassword}
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-0 top-0 size-12 text-muted-foreground"
            >
              {showPassword ? (
                <EyeOff size={18} aria-hidden="true" />
              ) : (
                <Eye size={18} aria-hidden="true" />
              )}
            </Button>
          </div>
        </div>
        <div className="mt-2 flex justify-end">
          <Button
            type="button"
            variant="link"
            disabled={loading}
            className="min-h-11 text-muted-foreground"
            onClick={() => {
              setResetMode(true);
              setError("");
            }}
          >
            Forgot password?
          </Button>
        </div>
        {error && (
          <Alert variant="destructive" role="alert" className="my-3">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <Button
          type="submit"
          disabled={loading || !hydrated}
          className="mt-3 h-12 w-full"
        >
          {loading ? "Signing in..." : "Sign in"}
        </Button>
      </form>
      <a
        href="/signup"
        className="mx-auto mt-6 flex min-h-11 w-fit items-center text-sm font-medium underline underline-offset-4"
      >
        Get started
      </a>
      <noscript>
        <p className="mt-4 text-sm">Enable JavaScript to use secure sign-in.</p>
      </noscript>
    </section>
  );
}
