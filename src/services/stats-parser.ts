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
    sessStart: 'TABBY-STATS-SESS-START',
    sessEnd: 'TABBY-STATS-SESS-END',
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
    uptime?: number    // seconds since boot
    load1?: number     // 1-minute load average
    users?: number     // distinct logged-in users
    sessions?: number  // established inbound SSH connections
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
        // nums = [cpu, iowait, rx, tx, mem, memUsed, memTotal, disk, uptime, load1]
        const [cpu = 0, iowait = 0, rx = 0, tx = 0, mem = 0, memUsed = 0, memTotal = 0, disk = 0, uptime = 0, load1 = 0] = sample.nums
        return {
            stats: { cpu, iowait, netRx: rx, netTx: tx, mem, disk, memUsed, memTotal, uptime, load1 },
            nextSample: null,
        }
    }
    // Delta mode: nums = [cpuTotal, cpuIdle, cpuIowait, rx, tx, mem, memUsed, memTotal, disk, uptime, load1]
    const [cpuTotal = 0, cpuIdle = 0, cpuIowait = 0, rx = 0, tx = 0, mem = 0, memUsed = 0, memTotal = 0, disk = 0, uptime = 0, load1 = 0] = sample.nums
    const curr: DeltaSample = { cpuTotal, cpuIdle, cpuIowait, rx, tx, t: now }
    const d = computeDeltaStats(prev, curr)
    return {
        stats: { cpu: d.cpu, iowait: d.iowait, netRx: d.netRx, netTx: d.netTx, mem, disk, memUsed, memTotal, uptime, load1 },
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
 * Shell fragment for the optional session counters. Only the counters that are
 * actually enabled are emitted, so a disabled one costs nothing on the host.
 *
 *   `U <n>` — distinct logged-in users (`who`; present on Linux/macOS/BSD).
 *   `S <n>` — established INBOUND SSH connections, counted on the server port
 *             taken from `$SSH_CONNECTION` (sshd sets it for exec channels too),
 *             falling back to 22. Uses `ss` when available and `netstat`
 *             otherwise — macOS/BSD and minimal images have no `ss`.
 *
 * Both counters end in `awk 'END{print n+0}'` and never in `grep -c`: `grep -c`
 * exits 1 when the count is zero, and the old presets were wrapped in
 * `( cmd ) || echo "Err"`, so the most common case (zero) printed "0" AND "Err".
 */
export function buildSessionsFragment(opts: { users?: boolean; sessions?: boolean }): string {
    if (!opts.users && !opts.sessions) {
        return ''
    }
    const usersCmd = `who 2>/dev/null | awk '{ u[$1]=1 } END { n=0; for (k in u) n++; print n+0 }'`
    const port = `SSHPORT=\${SSH_CONNECTION##* }; case "$SSHPORT" in ''|*[!0-9]*) SSHPORT=22;; esac`
    // The local-address column moves depending on the ss version (filtering by
    // state usually drops the State column, but not everywhere), so its index is
    // taken from the header instead of hard-coded. Matching the peer column
    // instead would count OUTBOUND ssh connections from this host as inbound.
    const ssCmd = `ss -tn state established 2>/dev/null | awk -v p=":$SSHPORT$" 'NR==1 { for (i=1; i<=NF; i++) if ($i == "Local") c=i; if (!c) c=3; next } c && $c ~ p { n++ } END { print n+0 }'`
    const netstatCmd = `netstat -an 2>/dev/null | awk -v p="[.:]$SSHPORT$" '/ESTABLISHED/ && $4 ~ p { n++ } END { print n+0 }'`
    const sessionsCmd = `if command -v ss >/dev/null 2>&1; then ${ssCmd}; else ${netstatCmd}; fi`

    let fragment = `; echo "${MARKERS.sessStart}"`
    if (opts.users) {
        fragment += `; echo "U $(${usersCmd})"`
    }
    if (opts.sessions) {
        fragment += `; ${port}; echo "S $(${sessionsCmd})"`
    }
    fragment += `; echo "${MARKERS.sessEnd}"`
    return fragment
}

/** Parse the session-counter section. Absent counters stay undefined. Pure. */
export function parseSessionCounts(output: string): { users?: number; sessions?: number } | undefined {
    if (!output || !output.includes(MARKERS.sessStart)) {
        return undefined
    }
    const part = output.split(MARKERS.sessStart)[1].split(MARKERS.sessEnd)[0]
    const result: { users?: number; sessions?: number } = {}
    const users = part.match(/^\s*U\s+(\d+)\s*$/m)
    const sessions = part.match(/^\s*S\s+(\d+)\s*$/m)
    if (users) {
        result.users = Number(users[1])
    }
    if (sessions) {
        result.sessions = Number(sessions[1])
    }
    return result.users === undefined && result.sessions === undefined ? undefined : result
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

/**
 * Uptime as a short human string: `12d 4h` / `4h 07m` / `37m`. Formatting lives
 * here (not in the shell command) so it is uniform across Linux/macOS and
 * testable. Returns '-' when the host did not report a usable value.
 */
export function formatUptime(seconds: number | undefined): string {
    if (!seconds || !Number.isFinite(seconds) || seconds <= 0) {
        return '-'
    }
    const total = Math.floor(seconds)
    const days = Math.floor(total / 86400)
    const hours = Math.floor((total % 86400) / 3600)
    const minutes = Math.floor((total % 3600) / 60)
    if (days > 0) {
        return `${days}d ${hours}h`
    }
    if (hours > 0) {
        return `${hours}h ${String(minutes).padStart(2, '0')}m`
    }
    return `${minutes}m`
}

/** 1-minute load average, fixed to 2 decimals so the width stays stable. Pure. */
export function formatLoad(load: number | undefined): string {
    if (load === undefined || load === null || !Number.isFinite(load) || load < 0) {
        return '-'
    }
    return load.toFixed(2)
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
