import type { CustomMetric } from '../config'

// Markers emitted by the stats shell command. Kept here so both the command
// builder and the parser stay in sync, and so the parser can be unit-tested in
// isolation from the Angular/SSH runtime.
export const MARKERS = {
    start: 'TABBY-STATS-START',
    customStart: 'TABBY-STATS-CUSTOM-START',
    next: 'TABBY-STATS-NEXT',
    diskStart: 'TABBY-STATS-DISK-START',
    diskEnd: 'TABBY-STATS-DISK-END',
    end: 'TABBY-STATS-END',
}

export interface DiskMount {
    mount: string
    usedBytes: number
    totalBytes: number
    availableBytes: number
    usagePercent: number
}

// Mounts smaller than this are not interesting for the "fullest mounts" picker
// (skips tiny things like /boot/efi). The root mount is always kept regardless.
export const MIN_SIGNIFICANT_MOUNT_BYTES = 1024 ** 3 // 1 GiB

// Sample "mode" emitted right after the START marker:
//   D = delta  → raw kernel counters (Linux /proc); CPU% and net rate are
//                computed CLIENT-SIDE by diffing against the previous sample,
//                so the remote command does NOT sleep (enables fast polling).
//   V = values → already-computed values (macOS, where cheap raw deltas are not
//                readily available); used as-is.
export type SampleMode = 'D' | 'V'

export interface RawSample {
    mode: SampleMode
    nums: number[]
}

export interface FinalStats {
    cpu: number
    iowait: number
    netRx: number
    netTx: number
    mem: number
    disk: number
    memUsed?: number   // bytes
    memTotal?: number  // bytes
    mounts?: DiskMount[]
    custom?: Array<{ id: string; value: string }>
}

// Raw delta-mode counters + capture timestamp (ms).
export interface DeltaSample {
    cpuTotal: number
    cpuIdle: number
    cpuIowait: number
    rx: number
    tx: number
    t: number
}

const BASE_RE = new RegExp(`${MARKERS.start}\\s+([DV])((?:\\s+-?[\\d.]+)+)`)

// If two consecutive samples are further apart than this, treat the new one as a
// fresh start (the counters / wall-clock gap would otherwise smear the rate).
const MAX_DELTA_GAP_MS = 30_000

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** Parse the base `START <mode> <numbers...>` line. Pure. */
export function parseBaseSample(output: string): RawSample | null {
    if (!output) {
        return null
    }
    const m = output.match(BASE_RE)
    if (!m) {
        return null
    }
    const nums = m[2].trim().split(/\s+/).map(Number).filter(n => !Number.isNaN(n))
    return { mode: m[1] as SampleMode, nums }
}

/**
 * Compute instantaneous CPU%, I/O-wait% and network byte/s rates from two delta
 * samples. Returns zeros for the first sample, a non-positive interval, a stale
 * gap, or a counter reset (curr < prev). Pure.
 */
export function computeDeltaStats(
    prev: DeltaSample | null | undefined,
    curr: DeltaSample
): { cpu: number; iowait: number; netRx: number; netTx: number } {
    if (!prev) {
        return { cpu: 0, iowait: 0, netRx: 0, netTx: 0 }
    }
    const dtSec = (curr.t - prev.t) / 1000
    if (dtSec <= 0 || dtSec > MAX_DELTA_GAP_MS / 1000) {
        return { cpu: 0, iowait: 0, netRx: 0, netTx: 0 }
    }
    const totalD = curr.cpuTotal - prev.cpuTotal
    const idleD = curr.cpuIdle - prev.cpuIdle
    const iowaitD = curr.cpuIowait - prev.cpuIowait
    const cpu = totalD <= 0 ? 0 : clamp(((totalD - idleD) / totalD) * 100, 0, 100)
    const iowait = totalD <= 0 ? 0 : clamp((iowaitD / totalD) * 100, 0, 100)
    const netRx = Math.max(0, curr.rx - prev.rx) / dtSec
    const netTx = Math.max(0, curr.tx - prev.tx) / dtSec
    return { cpu, iowait, netRx, netTx }
}

/**
 * Turn a parsed RawSample (+ optional previous delta sample) into final stats.
 * For delta mode, also returns the `nextSample` to remember for the next cycle.
 * Pure — the caller owns per-session state.
 */
export function finalizeSample(
    sample: RawSample,
    prev: DeltaSample | null | undefined,
    now: number
): { stats: FinalStats; nextSample: DeltaSample | null } {
    if (sample.mode === 'V') {
        // nums = [cpu, iowait, rx, tx, mem, memUsed, memTotal, disk]
        const [cpu = 0, iowait = 0, rx = 0, tx = 0, mem = 0, memUsed = 0, memTotal = 0, disk = 0] = sample.nums
        return {
            stats: { cpu, iowait, netRx: rx, netTx: tx, mem, disk, memUsed, memTotal },
            nextSample: null,
        }
    }
    // Delta mode: nums = [cpuTotal, cpuIdle, cpuIowait, rx, tx, mem, memUsed, memTotal, disk]
    const [cpuTotal = 0, cpuIdle = 0, cpuIowait = 0, rx = 0, tx = 0, mem = 0, memUsed = 0, memTotal = 0, disk = 0] = sample.nums
    const curr: DeltaSample = { cpuTotal, cpuIdle, cpuIowait, rx, tx, t: now }
    const d = computeDeltaStats(prev, curr)
    return {
        stats: { cpu: d.cpu, iowait: d.iowait, netRx: d.netRx, netTx: d.netTx, mem, disk, memUsed, memTotal },
        nextSample: curr,
    }
}

/** Parse the custom-metrics section into id/value pairs. Pure. */
export function parseCustom(
    output: string,
    customMetrics: CustomMetric[] = []
): Array<{ id: string; value: string }> | undefined {
    if (!customMetrics.length || !output.includes(MARKERS.customStart)) {
        return undefined
    }
    const customPart = output.split(MARKERS.customStart)[1].split(MARKERS.end)[0]
    const customValues = customPart.split(MARKERS.next).map(s => s.trim())
    return customMetrics.map((m, index) => ({
        id: m.id,
        value: customValues[index] || '-',
    }))
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

/**
 * Shell fragment that emits per-mount disk usage in BYTES, one line per local
 * mount: `usedBytes totalBytes availBytes usagePercent mount`.
 *
 * - Machine-parseable POSIX output (`df -P`), never `df -h`.
 * - Linux uses `-B1` (already bytes); macOS lacks `-B1` so it uses `-k` and the
 *   awk multiplies by 1024 → uniform byte output for the client.
 * - Filters to real local block devices (`Filesystem` starts with `/dev/`),
 *   which excludes virtual/pseudo filesystems (tmpfs, overlay, proc, …) and
 *   network mounts (nfs `host:/…`, cifs `//host/…`).
 * Relies on `$OS` being set earlier in the same shell (see baseStatsCommand).
 */
export function buildDiskMountsFragment(): string {
    const linux = `df -P -B1 2>/dev/null | awk 'NR>1 && $1 ~ /^\\/dev\\// { m=$6; for (i=7;i<=NF;i++) m=m" "$i; printf "%d %d %d %d %s\\n", $3, $2, $4, $5+0, m }'`
    const mac = `df -P -k 2>/dev/null | awk 'NR>1 && $1 ~ /^\\/dev\\// { m=$6; for (i=7;i<=NF;i++) m=m" "$i; printf "%d %d %d %d %s\\n", $3*1024, $2*1024, $4*1024, $5+0, m }'`
    return `; echo "${MARKERS.diskStart}"; if [ "$OS" = "Darwin" ]; then ${mac}; else ${linux}; fi; echo "${MARKERS.diskEnd}"`
}

/** Parse the per-mount disk section into a DiskMount[] (or undefined if absent). Pure. */
export function parseDiskMounts(output: string): DiskMount[] | undefined {
    if (!output || !output.includes(MARKERS.diskStart)) {
        return undefined
    }
    const part = output.split(MARKERS.diskStart)[1].split(MARKERS.diskEnd)[0]
    const mounts: DiskMount[] = []
    for (const raw of part.split('\n')) {
        const m = raw.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/)
        if (!m) {
            continue
        }
        const totalBytes = Number(m[2])
        if (totalBytes <= 0) {
            continue
        }
        mounts.push({
            usedBytes: Number(m[1]),
            totalBytes,
            availableBytes: Number(m[3]),
            usagePercent: Number(m[4]),
            mount: m[5].trim(),
        })
    }
    return mounts
}

/**
 * Pick the mounts to show in the compact UI: root `/` first (if present), then
 * the fullest "significant" mounts (by usage %), capped at `max`. Pure.
 */
export function selectCompactMounts(mounts: DiskMount[] | undefined, max = 3): DiskMount[] {
    if (!mounts || !mounts.length) {
        return []
    }
    const root = mounts.find(m => m.mount === '/')
    const others = mounts
        .filter(m => m.mount !== '/' && m.totalBytes >= MIN_SIGNIFICANT_MOUNT_BYTES)
        .sort((a, b) => b.usagePercent - a.usagePercent)
        .slice(0, max)
    return root ? [root, ...others] : others
}

/** Full mount list for a hover tooltip: "mount  NN%  (used/total)" per line. Pure. */
export function formatMountsTooltip(mounts: DiskMount[] | undefined): string {
    if (!mounts || !mounts.length) {
        return ''
    }
    return mounts
        .map(m => `${m.mount}  ${m.usagePercent}%  (${formatBytes(m.usedBytes)}/${formatBytes(m.totalBytes)})`)
        .join('\n')
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

/**
 * Format a byte size into a short human string, e.g. 3.2G, 8.0G, 512.0M.
 * Always keeps one decimal so the rendered width stays stable as values change
 * (e.g. 5.4 → 5.0 instead of 5.4 → 5).
 */
export function formatBytes(bytes: number): string {
    if (!bytes || bytes <= 0) {
        return '0.0'
    }
    const k = 1024
    const sizes = ['B', 'K', 'M', 'G', 'T', 'P']
    let i = Math.floor(Math.log(bytes) / Math.log(k))
    if (i < 0) {
        i = 0
    }
    if (i >= sizes.length) {
        i = sizes.length - 1
    }
    return (bytes / Math.pow(k, i)).toFixed(1) + sizes[i]
}
