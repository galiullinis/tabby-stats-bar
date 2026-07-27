import { formatUptime, formatLoad } from './stats-parser'

/**
 * Optional single-value metrics (uptime / load / users / ssh sessions).
 *
 * These used to be built-in presets, i.e. shell commands copied into the user's
 * config. They are first-class now: uptime and load ride along in the base
 * sample, users/sessions come from a fragment that is only sent while the
 * toggle is on. This module owns their order, labels and formatting so the
 * bottom bar and the floating panel cannot drift apart.
 */
/** Where a metric sits in the bar: right after NET, or after DISK. */
export type ExtraSlot = 'afterNet' | 'afterDisk'

export interface ExtraMetric {
    key: 'uptime' | 'load' | 'users' | 'sessions'
    slot: ExtraSlot
    /** Short label shown in the UI (translation key). */
    label: string
    value: string
    color: string
    /** Tooltip text (translation key). */
    title: string
}

/** Pure: builds the visible extras from the config toggles and the last sample. */
export function buildExtraMetrics(conf: any, stats: any): ExtraMetric[] {
    const c = conf || {}
    const s = stats || {}
    const extras: ExtraMetric[] = []
    if (c.showUptime) {
        extras.push({
            key: 'uptime',
            slot: 'afterNet',
            label: 'UP',
            // Muted amber — yellow, but deliberately dimmer than LOAD's #fdcb6e so
            // the two yellows do not compete and uptime stays a calm value.
            color: '#d6b656',
            title: 'Time since boot',
            value: formatUptime(s.uptime),
        })
    }
    if (c.showLoad) {
        extras.push({
            key: 'load',
            slot: 'afterDisk',
            label: 'LOAD',
            color: '#fdcb6e',
            title: '1-minute load average',
            value: formatLoad(s.load1),
        })
    }
    if (c.showUsers) {
        extras.push({
            key: 'users',
            slot: 'afterDisk',
            label: 'USR',
            color: '#0984e3',
            title: 'Distinct logged-in users',
            value: s.users === undefined || s.users === null ? '-' : String(s.users),
        })
    }
    if (c.showSessions) {
        extras.push({
            key: 'sessions',
            slot: 'afterDisk',
            label: 'SSH',
            color: '#00cec9',
            title: 'Established inbound SSH connections',
            value: s.sessions === undefined || s.sessions === null ? '-' : String(s.sessions),
        })
    }
    return extras
}

/** The subset of `extras` that renders in the given slot. Pure. */
export function extraMetricsFor(slot: ExtraSlot, extras: ExtraMetric[]): ExtraMetric[] {
    return extras.filter(m => m.slot === slot)
}
