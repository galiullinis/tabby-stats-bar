import { buildExtraMetrics, extraMetricsFor } from '../src/services/extra-metrics'
import { migrateRetiredPresets, BUILTIN_PRESETS } from '../src/builtin-presets'

describe('buildExtraMetrics', () => {
    const stats = { uptime: 90000, load1: 0.42, users: 3, sessions: 0 }

    it('returns nothing when every toggle is off', () => {
        expect(buildExtraMetrics({}, stats)).toEqual([])
        expect(buildExtraMetrics(null, null)).toEqual([])
    })

    it('keeps a fixed order regardless of which toggles are on', () => {
        const conf = { showSessions: true, showUptime: true, showUsers: true, showLoad: true }
        expect(buildExtraMetrics(conf, stats).map(m => m.key)).toEqual(['uptime', 'load', 'users', 'sessions'])
    })

    it('formats the values it shows', () => {
        const conf = { showUptime: true, showLoad: true, showUsers: true, showSessions: true }
        expect(buildExtraMetrics(conf, stats).map(m => m.value)).toEqual(['1d 1h', '0.42', '3', '0'])
    })

    it('shows a dash when the host did not report a counter', () => {
        const conf = { showUsers: true, showSessions: true }
        expect(buildExtraMetrics(conf, {}).map(m => m.value)).toEqual(['-', '-'])
    })

    it('emits only the enabled metrics', () => {
        expect(buildExtraMetrics({ showUptime: true }, stats).map(m => m.label)).toEqual(['UP'])
    })
})

describe('extraMetricsFor', () => {
    const conf = { showUptime: true, showLoad: true, showUsers: true, showSessions: true }
    const all = buildExtraMetrics(conf, { uptime: 100, load1: 1, users: 1, sessions: 1 })

    it('puts uptime right after NET and the rest after DISK', () => {
        expect(extraMetricsFor('afterNet', all).map(m => m.key)).toEqual(['uptime'])
        expect(extraMetricsFor('afterDisk', all).map(m => m.key)).toEqual(['load', 'users', 'sessions'])
    })

    it('assigns every metric to exactly one slot', () => {
        const slotted = extraMetricsFor('afterNet', all).length + extraMetricsFor('afterDisk', all).length
        expect(slotted).toBe(all.length)
    })

    it('is empty when nothing is enabled', () => {
        expect(extraMetricsFor('afterNet', [])).toEqual([])
    })
})

describe('BUILTIN_PRESETS', () => {
    it('no longer ships the metrics that became first-class', () => {
        const labels = BUILTIN_PRESETS.map(p => p.label)
        expect(labels).not.toContain('Uptime')
        expect(labels).not.toContain('Load')
        expect(labels).not.toContain('Users')
        expect(labels).not.toContain('SSH Sessions')
        expect(labels).not.toContain('I/O Wait')
    })

    it('has no command that ends in grep -c (exits 1 on zero → prints "0" and "Err")', () => {
        BUILTIN_PRESETS.forEach(p => expect(p.command).not.toContain('grep -c'))
    })
})

describe('migrateRetiredPresets', () => {
    const retired = (command: string) => ({ id: '1', label: 'X', command, type: 'text' as const })

    it('does nothing without custom metrics', () => {
        expect(migrateRetiredPresets({})).toBe(false)
        expect(migrateRetiredPresets({ customMetrics: [] })).toBe(false)
        expect(migrateRetiredPresets(null)).toBe(false)
    })

    it('drops a retired preset copy and turns on the metric that replaced it', () => {
        const conf: any = { customMetrics: [retired('who | grep -c pts')] }
        expect(migrateRetiredPresets(conf)).toBe(true)
        expect(conf.customMetrics).toEqual([])
        expect(conf.showUsers).toBe(true)
    })

    it('migrates every retired command and keeps genuine custom metrics', () => {
        const mine = retired('nvidia-smi --query-gpu=utilization.gpu --format=csv,noheader')
        const conf: any = {
            customMetrics: [
                retired(`awk '{d=int($1/86400); h=int(($1%86400)/3600); print d"d "h"h"}' /proc/uptime`),
                retired(`cat /proc/loadavg | awk '{print $1}'`),
                retired(`ss -tn src :22 | grep -c ESTAB`),
                retired(`iostat -c 1 1 | awk 'NR==4{print $4}'`),
                mine,
            ],
        }
        expect(migrateRetiredPresets(conf)).toBe(true)
        expect(conf.customMetrics).toEqual([mine])
        expect(conf.showUptime).toBe(true)
        expect(conf.showLoad).toBe(true)
        expect(conf.showSessions).toBe(true)
        expect(conf.showIoWait).toBe(true)
    })

    it('drops the superseded Temp command without enabling anything', () => {
        const conf: any = {
            customMetrics: [retired(`cat /sys/class/thermal/thermal_zone0/temp 2>/dev/null | awk '{print int($1/1000)}' || echo 0`)],
        }
        expect(migrateRetiredPresets(conf)).toBe(true)
        expect(conf.customMetrics).toEqual([])
    })

    it('is idempotent', () => {
        const conf: any = { customMetrics: [retired('who | grep -c pts')] }
        migrateRetiredPresets(conf)
        expect(migrateRetiredPresets(conf)).toBe(false)
    })
})
