import {
    parseStatsOutput,
    buildCustomMetricsFragment,
    formatSpeed,
    MARKERS,
} from '../src/services/stats-parser'

const metric = (id: string, command = 'echo 1') => ({
    id, label: id, command, type: 'text' as const,
})

describe('parseStatsOutput', () => {
    it('parses the base stats block', () => {
        const out = `${MARKERS.start} 12.5 1024 2048 33.3 80 ${MARKERS.end}`
        const r = parseStatsOutput(out)
        expect(r).toEqual({ cpu: 12.5, netRx: 1024, netTx: 2048, mem: 33.3, disk: 80 })
    })

    it('returns null when no base block is present', () => {
        expect(parseStatsOutput('garbage output')).toBeNull()
        expect(parseStatsOutput('')).toBeNull()
    })

    it('defaults unparsable numbers to 0', () => {
        const out = `${MARKERS.start} 0 0 0 0 0 ${MARKERS.end}`
        expect(parseStatsOutput(out)).toEqual({ cpu: 0, netRx: 0, netTx: 0, mem: 0, disk: 0 })
    })

    it('parses custom metric values in order', () => {
        const metrics = [metric('a'), metric('b'), metric('c')]
        const out = [
            `${MARKERS.start} 1 2 3 4 5`,
            MARKERS.customStart,
            ` 10 ${MARKERS.next} hello ${MARKERS.next} 42 `,
            MARKERS.end,
        ].join(' ')
        const r = parseStatsOutput(out, metrics)
        expect(r!.custom).toEqual([
            { id: 'a', value: '10' },
            { id: 'b', value: 'hello' },
            { id: 'c', value: '42' },
        ])
    })

    it('fills missing custom values with a dash', () => {
        const metrics = [metric('a'), metric('b')]
        const out = `${MARKERS.start} 1 2 3 4 5 ${MARKERS.customStart} 10 ${MARKERS.end}`
        const r = parseStatsOutput(out, metrics)
        expect(r!.custom).toEqual([
            { id: 'a', value: '10' },
            { id: 'b', value: '-' },
        ])
    })

    it('ignores custom section when no metrics configured', () => {
        const out = `${MARKERS.start} 1 2 3 4 5 ${MARKERS.customStart} x ${MARKERS.end}`
        const r = parseStatsOutput(out, [])
        expect(r!.custom).toBeUndefined()
    })
})

describe('buildCustomMetricsFragment', () => {
    it('returns empty string for no metrics', () => {
        expect(buildCustomMetricsFragment([])).toBe('')
    })

    it('wraps each command with a fallback and joins with NEXT', () => {
        const frag = buildCustomMetricsFragment([metric('a', 'foo'), metric('b', 'bar')])
        expect(frag).toContain(MARKERS.customStart)
        expect(frag).toContain('( foo ) || echo "Err"')
        expect(frag).toContain('( bar ) || echo "Err"')
        expect(frag).toContain(MARKERS.next)
    })
})

describe('formatSpeed', () => {
    it('handles zero and negative', () => {
        expect(formatSpeed(0)).toBe('0 B/s')
        expect(formatSpeed(-5)).toBe('0 B/s')
        expect(formatSpeed(NaN)).toBe('0 B/s')
    })

    it('formats common magnitudes', () => {
        expect(formatSpeed(512)).toBe('512 B/s')
        expect(formatSpeed(1024)).toBe('1 K/s')
        expect(formatSpeed(1536)).toBe('1.5 K/s')
        expect(formatSpeed(1024 * 1024)).toBe('1 M/s')
    })

    it('clamps very large values to the top unit', () => {
        expect(formatSpeed(1024 ** 5)).toContain('G/s')
    })
})
