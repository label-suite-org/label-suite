"use client";

import { useState, type FormEvent } from "react";
import { resetPassword } from "@/lib/auth-client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";

type ResetPasswordFormProps = {
  token: string | null;
  callbackError?: string | null;
};

export function ResetPasswordForm({
  token,
  callbackError = null,
}: ResetPasswordFormProps) {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [loading, setLoading] = useState(false);
  const [complete, setComplete] = useState(false);
  const [error, setError] = useState(
    callbackError ? "This password reset link is invalid or has expired." : "",
  );

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!token) {
      setError("This password reset link is invalid or has expired.");
      return;
    }
    if (password.length < 8 || password.length > 128) {
      setError("Password must be between 8 and 128 characters.");
      return;
    }
    if (password !== confirmation) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);
    setError("");
    try {
      const result = await resetPassword({
        newPassword: password,
        token,
      });
      if (result.error) {
        setError("This password reset link is invalid or has expired.");
      } else {
        setComplete(true);
      }
    } catch {
      setError("This password reset link is invalid or has expired.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="w-full max-w-sm">
      <CardContent className="space-y-6 p-8">
        <div className="space-y-1 text-center">
          <h1 className="text-2xl font-bold tracking-tight">
            Choose a new password
          </h1>
          <p className="text-sm text-muted-foreground">
            {complete
              ? "Your password has been updated."
              : "Use at least 8 characters."}
          </p>
        </div>

        {complete ? (
          <Button render={<a href="/login" />} className="w-full">
            Return to sign in
          </Button>
        ) : (
          <>
            {error && (
              <Alert variant="destructive" role="alert">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <form onSubmit={onSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="new-password">New password</Label>
                <Input
                  id="new-password"
                  type="password"
                  minLength={8}
                  maxLength={128}
                  autoComplete="new-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  disabled={!token || Boolean(callbackError)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="confirm-password">Confirm password</Label>
                <Input
                  id="confirm-password"
                  type="password"
                  minLength={8}
                  maxLength={128}
                  autoComplete="new-password"
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                  required
                  disabled={!token || Boolean(callbackError)}
                />
              </div>
              <Button
                type="submit"
                disabled={loading || !token || Boolean(callbackError)}
                className="w-full"
              >
                {loading ? "Updating..." : "Update password"}
              </Button>
            </form>
            <Button
              variant="ghost"
              className="w-full text-muted-foreground"
              render={<a href="/login" />}
            >
              Back to sign in
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
