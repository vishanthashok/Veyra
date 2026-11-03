export function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="rounded border border-line-strong bg-surface-2 px-1 font-sans text-2xs text-muted">{children}</kbd>;
}
