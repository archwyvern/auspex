export function formatInt(value: number): string {
  return Math.round(value).toLocaleString('en-GB')
}

export function formatUptime(startMs: number | null): string {
  if (startMs === null) return '--:--'
  const totalSec = Math.max(0, Math.floor((Date.now() - startMs) / 1000))
  const minutes = Math.floor(totalSec / 60)
  const seconds = totalSec % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

export function formatSessionSeconds(tsUs: number, tsFreq: number): string {
  return `${(tsUs / tsFreq).toFixed(1)}s`
}
