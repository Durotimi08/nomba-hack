"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { setSession, useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const DEMO_PASSWORD = "kobo-demo-password";

export default function LoginPage() {
  const router = useRouter();
  const { session, ready } = useAuth();
  const [email, setEmail] = useState("maker@kobo.dev");
  const [password, setPassword] = useState(DEMO_PASSWORD);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (ready && session) router.replace("/");
  }, [ready, session, router]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await api.login(email.trim(), password);
      setSession({ token: res.token, role: res.role, email: res.email });
      router.replace("/");
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setError("Invalid email or password.");
      } else if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError("Could not reach the reconciliation API.");
      }
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="mb-3 flex size-12 items-center justify-center rounded-xl bg-primary text-lg font-bold text-primary-foreground">
            ₦
          </div>
          <h1 className="text-xl font-semibold text-foreground">Kobo</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Virtual-account reconciliation console
          </p>
        </div>

        <Card>
          <CardContent className="pt-6">
            <form onSubmit={onSubmit} className="space-y-4">
              <div className="grid gap-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="username"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>

              {error ? (
                <p className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">
                  {error}
                </p>
              ) : null}

              <Button type="submit" disabled={submitting} className="w-full">
                {submitting ? <Loader2 className="size-4 animate-spin" /> : null}
                Sign in
              </Button>
            </form>
          </CardContent>
        </Card>

        <div className="mt-4 rounded-xl border border-dashed border-border bg-card/60 p-4 text-xs text-muted-foreground">
          <p className="mb-2 font-medium text-foreground">Seeded demo accounts</p>
          <ul className="space-y-1.5">
            {["maker@kobo.dev", "checker@kobo.dev"].map((demo) => (
              <li key={demo} className="flex items-center justify-between gap-3">
                <span className="font-mono">{demo}</span>
                <button
                  type="button"
                  onClick={() => setEmail(demo)}
                  className="font-medium text-primary hover:underline"
                >
                  use
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-2">
            Password: <span className="font-mono">{DEMO_PASSWORD}</span>
          </p>
        </div>
      </div>
    </div>
  );
}
