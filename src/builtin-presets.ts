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
// ── HOW TO ADD A NEW BUILT-IN PRESET ───────────────────────────────────────
// 1. Pick (or add) a category in `PRESET_CATEGORIES` below.
// 2. Append a `BuiltinPreset` object to `BUILTIN_PRESETS`:
//      { category: 'System', label: 'Foo', command: '...', type: 'text' }
//    - `command` MUST print a single value (number for 'progress', any text for 'text').
//    - Prefer cheap, read-only commands (e.g. read /proc, no loops, no sleep).
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
        label: 'Uptime',
        command: `awk '{d=int($1/86400); h=int(($1%86400)/3600); print d"d "h"h"}' /proc/uptime`,
        type: 'text',
        color: '#00b894',
        suffix: '',
    },
    {
        category: 'System',
        label: 'Temp',
        command: `cat /sys/class/thermal/thermal_zone0/temp 2>/dev/null | awk '{print int($1/1000)}' || echo 0`,
        type: 'text',
        color: '#ff7675',
        suffix: '°C',
    },
    {
        category: 'System',
        label: 'Load',
        command: `cat /proc/loadavg | awk '{print $1}'`,
        type: 'text',
        color: '#fdcb6e',
        suffix: '',
    },
    {
        category: 'System',
        label: 'Users',
        command: `who | grep -c pts`,
        type: 'text',
        color: '#0984e3',
        suffix: '',
    },
    // NOTE: I/O Wait is NOT a preset — it is a first-class metric computed in the
    // core from the /proc/stat delta (no extra command, no sleep). Enable it via
    // Settings → "Show I/O Wait".
    // ── Network ─────────────────────────────────────────────────────────────
    {
        category: 'Network',
        label: 'SSH Sessions',
        command: `ss -tn src :22 | grep -c ESTAB`,
        type: 'text',
        color: '#00ff00',
        suffix: '',
    },
]

/** Presets grouped by category, in `PRESET_CATEGORIES` order. Empty groups are dropped. */
export function groupedBuiltinPresets(): Array<{ category: PresetCategory; presets: BuiltinPreset[] }> {
    return PRESET_CATEGORIES
        .map(category => ({
            category,
            presets: BUILTIN_PRESETS.filter(p => p.category === category),
        }))
        .filter(group => group.presets.length > 0)
}
