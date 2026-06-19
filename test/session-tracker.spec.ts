import { resolveFocusedSession, LastActiveSessionTracker } from '../src/services/session-tracker'

describe('resolveFocusedSession', () => {
    it('returns null for falsy tab', () => {
        expect(resolveFocusedSession(null)).toBeNull()
        expect(resolveFocusedSession(undefined)).toBeNull()
    })

    it('returns the session of a leaf tab', () => {
        const s = { id: 1 }
        expect(resolveFocusedSession({ session: s })).toBe(s)
    })

    it('descends focusedTab chain (split panes)', () => {
        const s = { id: 'leaf' }
        const tab = { focusedTab: { focusedTab: { session: s } } }
        expect(resolveFocusedSession(tab)).toBe(s)
    })

    it('does not loop forever on a self-referential focusedTab', () => {
        const tab: any = {}
        tab.focusedTab = tab
        expect(resolveFocusedSession(tab)).toBeNull()
    })

    it('returns null when the focused leaf has no session', () => {
        expect(resolveFocusedSession({ focusedTab: { foo: 1 } })).toBeNull()
    })
})

describe('LastActiveSessionTracker', () => {
    it('starts empty', () => {
        expect(new LastActiveSessionTracker().get()).toBeNull()
    })

    it('remembers the last supported session', () => {
        const t = new LastActiveSessionTracker()
        const a = { id: 'a' }
        t.update(a, true)
        expect(t.get()).toBe(a)
    })

    it('does not remember unsupported or missing sessions', () => {
        const t = new LastActiveSessionTracker()
        t.update({ id: 'x' }, false)
        t.update(null, true)
        expect(t.get()).toBeNull()
    })

    it('resolve prefers the focused supported session and records it', () => {
        const t = new LastActiveSessionTracker()
        const a = { id: 'a' }
        expect(t.resolve(a, true)).toBe(a)
        expect(t.get()).toBe(a)
    })

    it('resolve falls back to last active when focused is unsupported (multi-input)', () => {
        const t = new LastActiveSessionTracker()
        const a = { id: 'a' }
        const b = { id: 'b' }
        t.resolve(a, true)        // window A focused & supported
        expect(t.resolve(b, false)).toBe(a) // focus moved to unsupported B -> keep A
    })

    it('forgetIf clears matching remembered session', () => {
        const t = new LastActiveSessionTracker()
        const a = { id: 'a' }
        t.update(a, true)
        t.forgetIf(s => s === a)
        expect(t.get()).toBeNull()
    })
})
