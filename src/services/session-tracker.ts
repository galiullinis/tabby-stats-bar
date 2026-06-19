// Helpers for resolving "which session should the stats reflect right now".
//
// With multi-input (broadcast) enabled and/or split panes, several panes are
// effectively active at once. Tabby still tracks a single *focused* leaf via the
// `focusedTab` chain; we descend that chain to find the session of the last
// focused window. `LastActiveSessionTracker` then remembers the most recent
// supported session so the panel keeps showing meaningful data even when focus
// briefly lands on an unsupported tab.

/**
 * Descend the `focusedTab` chain of a (possibly split) tab to the focused leaf
 * and return its session, or null. Guarded against cyclic/broken structures.
 */
export function resolveFocusedSession(activeTab: any): any {
    let tab = activeTab
    let guard = 0
    while (tab && tab.focusedTab && tab.focusedTab !== tab && guard < 32) {
        tab = tab.focusedTab
        guard++
    }
    return tab && tab.session ? tab.session : null
}

export class LastActiveSessionTracker {
    private last: any = null

    /** Record `session` as the last active one when it is present and supported. */
    update(session: any, supported: boolean): void {
        if (session && supported) {
            this.last = session
        }
    }

    /**
     * Resolve which session to display: prefer the currently focused supported
     * session, otherwise fall back to the most recent supported one. This is the
     * behaviour expected under multi-input — show the last active window.
     */
    resolve(focusedSession: any, supported: boolean): any {
        if (focusedSession && supported) {
            this.last = focusedSession
            return focusedSession
        }
        return this.last
    }

    get(): any {
        return this.last
    }

    /** Forget the remembered session if it matches the predicate (e.g. closed). */
    forgetIf(predicate: (session: any) => boolean): void {
        if (this.last && predicate(this.last)) {
            this.last = null
        }
    }

    clear(): void {
        this.last = null
    }
}
