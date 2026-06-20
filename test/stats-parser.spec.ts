import {
    parseBaseSample,
    computeDeltaStats,
    finalizeSample,
    parseCustom,
    buildCustomMetricsFragment,
    parseDiskMounts,
    selectCompactMounts,
    formatMountsTooltip,
    buildDiskMountsFragment,
    formatSpeed,
    formatBytes,
    MARKERS,
    DeltaSample,
    DiskMount,
} from '../src/services/stats-parser'

const GiB = 1024 ** 3
const mnt = (mount: string, usagePercent: number, totalBytes = 100 * GiB): DiskMount => ({
    mount, usagePercent, totalBytes, usedBytes: totalBytes * usagePercent / 100, availableBytes: 0,
})

const metric = (id: string, command = 'echo 1') => ({
    id, label: id, command, type: 'text' as const,
})

describe('parseBaseSample', () => {
    it('parses delta-mode line (cpuTotal cpuIdle cpuIowait rx tx mem memUsed memTotal disk)', () => {
        const out = `${MARKERS.start} D 1000 800 50 5000 6000 42.5 2147483648 8589934592 80 ${MARKERS.end}`
        expect(parseBaseSample(out)).toEqual({
            mode: 'D', nums: [1000, 800, 50, 5000, 6000, 42.5, 2147483648, 8589934592, 80],
        })
    })

    it('parses values-mode line (cpu iowait rx tx mem memUsed memTotal disk)', () => {
        const out = `${MARKERS.start} V 12.5 0 0 0 33.3 2000 6000 50 ${MARKERS.end}`
        expect(parseBaseSample(out)).toEqual({ mode: 'V', nums: [12.5, 0, 0, 0, 33.3, 2000, 6000, 50] })
    })

    it('returns null when no base line', () => {
        expect(parseBaseSample('nope')).toBeNull()
        expect(parseBaseSample('')).toBeNull()
    })
})

describe('computeDeltaStats', () => {
    const base: DeltaSample = { cpuTotal: 1000, cpuIdle: 900, cpuIowait: 0, rx: 1000, tx: 2000, t: 1000 }

    it('returns zeros without a previous sample', () => {
        expect(computeDeltaStats(null, base)).toEqual({ cpu: 0, iowait: 0, netRx: 0, netTx: 0 })
    })

    it('computes cpu%, iowait% and byte/s rates over the interval', () => {
        const prev: DeltaSample = { cpuTotal: 1000, cpuIdle: 900, cpuIowait: 100, rx: 1000, tx: 2000, t: 1000 }
        const curr: DeltaSample = { cpuTotal: 1100, cpuIdle: 950, cpuIowait: 120, rx: 3048, tx: 6000, t: 2000 }
        // dt=1s, totalD=100, idleD=50 -> cpu=50%; iowaitD=20/100 -> 20%; rxD=2048; txD=4000
        expect(computeDeltaStats(prev, curr)).toEqual({ cpu: 50, iowait: 20, netRx: 2048, netTx: 4000 })
    })

    it('clamps to 0..100 and never returns negative net', () => {
        const prev: DeltaSample = { cpuTotal: 1000, cpuIdle: 500, cpuIowait: 100, rx: 5000, tx: 5000, t: 1000 }
        const curr: DeltaSample = { cpuTotal: 1100, cpuIdle: 400, cpuIowait: 50, rx: 10, tx: 10, t: 2000 }
        const r = computeDeltaStats(prev, curr)
        expect(r.netRx).toBe(0)
        expect(r.netTx).toBe(0)
        expect(r.cpu).toBeGreaterThanOrEqual(0)
        expect(r.cpu).toBeLessThanOrEqual(100)
        expect(r.iowait).toBeGreaterThanOrEqual(0)
        expect(r.iowait).toBeLessThanOrEqual(100)
    })

    it('returns zeros for non-positive interval', () => {
        const prev: DeltaSample = { ...base, t: 2000 }
        const curr: DeltaSample = { ...base, t: 2000 }
        expect(computeDeltaStats(prev, curr)).toEqual({ cpu: 0, iowait: 0, netRx: 0, netTx: 0 })
    })

    it('treats a stale gap (>30s) as a fresh start', () => {
        const prev: DeltaSample = { cpuTotal: 1000, cpuIdle: 900, cpuIowait: 0, rx: 0, tx: 0, t: 0 }
        const curr: DeltaSample = { cpuTotal: 9000, cpuIdle: 1000, cpuIowait: 500, rx: 1e9, tx: 1e9, t: 60_000 }
        expect(computeDeltaStats(prev, curr)).toEqual({ cpu: 0, iowait: 0, netRx: 0, netTx: 0 })
    })
})

describe('finalizeSample', () => {
    it('values mode maps fields directly (incl. iowait/memUsed/memTotal) and keeps no sample', () => {
        const { stats, nextSample } = finalizeSample({ mode: 'V', nums: [10, 0, 1, 2, 30, 2000, 6000, 40] }, null, 1000)
        expect(stats).toEqual({ cpu: 10, iowait: 0, netRx: 1, netTx: 2, mem: 30, disk: 40, memUsed: 2000, memTotal: 6000 })
        expect(nextSample).toBeNull()
    })

    it('delta mode computes cpu/iowait against prev, maps mem bytes, returns next sample', () => {
        const prev: DeltaSample = { cpuTotal: 1000, cpuIdle: 900, cpuIowait: 0, rx: 0, tx: 0, t: 1000 }
        const { stats, nextSample } = finalizeSample(
            { mode: 'D', nums: [1100, 950, 10, 1024, 2048, 55, 2147483648, 8589934592, 70] }, prev, 2000)
        expect(stats.cpu).toBe(50)
        expect(stats.iowait).toBe(10) // iowaitD=10/totalD=100 -> 10%
        expect(stats.netRx).toBe(1024)
        expect(stats.netTx).toBe(2048)
        expect(stats.mem).toBe(55)
        expect(stats.disk).toBe(70)
        expect(stats.memUsed).toBe(2147483648)
        expect(stats.memTotal).toBe(8589934592)
        expect(nextSample).toEqual({ cpuTotal: 1100, cpuIdle: 950, cpuIowait: 10, rx: 1024, tx: 2048, t: 2000 })
    })

    it('delta mode first sample yields zero cpu/iowait/net but real mem/disk', () => {
        const { stats } = finalizeSample({ mode: 'D', nums: [1000, 900, 5, 5, 5, 60, 100, 200, 75] }, null, 1000)
        expect(stats).toMatchObject({ cpu: 0, iowait: 0, netRx: 0, netTx: 0, mem: 60, disk: 75, memUsed: 100, memTotal: 200 })
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

describe('parseDiskMounts', () => {
    it('returns undefined without the disk section', () => {
        expect(parseDiskMounts('whatever')).toBeUndefined()
    })

    it('parses lines: used total avail pct mount', () => {
        const out = [
            MARKERS.diskStart,
            '21474836480 53687091200 32212254720 42 /',
            '8589934592 10737418240 2147483648 81 /data',
            MARKERS.diskEnd,
        ].join('\n')
        expect(parseDiskMounts(out)).toEqual([
            { mount: '/', usedBytes: 21474836480, totalBytes: 53687091200, availableBytes: 32212254720, usagePercent: 42 },
            { mount: '/data', usedBytes: 8589934592, totalBytes: 10737418240, availableBytes: 2147483648, usagePercent: 81 },
        ])
    })

    it('keeps mount paths containing spaces', () => {
        const out = `${MARKERS.diskStart}\n100 200 100 50 /mnt/My Disk\n${MARKERS.diskEnd}`
        expect(parseDiskMounts(out)![0].mount).toBe('/mnt/My Disk')
    })

    it('skips malformed lines and zero-total mounts', () => {
        const out = `${MARKERS.diskStart}\ngarbage\n0 0 0 0 /empty\n10 20 10 50 /ok\n${MARKERS.diskEnd}`
        const r = parseDiskMounts(out)!
        expect(r).toHaveLength(1)
        expect(r[0].mount).toBe('/ok')
    })
})

describe('selectCompactMounts', () => {
    it('returns [] for empty', () => {
        expect(selectCompactMounts([])).toEqual([])
        expect(selectCompactMounts(undefined)).toEqual([])
    })

    it('puts root first, then fullest significant mounts', () => {
        const mounts = [mnt('/', 42), mnt('/data', 81), mnt('/home', 60), mnt('/var', 95)]
        const r = selectCompactMounts(mounts, 2)
        expect(r.map(m => m.mount)).toEqual(['/', '/var', '/data'])
    })

    it('drops insignificant (tiny) mounts from the extras but keeps root', () => {
        const mounts = [mnt('/', 30), mnt('/boot/efi', 99, 100 * 1024 * 1024)] // 100MB < 1GiB
        expect(selectCompactMounts(mounts).map(m => m.mount)).toEqual(['/'])
    })

    it('works without a root mount', () => {
        const r = selectCompactMounts([mnt('/data', 70), mnt('/srv', 90)], 3)
        expect(r.map(m => m.mount)).toEqual(['/srv', '/data'])
    })
})

describe('formatMountsTooltip', () => {
    it('lists every mount with used/total', () => {
        const t = formatMountsTooltip([mnt('/', 50, 8 * GiB)])
        expect(t).toBe('/  50%  (4.0G/8.0G)')
    })
    it('is empty for no mounts', () => {
        expect(formatMountsTooltip([])).toBe('')
    })
})

describe('buildDiskMountsFragment', () => {
    it('uses df -P (not -h), filters /dev, and wraps in markers', () => {
        const f = buildDiskMountsFragment()
        expect(f).toContain(MARKERS.diskStart)
        expect(f).toContain(MARKERS.diskEnd)
        expect(f).toContain('df -P -B1')   // linux: bytes
        expect(f).toContain('df -P -k')    // macOS: KiB ->*1024
        expect(f).not.toContain('df -h')
        expect(f).toContain('/^\\/dev\\//')
    })
})

describe('formatBytes', () => {
    it('handles zero/negative', () => {
        expect(formatBytes(0)).toBe('0.0')
        expect(formatBytes(-1)).toBe('0.0')
    })
    it('always keeps one decimal for stable width', () => {
        expect(formatBytes(8 * 1024 ** 3)).toBe('8.0G')
        expect(formatBytes(512 * 1024 ** 2)).toBe('512.0M')
        expect(formatBytes(2147483648)).toBe('2.0G')
        expect(formatBytes(3.2 * 1024 ** 3)).toBe('3.2G')
    })
})
