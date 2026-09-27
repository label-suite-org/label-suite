"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useState, type FormEvent } from "react";
import { signUp } from "@/lib/auth-client";
import { safeInternalPath } from "@/lib/navigation";

interface SignupFormProps {
  continueTo?: string;
  lockedEmail?: string;
}

export function SignupForm({
  continueTo = "/dashboard",
  lockedEmail,
}: SignupFormProps = {}) {
  const safeContinueTo = safeInternalPath(continueTo);
  const [name, setName] = useState("");
  const [email, setEmail] = useState(lockedEmail ?? "");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const result = await signUp.email({ name, email, password });
      if (result.error) {
        setError(result.error.message || "Sign up failed");
        return;
      }
      window.location.replace(safeContinueTo);
    } catch (err: any) {
      setError(err.message || "Sign up failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="w-full max-w-sm">
      <CardContent className="space-y-6 p-8">
        <div className="space-y-1 text-center">
          <h1 className="text-2xl font-bold tracking-tight">Create Account</h1>
          <p className="text-sm text-muted-foreground">
            Get started with Label Suite
          </p>
        </div>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              readOnly={Boolean(lockedEmail)}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          {error && (
            <Alert variant="destructive" role="alert">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <Button type="submit" disabled={loading} className="w-full">
            {loading ? "Creating account..." : "Create Account"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
