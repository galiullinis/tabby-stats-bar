import type { CustomMetric } from '../config'

// Markers emitted by the stats shell command. Kept here so both the command
// builder and the parser stay in sync, and so the parser can be unit-tested in
// isolation from the Angular/SSH runtime.
export const MARKERS = {
    start: 'TABBY-STATS-START',
    customStart: 'TABBY-STATS-CUSTOM-START',
    next: 'TABBY-STATS-NEXT',
    end: 'TABBY-STATS-END',
}

export interface ParsedStats {
    cpu: number
    netRx: number
    netTx: number
    mem: number
    disk: number
    custom?: Array<{ id: string; value: string }>
}

const STATS_RE = new RegExp(
    `${MARKERS.start}\\s+([\\d.]+)\\s+([\\d.]+)\\s+([\\d.]+)\\s+([\\d.]+)\\s+([\\d.]+)`
)

/**
 * Parse the raw stdout produced by the stats command into a structured object.
 * Pure function — no side effects, safe to unit-test.
 */
export function parseStatsOutput(output: string, customMetrics: CustomMetric[] = []): ParsedStats | null {
    if (!output) {
        return null
    }

    const result: ParsedStats = { cpu: 0, netRx: 0, netTx: 0, mem: 0, disk: 0 }
    const match = output.match(STATS_RE)

    if (match && match.length >= 6) {
        result.cpu = parseFloat(match[1]) || 0
        result.netRx = parseFloat(match[2]) || 0
        result.netTx = parseFloat(match[3]) || 0
        result.mem = parseFloat(match[4]) || 0
        result.disk = parseFloat(match[5]) || 0
    } else {
        // No base block at all — nothing usable.
        return null
    }

    if (customMetrics.length > 0 && output.includes(MARKERS.customStart)) {
        const customPart = output.split(MARKERS.customStart)[1].split(MARKERS.end)[0]
        const customValues = customPart.split(MARKERS.next).map(s => s.trim())
        result.custom = customMetrics.map((m, index) => ({
            id: m.id,
            value: customValues[index] || '-',
        }))
    }

    return result
}

/**
 * Build the `(cmd) || echo "Err"` fragment for custom metrics, joined by the
 * NEXT marker. Pure so it can be tested without running a shell.
 */
export function buildCustomMetricsFragment(customMetrics: CustomMetric[]): string {
    if (!customMetrics.length) {
        return ''
    }
    const customCmds = customMetrics
        .map(m => `( ${m.command} ) || echo "Err"`)
        .join(`; echo "${MARKERS.next}"; `)
    return `; echo "${MARKERS.customStart}"; ${customCmds}`
}

/** Format a bytes/second value into a short human string. */
export function formatSpeed(bytes: number): string {
    if (!bytes || bytes <= 0) {
        return '0 B/s'
    }
    const k = 1024
    const sizes = ['B/s', 'K/s', 'M/s', 'G/s']
    let i = Math.floor(Math.log(bytes) / Math.log(k))
    if (i < 0) {
        i = 0
    }
    if (i >= sizes.length) {
        i = sizes.length - 1
    }
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}
