"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { ErrorBox } from "@/components/app/page";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { api, errorText } from "@/lib/api";

function LoginForm() {
  const router = useRouter();
  const next = useSearchParams().get("next");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post("/auth/login", { email, password });
      router.push(next && next.startsWith("/") && !next.startsWith("//") ? next : "/");
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <ErrorBox error={error} className="mb-0" />
      <Field label="Work email" required><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" autoFocus /></Field>
      <Field label="Password" required><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" /></Field>
      <Button type="submit" variant="primary" size="md" loading={busy}>Sign in</Button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <main className="grid min-h-screen lg:grid-cols-[1fr_520px]">
      <section className="hidden flex-col justify-between bg-nav p-10 text-nav-ink lg:flex">
        <div className="flex items-center gap-2">
          <div className="flex size-8 items-center justify-center rounded-md bg-[#5fb3d6] font-bold text-nav" aria-hidden>V</div>
          <span className="text-lg font-semibold text-white">Veyra</span>
        </div>
        <div className="max-w-md">
          <p className="text-2xl font-semibold leading-snug text-white">Every expense accounted for. Every recovery explained.</p>
          <p className="mt-3 text-sm text-nav-muted">CAM pre-close audits with traceable calculations, reviewed mappings and approved lease rules.</p>
        </div>
        <p className="text-xs text-nav-muted">Provisional results for accountant review.</p>
      </section>
      <section className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          <h1 className="text-xl font-semibold text-ink">Sign in</h1>
          <p className="mb-6 mt-1 text-sm text-muted">Use your Veyra account.</p>
          <Suspense><LoginForm /></Suspense>
        </div>
      </section>
    </main>
  );
}
