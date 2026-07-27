import type { CustomMetric } from './config'

// ---------------------------------------------------------------------------
// Built-in presets bundled WITH the plugin.
//
// There is intentionally NO remote / community preset loading: the plugin never
// fetches commands from the internet. These are starting points only — every
// command still runs as a shell command on the active session (locally or on the
// remote SSH host), so the user must confirm before adding one
// (see ServerStatsSettingsComponent.addPreset).
//
// ── WHAT BELONGS HERE (AND WHAT DOES NOT) ──────────────────────────────────
// A preset is a COPY handed to the user: once added it lives in their config
// forever, so a later fix here never reaches them. Anything we want to own —
// cross-platform behaviour, error handling, a fixed spot in the bar — must be a
// first-class metric instead (a `showX` toggle in config.ts + a shell fragment
// in stats-parser.ts + a section in the components), the way CPU/RAM/DISK/NET,
// I/O Wait, Uptime, Load, Users and SSH Sessions are done.
// Use a preset only for things that are inherently host-specific and that the
// user is expected to tweak.
//
// ── HOW TO ADD A NEW BUILT-IN PRESET ───────────────────────────────────────
// 1. Pick (or add) a category in `PRESET_CATEGORIES` below.
// 2. Append a `BuiltinPreset` object to `BUILTIN_PRESETS`:
//      { category: 'System', label: 'Foo', command: '...', type: 'text' }
//    - `command` MUST print a single value (number for 'progress', any text for 'text').
//    - Prefer cheap, read-only commands (e.g. read /proc, no loops, no sleep).
//    - The command is wrapped in `( cmd ) || echo "Err"`, so it must exit 0 on
//      success AND on the "nothing found" case. Never end in `grep -c` (it exits
//      1 on zero matches, printing both "0" and "Err") — use `awk 'END{print n+0}'`.
//    - For 'progress', set `maxValue` (defaults to 100).
// 3. That's it — the settings UI renders them grouped by category automatically.
//    No code/UI changes are needed to add more.
// ---------------------------------------------------------------------------

export type PresetCategory = 'System' | 'Network' | 'GPU' | 'Containers' | 'Other'

export const PRESET_CATEGORIES: PresetCategory[] = [
    'System',
    'Network',
    'GPU',
    'Containers',
    'Other',
]

export interface BuiltinPreset extends Partial<CustomMetric> {
    /** Used to group presets in the settings UI. */
    category: PresetCategory
    label: string
    command: string
    type: 'progress' | 'text'
}

export const BUILTIN_PRESETS: BuiltinPreset[] = [
    // ── System ──────────────────────────────────────────────────────────────
    {
        category: 'System',
        // Reads the file with awk directly (no `cat |`), so a missing file makes
        // awk exit non-zero and the `|| echo 0` fallback actually fires. The old
        // `cat ... | awk ... || echo 0` never did: awk succeeded on empty input.
        // NOTE: thermal_zone0 is not the CPU on every board — this one is
        // deliberately left as a preset because it is host-specific.
        label: 'Temp',
        command: `awk '{ printf "%d", $1/1000; exit }' /sys/class/thermal/thermal_zone0/temp 2>/dev/null || echo 0`,
        type: 'text',
        color: '#ff7675',
        suffix: '°C',
    },
    // NOTE: I/O Wait, Uptime, Load, Users and SSH Sessions are NOT presets — they
    // are first-class metrics with their own Settings toggles. iowait/uptime/load
    // come from the base sample (no extra command at all); users/sessions add a
    // hardened, cross-platform fragment only while their toggle is on.
]

/**
 * Commands of presets that were promoted to first-class metrics. Users who had
 * already pressed "Add" keep a private copy in `customMetrics` — including the
 * bugs those commands had — so they are migrated away on load.
 */
const RETIRED_PRESET_COMMANDS: Array<{ command: string; toggle: string }> = [
    { command: `awk '{d=int($1/86400); h=int(($1%86400)/3600); print d"d "h"h"}' /proc/uptime`, toggle: 'showUptime' },
    { command: `cat /proc/loadavg | awk '{print $1}'`, toggle: 'showLoad' },
    { command: `who | grep -c pts`, toggle: 'showUsers' },
    { command: `ss -tn src :22 | grep -c ESTAB`, toggle: 'showSessions' },
    { command: `iostat -c 1 1 | awk 'NR==4{print $4}'`, toggle: 'showIoWait' },
    // Superseded Temp command (the `|| echo 0` fallback was dead code).
    { command: `cat /sys/class/thermal/thermal_zone0/temp 2>/dev/null | awk '{print int($1/1000)}' || echo 0`, toggle: '' },
]

/**
 * Drop retired presets from `customMetrics` and switch on the built-in metric
 * that replaced them. Mutates `conf` and returns true when something changed
 * (so the caller can persist). Idempotent: after the first pass nothing matches.
 * Pure apart from the mutation — no Angular/Tabby dependency, so it is testable.
 */
export function migrateRetiredPresets(conf: any): boolean {
    if (!conf || !Array.isArray(conf.customMetrics) || !conf.customMetrics.length) {
        return false
    }
    let changed = false
    const kept = conf.customMetrics.filter((metric: CustomMetric) => {
        const retired = RETIRED_PRESET_COMMANDS.find(r => r.command === (metric?.command || '').trim())
        if (!retired) {
            return true
        }
        changed = true
        if (retired.toggle) {
            conf[retired.toggle] = true
        }
        return false
    })
    if (changed) {
        conf.customMetrics = kept
    }
    return changed
}

/** Presets grouped by category, in `PRESET_CATEGORIES` order. Empty groups are dropped. */
export function groupedBuiltinPresets(): Array<{ category: PresetCategory; presets: BuiltinPreset[] }> {
    return PRESET_CATEGORIES
        .map(category => ({
            category,
            presets: BUILTIN_PRESETS.filter(p => p.category === category),
        }))
        .filter(group => group.presets.length > 0)
}
