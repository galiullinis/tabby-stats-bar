import {
    clampPollIntervalMs,
    adaptiveTimeoutMs,
    nextBackoffMs,
    DEFAULT_POLL_INTERVAL_MS,
    MIN_POLL_INTERVAL_MS,
    MAX_POLL_INTERVAL_MS,
} from '../src/services/poll-timing'

describe('clampPollIntervalMs', () => {
    it('converts seconds to ms', () => {
        expect(clampPollIntervalMs(5)).toBe(5000)
        expect(clampPollIntervalMs(1)).toBe(1000)
    })
    it('enforces the floor (no sub-second hammering)', () => {
        expect(clampPollIntervalMs(0)).toBe(DEFAULT_POLL_INTERVAL_MS) // 0 -> falsy -> default
        expect(clampPollIntervalMs(0.2)).toBe(MIN_POLL_INTERVAL_MS)
    })
    it('enforces the ceiling', () => {
        expect(clampPollIntervalMs(9999)).toBe(MAX_POLL_INTERVAL_MS)
    })
    it('falls back to default on garbage', () => {
        expect(clampPollIntervalMs(undefined)).toBe(DEFAULT_POLL_INTERVAL_MS)
        expect(clampPollIntervalMs(null)).toBe(DEFAULT_POLL_INTERVAL_MS)
        expect(clampPollIntervalMs(NaN as any)).toBe(DEFAULT_POLL_INTERVAL_MS)
    })
})

describe('adaptiveTimeoutMs', () => {
    it('scales with the interval but stays banded', () => {
        expect(adaptiveTimeoutMs(1000)).toBe(4000)   // 1s*4
        expect(adaptiveTimeoutMs(500)).toBe(2500)    // floor
        expect(adaptiveTimeoutMs(5000)).toBe(8000)   // ceil (5s*4=20s -> capped)
    })
    it('always leaves room above a 1s interval', () => {
        expect(adaptiveTimeoutMs(clampPollIntervalMs(1))).toBeGreaterThan(1000)
    })
})

describe('nextBackoffMs', () => {
    it('is zero on success', () => {
        expect(nextBackoffMs(8000, false)).toBe(0)
    })
    it('starts at base then doubles on repeated failure', () => {
        expect(nextBackoffMs(0, true)).toBe(2000)
        expect(nextBackoffMs(2000, true)).toBe(4000)
        expect(nextBackoffMs(4000, true)).toBe(8000)
    })
    it('caps at max', () => {
        expect(nextBackoffMs(30_000, true)).toBe(30_000)
        expect(nextBackoffMs(20_000, true)).toBe(30_000)
    })
})
