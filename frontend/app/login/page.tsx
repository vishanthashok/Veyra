"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { BrandLogo } from "@/components/brand-logo";
import { ErrorBox } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { api } from "@/lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post("/auth/login", { email, password });
      router.push("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-sm">
        <CardContent className="py-6">
          <div className="mb-6">
            <h1><BrandLogo size={56} /></h1>
            <p className="mt-2 text-sm text-muted-foreground">CAM pre-close audit</p>
          </div>
          <ErrorBox error={error} />
          <form onSubmit={submit} className="flex flex-col gap-3">
            <Label>Email<Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="username" /></Label>
            <Label>Password<Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" /></Label>
            <Button type="submit" disabled={busy}>{busy ? "Signing in" : "Sign in"}</Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}

