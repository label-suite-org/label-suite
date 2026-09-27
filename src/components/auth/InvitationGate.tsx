"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { signIn } from "@/lib/auth-client";
import { safeInternalPath } from "@/lib/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { SignupForm } from "./SignupForm";

interface InvitationGateProps {
  authenticated: boolean;
  error?: string;
}

export function InvitationGate({
  authenticated,
  error = "",
}: InvitationGateProps) {
  const [showSignup, setShowSignup] = useState(false);
  const [invitedEmail, setInvitedEmail] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [signInError, setSignInError] = useState("");
  const [accepting, setAccepting] = useState(false);
  const [acceptError, setAcceptError] = useState("");

  useEffect(() => {
    void fetch("/invite/context", { headers: { Accept: "application/json" } })
      .then(async (response) => (response.ok ? response.json() : null))
      .then((context: { email?: string } | null) =>
        setInvitedEmail(context?.email ?? null),
      )
      .catch(() => setInvitedEmail(null));
  }, []);

  async function onSignIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setSignInError("");
    try {
      const result = await signIn.email({ email, password });
      if (result.error) {
        setSignInError(result.error.message || "Sign in failed");
        return;
      }
      window.location.replace(safeInternalPath("/invite/continue"));
    } catch (caught) {
      setSignInError(
        caught instanceof Error ? caught.message : "Sign in failed",
      );
    } finally {
      setLoading(false);
    }
  }

  async function onAccept() {
    setAccepting(true);
    setAcceptError("");
    try {
      const response = await fetch("/api/invitations/accept", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({}),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(
          payload.error || "This invitation is invalid or expired.",
        );
      }
      window.location.replace("/grants");
    } catch (caught) {
      setAcceptError(
        caught instanceof Error
          ? caught.message
          : "This invitation is invalid or expired.",
      );
    } finally {
      setAccepting(false);
    }
  }

  if (authenticated) {
    return (
      <Card className="w-full max-w-md">
        <CardContent className="space-y-5 p-8 text-center">
          <h1 className="text-2xl font-bold tracking-tight">
            Workspace invitation
          </h1>
          <p className="text-sm text-muted-foreground">
            Accept this invitation to join the workspace. The workspace details
            will be available after acceptance.
          </p>
          {(acceptError || error) && (
            <Alert variant="destructive" role="alert">
              <AlertDescription>{acceptError || error}</AlertDescription>
            </Alert>
          )}
          <Button
            type="button"
            disabled={accepting}
            onClick={() => void onAccept()}
            className="w-full"
          >
            {accepting ? "Accepting..." : "Accept invitation"}
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (showSignup) {
    return (
      <div className="w-full max-w-sm space-y-4">
        <SignupForm
          continueTo="/invite/continue"
          lockedEmail={invitedEmail ?? undefined}
        />
        <Button
          type="button"
          variant="ghost"
          className="w-full text-muted-foreground"
          onClick={() => setShowSignup(false)}
        >
          Already have an account? Sign in
        </Button>
      </div>
    );
  }

  return (
    <Card className="w-full max-w-sm">
      <CardContent className="space-y-6 p-8">
        <div className="space-y-1 text-center">
          <h1 className="text-2xl font-bold tracking-tight">
            Workspace invitation
          </h1>
          <p className="text-sm text-muted-foreground">
            Sign in to review and accept your invitation.
          </p>
        </div>
        <form onSubmit={onSignIn} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="invitation-email">Email</Label>
            <Input
              id="invitation-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="invitation-password">Password</Label>
            <Input
              id="invitation-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </div>
          {signInError && (
            <Alert variant="destructive" role="alert">
              <AlertDescription>{signInError}</AlertDescription>
            </Alert>
          )}
          <Button type="submit" disabled={loading} className="w-full">
            {loading ? "Signing in..." : "Sign in"}
          </Button>
        </form>
        <Button
          type="button"
          variant="ghost"
          disabled={!invitedEmail}
          className="w-full text-muted-foreground"
          onClick={() => setShowSignup(true)}
        >
          Need an account? Sign up
        </Button>
      </CardContent>
    </Card>
  );
}
