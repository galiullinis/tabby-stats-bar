// Pure helpers for the CPU history sparkline (MobaXterm-like). No DOM here so
// the ring-buffer / clamping logic can be unit-tested; the actual canvas drawing
// lives in the component.

export const MIN_SPARKLINE_BARS = 20
export const MAX_SPARKLINE_BARS = 60
export const DEFAULT_SPARKLINE_BARS = 40

/** Clamp the configured bar count to a sane range. */
export function clampSparklineBars(n: number | undefined | null): number {
    const v = Math.round(Number(n))
    if (!Number.isFinite(v)) {
        return DEFAULT_SPARKLINE_BARS
    }
    return Math.min(MAX_SPARKLINE_BARS, Math.max(MIN_SPARKLINE_BARS, v))
}

/**
 * Append a sample to the history and keep at most `max` entries (oldest dropped
 * from the front). The value is coerced to a 0..100 number. Returns a NEW array.
 */
export function pushSample(history: number[], value: number, max: number): number[] {
    const num = Number(value)
    const v = Number.isFinite(num) ? Math.min(100, Math.max(0, num)) : 0
    const next = [...history, v]
    if (next.length > max) {
        return next.slice(next.length - max)
    }
    return next
}

/** Color for a CPU value, matching the rest of the UI's thresholds. */
export function cpuColor(value: number): string {
    if (value < 50) return '#2ecc71'
    if (value < 80) return '#f1c40f'
    return '#e74c3c'
}
