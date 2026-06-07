import { useEffect, useRef } from 'react'

// Shared canvas plumbing for the rAF-driven components: HiDPI backing store,
// resize tracking, and a render loop that reads the store imperatively.
// React never sees per-frame data; it only mounts/unmounts these surfaces.
export function useCanvasLoop(draw: (ctx: CanvasRenderingContext2D, width: number, height: number) => void) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawRef = useRef(draw)
  drawRef.current = draw

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let width = 0
    let height = 0
    const observer = new ResizeObserver(entries => {
      const entry = entries[0]
      width = entry.contentRect.width
      height = entry.contentRect.height
      const dpr = window.devicePixelRatio || 1
      canvas.width = Math.max(1, Math.round(width * dpr))
      canvas.height = Math.max(1, Math.round(height * dpr))
    })
    observer.observe(canvas)

    let raf = 0
    const loop = () => {
      raf = requestAnimationFrame(loop)
      if (width <= 0 || height <= 0) return
      const dpr = window.devicePixelRatio || 1
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      drawRef.current(ctx, width, height)
    }
    raf = requestAnimationFrame(loop)

    return () => {
      cancelAnimationFrame(raf)
      observer.disconnect()
    }
  }, [])

  return canvasRef
}

// Stable, muted zone palette keyed by interned name id: spread hues with the
// golden angle, keep saturation low so the ember accent and status colors
// stay the loudest things on screen.
const paletteCache = new Map<number, string>()

export function zoneColor(nameId: number): string {
  let color = paletteCache.get(nameId)
  if (!color) {
    const hue = (nameId * 137.508) % 360
    color = `hsl(${hue.toFixed(1)} 42% 34%)`
    paletteCache.set(nameId, color)
  }
  return color
}

// Brighter variant of the same hue for counter plot lines, which are 1-2px
// strokes and need more luminance than zone fills to read.
const lineCache = new Map<number, string>()

export function counterColor(nameId: number): string {
  let color = lineCache.get(nameId)
  if (!color) {
    const hue = (nameId * 137.508) % 360
    color = `hsl(${hue.toFixed(1)} 60% 58%)`
    lineCache.set(nameId, color)
  }
  return color
}

export function formatCounterValue(value: number): string {
  if (Number.isInteger(value)) return value.toLocaleString('en-GB')
  return value.toFixed(1)
}

export function formatDuration(us: number): string {
  if (us >= 1_000_000) return `${(us / 1_000_000).toFixed(2)}s`
  if (us >= 1_000) return `${(us / 1_000).toFixed(2)}ms`
  return `${Math.round(us)}us`
}

// Ruler tick label with enough precision for the step size, so adjacent
// ticks never display identical values.
export function formatTick(us: number, stepUs: number): string {
  if (stepUs >= 1_000_000) return `${(us / 1_000_000).toFixed(0)}s`
  if (stepUs >= 1_000) {
    const decimals = stepUs >= 100_000 ? 1 : stepUs >= 10_000 ? 2 : 3
    return `${(us / 1_000_000).toFixed(decimals)}s`
  }
  return `${(us / 1_000).toFixed(stepUs >= 100 ? 1 : 2)}ms`
}

// Smallest "nice" value >= input, used to quantize axis windows so the ruler
// and budget line don't drift every time an average wobbles.
export function niceCeil(value: number): number {
  const magnitude = Math.pow(10, Math.floor(Math.log10(value)))
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 7.5, 10]) {
    if (magnitude * m >= value) return magnitude * m
  }
  return magnitude * 10
}

// Nice tick step (1-2-5 ladder) targeting ~minPx pixels between ticks.
export function tickStep(usPerPx: number, minPx: number): number {
  const target = usPerPx * minPx
  const magnitude = Math.pow(10, Math.floor(Math.log10(target)))
  for (const m of [1, 2, 5, 10]) {
    if (magnitude * m >= target) return magnitude * m
  }
  return magnitude * 10
}
