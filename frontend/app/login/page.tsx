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
      <Field label="Work email" required>
        <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" autoFocus />
      </Field>
      <Field label="Password" required>
        <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
      </Field>
      <Button type="submit" variant="primary" size="md" loading={busy}>
        Sign in
      </Button>
    </form>
  );
}

const POINTS = [
  ["Traceable", "Every tenant figure opens to the GL rows, lease rule and formula behind it."],
  ["Reproducible", "Each audit run freezes its inputs, so it can be re-verified later."],
  ["Reviewed", "Nothing is recoverable or approved until a person decides, with a note."],
];

export default function LoginPage() {
  return (
    <main className="grid min-h-screen lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <section className="hidden flex-col justify-between bg-nav p-12 text-nav-ink lg:flex">
        <div className="flex items-center gap-2.5">
          <span className="flex size-7 items-center justify-center rounded-[7px] bg-[#e8f3f0] text-sm font-bold text-[#0d7a6a]" aria-hidden>
            V
          </span>
          <span className="text-lg font-semibold tracking-[-0.01em] text-white">Veyra</span>
        </div>
        <div className="max-w-md">
          <p className="text-2xl font-semibold leading-[1.25] tracking-[-0.02em] text-white">
            Every expense accounted for. Every recovery explained.
          </p>
          <ul className="mt-8 space-y-5">
            {POINTS.map(([t, d]) => (
              <li key={t} className="flex gap-3">
                <span className="mt-2 size-1.5 shrink-0 rounded-full bg-[#5fb3a6]" aria-hidden />
                <span>
                  <span className="block text-sm font-medium text-white">{t}</span>
                  <span className="text-sm text-nav-muted">{d}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
        <p className="text-xs text-nav-muted">CAM pre-close audits. Provisional results for accountant review.</p>
      </section>
      <section className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-[360px]">
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <span className="flex size-7 items-center justify-center rounded-[7px] bg-nav text-sm font-bold text-white" aria-hidden>
              V
            </span>
            <span className="text-lg font-semibold">Veyra</span>
          </div>
          <h1 className="text-2xl font-semibold tracking-[-0.02em] text-ink">Sign in</h1>
          <p className="mb-7 mt-1 text-sm text-muted">Use your Veyra work account.</p>
          <Suspense>
            <LoginForm />
          </Suspense>
        </div>
      </section>
    </main>
  );
}
