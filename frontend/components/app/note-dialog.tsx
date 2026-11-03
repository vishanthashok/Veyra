"use client";
import * as React from "react";
import { errorText } from "@/lib/api";
import { Button } from "../ui/button";
import { Dialog, DialogContent } from "../ui/dialog";
import { Field, Textarea } from "../ui/input";

type Ask = {
  title: string;
  description?: React.ReactNode;
  label?: string;
  confirm: string;
  danger?: boolean;
  placeholder?: string;
  onSubmit: (note: string) => Promise<unknown>;
};

/**
 * Promise-free imperative dialog for reviewer notes (replaces window.prompt, F-16).
 * Usage: const { ask, dialog } = useNoteDialog(); ... ask({...}); render {dialog}.
 */
export function useNoteDialog() {
  const [cfg, setCfg] = React.useState<Ask | null>(null);
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  const ask = React.useCallback((c: Ask) => { setCfg(c); setNote(""); setErr(null); }, []);
  const close = () => { if (!busy) setCfg(null); };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!cfg) return;
    if (note.trim().length < 3) { setErr("Write at least a few words. This note is part of the audit record."); return; }
    setBusy(true);
    try {
      await cfg.onSubmit(note.trim());
      setCfg(null);
    } catch (x) {
      setErr(errorText(x));
    } finally {
      setBusy(false);
    }
  }

  const dialog = (
    <Dialog open={!!cfg} onOpenChange={(o) => !o && close()}>
      {cfg && (
        <DialogContent title={cfg.title} description={cfg.description}>
          <form onSubmit={submit} className="flex flex-col gap-4">
            <Field label={cfg.label ?? "Reviewer note"} hint="Saved with your name and the time." error={err} required>
              <Textarea autoFocus value={note} onChange={(e) => setNote(e.target.value)} placeholder={cfg.placeholder} />
            </Field>
            <div className="flex justify-end gap-2">
              <Button type="button" onClick={close} disabled={busy}>Cancel</Button>
              <Button type="submit" variant={cfg.danger ? "danger" : "primary"} loading={busy}>{cfg.confirm}</Button>
            </div>
          </form>
        </DialogContent>
      )}
    </Dialog>
  );
  return { ask, dialog };
}

/** Confirmation for destructive or deliberate actions. */
export function ConfirmDialog({
  open, onOpenChange, title, description, confirm, danger, onConfirm, children,
}: {
  open: boolean; onOpenChange: (o: boolean) => void; title: string; description?: React.ReactNode; confirm: string;
  danger?: boolean; onConfirm: () => Promise<unknown> | void; children?: React.ReactNode;
}) {
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!busy) { setErr(null); onOpenChange(o); } }}>
      <DialogContent title={title} description={description}
        footer={<>
          <Button onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button variant={danger ? "danger" : "primary"} loading={busy} onClick={async () => {
            setBusy(true); setErr(null);
            try { await onConfirm(); onOpenChange(false); } catch (x) { setErr(errorText(x)); } finally { setBusy(false); }
          }}>{confirm}</Button>
        </>}>
        {children}
        {err && <p role="alert" className="mt-3 text-sm text-error">{err}</p>}
      </DialogContent>
    </Dialog>
  );
}
