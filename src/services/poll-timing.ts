// Pure timing helpers for the polling loop. No Angular/DOM dependencies so they
// can be unit-tested directly.

export const DEFAULT_POLL_INTERVAL_MS = 5000
// Hard floor on the user-configurable interval. 1s is supported (the delta-based
// commands no longer sleep), but we don't allow sub-second to avoid hammering
// remote servers and the renderer.
export const MIN_POLL_INTERVAL_MS = 1000
export const MAX_POLL_INTERVAL_MS = 60_000

/** Clamp a user-provided interval (in seconds) to a safe range, in ms. */
export function clampPollIntervalMs(seconds: number | undefined | null): number {
    const ms = (Number(seconds) || DEFAULT_POLL_INTERVAL_MS / 1000) * 1000
    if (!Number.isFinite(ms)) {
        return DEFAULT_POLL_INTERVAL_MS
    }
    return Math.min(MAX_POLL_INTERVAL_MS, Math.max(MIN_POLL_INTERVAL_MS, ms))
}

/**
 * Adaptive per-request timeout derived from the poll interval. Scales with the
 * interval but stays within a sane band. Overlap is prevented structurally by
 * the self-rescheduling loop (next poll starts only after the current settles),
 * so this is a safety cap rather than the overlap guard.
 */
export function adaptiveTimeoutMs(intervalMs: number): number {
    return Math.min(8000, Math.max(2500, intervalMs * 4))
}

/**
 * Compute the next backoff delay (added on top of the base interval). Exponential
 * on failure starting at `base`, reset to 0 on success. Capped at `max`.
 */
export function nextBackoffMs(current: number, failed: boolean, base = 2000, max = 30_000): number {
    if (!failed) {
        return 0
    }
    if (current <= 0) {
        return base
    }
    return Math.min(max, current * 2)
}

// Floor for the "stale sample" threshold used by the delta computation.
export const MIN_DELTA_GAP_MS = 30_000

/**
 * Max allowed gap between two delta samples before the older one is treated as
 * stale (rate = 0, start over). Must scale with the poll interval: a fixed 30s
 * cap made every sample stale when the user picked a 31–60s interval, so
 * CPU/IOW/network stayed at 0 forever. 3× the interval leaves room for backoff
 * and slow responses while still discarding samples from a long-idle tab.
 */
export function maxDeltaGapMs(intervalMs: number): number {
    return Math.max(MIN_DELTA_GAP_MS, intervalMs * 3)
}
