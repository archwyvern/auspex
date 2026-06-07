export function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-[3px] border border-hairline bg-panel-bright px-1.5 py-0.5 text-sm text-neutral-50">
      {children}
    </span>
  )
}
