export function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-[3px] border border-border bg-surface-raised px-1.5 py-0.5 text-sm text-fg">
      {children}
    </span>
  )
}
