import {
    parseBaseSample,
    computeDeltaStats,
    finalizeSample,
    parseCustom,
    buildCustomMetricsFragment,
    formatSpeed,
    MARKERS,
    DeltaSample,
} from '../src/services/stats-parser'

const metric = (id: string, command = 'echo 1') => ({
    id, label: id, command, type: 'text' as const,
})

describe('parseBaseSample', () => {
    it('parses delta-mode line', () => {
        const out = `${MARKERS.start} D 1000 800 5000 6000 42.5 80 ${MARKERS.end}`
        expect(parseBaseSample(out)).toEqual({ mode: 'D', nums: [1000, 800, 5000, 6000, 42.5, 80] })
    })

    it('parses values-mode line', () => {
        const out = `${MARKERS.start} V 12.5 0 0 33.3 50 ${MARKERS.end}`
        expect(parseBaseSample(out)).toEqual({ mode: 'V', nums: [12.5, 0, 0, 33.3, 50] })
    })

    it('returns null when no base line', () => {
        expect(parseBaseSample('nope')).toBeNull()
        expect(parseBaseSample('')).toBeNull()
    })
})

describe('computeDeltaStats', () => {
    const base: DeltaSample = { cpuTotal: 1000, cpuIdle: 900, rx: 1000, tx: 2000, t: 1000 }

    it('returns zeros without a previous sample', () => {
        expect(computeDeltaStats(null, base)).toEqual({ cpu: 0, netRx: 0, netTx: 0 })
    })

    it('computes cpu% and byte/s rates over the interval', () => {
        const prev: DeltaSample = { cpuTotal: 1000, cpuIdle: 900, rx: 1000, tx: 2000, t: 1000 }
        const curr: DeltaSample = { cpuTotal: 1100, cpuIdle: 950, rx: 3048, tx: 6000, t: 2000 }
        // dt=1s, totalD=100, idleD=50 -> cpu=50%; rxD=2048/1s=2048; txD=4000/1s=4000
        expect(computeDeltaStats(prev, curr)).toEqual({ cpu: 50, netRx: 2048, netTx: 4000 })
    })

    it('clamps cpu to 0..100 and never returns negative net', () => {
        const prev: DeltaSample = { cpuTotal: 1000, cpuIdle: 500, rx: 5000, tx: 5000, t: 1000 }
        // counter reset: curr < prev -> net clamped to 0; idle moved backwards
        const curr: DeltaSample = { cpuTotal: 1100, cpuIdle: 400, rx: 10, tx: 10, t: 2000 }
        const r = computeDeltaStats(prev, curr)
        expect(r.netRx).toBe(0)
        expect(r.netTx).toBe(0)
        expect(r.cpu).toBeLessThanOrEqual(100)
        expect(r.cpu).toBeGreaterThanOrEqual(0)
    })

    it('returns zeros for non-positive interval', () => {
        const prev: DeltaSample = { ...base, t: 2000 }
        const curr: DeltaSample = { ...base, t: 2000 }
        expect(computeDeltaStats(prev, curr)).toEqual({ cpu: 0, netRx: 0, netTx: 0 })
    })

    it('treats a stale gap (>30s) as a fresh start', () => {
        const prev: DeltaSample = { cpuTotal: 1000, cpuIdle: 900, rx: 0, tx: 0, t: 0 }
        const curr: DeltaSample = { cpuTotal: 9000, cpuIdle: 1000, rx: 1e9, tx: 1e9, t: 60_000 }
        expect(computeDeltaStats(prev, curr)).toEqual({ cpu: 0, netRx: 0, netTx: 0 })
    })
})

describe('finalizeSample', () => {
    it('values mode maps fields directly and keeps no sample', () => {
        const { stats, nextSample } = finalizeSample({ mode: 'V', nums: [10, 1, 2, 30, 40] }, null, 1000)
        expect(stats).toEqual({ cpu: 10, netRx: 1, netTx: 2, mem: 30, disk: 40 })
        expect(nextSample).toBeNull()
    })

    it('delta mode computes against prev and returns the next sample', () => {
        const prev: DeltaSample = { cpuTotal: 1000, cpuIdle: 900, rx: 0, tx: 0, t: 1000 }
        const { stats, nextSample } = finalizeSample(
            { mode: 'D', nums: [1100, 950, 1024, 2048, 55, 70] }, prev, 2000)
        expect(stats.cpu).toBe(50)
        expect(stats.netRx).toBe(1024)
        expect(stats.netTx).toBe(2048)
        expect(stats.mem).toBe(55)
        expect(stats.disk).toBe(70)
        expect(nextSample).toEqual({ cpuTotal: 1100, cpuIdle: 950, rx: 1024, tx: 2048, t: 2000 })
    })

    it('delta mode first sample yields zero cpu/net but real mem/disk', () => {
        const { stats } = finalizeSample({ mode: 'D', nums: [1000, 900, 5, 5, 60, 75] }, null, 1000)
        expect(stats).toMatchObject({ cpu: 0, netRx: 0, netTx: 0, mem: 60, disk: 75 })
    })
})

describe('parseCustom', () => {
    it('returns undefined without metrics or marker', () => {
        expect(parseCustom('x', [])).toBeUndefined()
        expect(parseCustom('no marker', [metric('a')])).toBeUndefined()
    })

    it('parses values in order and fills missing with dash', () => {
        const metrics = [metric('a'), metric('b'), metric('c')]
        const out = `${MARKERS.customStart} 10 ${MARKERS.next} hi ${MARKERS.end}`
        expect(parseCustom(out, metrics)).toEqual([
            { id: 'a', value: '10' },
            { id: 'b', value: 'hi' },
            { id: 'c', value: '-' },
        ])
    })
})

describe('buildCustomMetricsFragment', () => {
    it('returns empty for no metrics', () => {
        expect(buildCustomMetricsFragment([])).toBe('')
    })
    it('wraps commands and joins with NEXT', () => {
        const frag = buildCustomMetricsFragment([metric('a', 'foo'), metric('b', 'bar')])
        expect(frag).toContain(MARKERS.customStart)
        expect(frag).toContain('( foo ) || echo "Err"')
        expect(frag).toContain(MARKERS.next)
    })
})

describe('formatSpeed', () => {
    it('handles zero/negative/NaN', () => {
        expect(formatSpeed(0)).toBe('0 B/s')
        expect(formatSpeed(-5)).toBe('0 B/s')
        expect(formatSpeed(NaN)).toBe('0 B/s')
    })
    it('formats magnitudes', () => {
        expect(formatSpeed(512)).toBe('512 B/s')
        expect(formatSpeed(1024)).toBe('1 K/s')
        expect(formatSpeed(1024 * 1024)).toBe('1 M/s')
    })
    it('clamps to top unit', () => {
        expect(formatSpeed(1024 ** 5)).toContain('G/s')
    })
})
