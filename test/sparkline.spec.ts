import {
    pushSample,
    clampSparklineBars,
    cpuColor,
    MIN_SPARKLINE_BARS,
    MAX_SPARKLINE_BARS,
    DEFAULT_SPARKLINE_BARS,
} from '../src/services/sparkline'

describe('pushSample', () => {
    it('appends to the right', () => {
        expect(pushSample([1, 2], 3, 5)).toEqual([1, 2, 3])
    })

    it('drops the oldest from the front when exceeding max', () => {
        expect(pushSample([1, 2, 3], 4, 3)).toEqual([2, 3, 4])
    })

    it('clamps values to 0..100', () => {
        expect(pushSample([], 150, 5)).toEqual([100])
        expect(pushSample([], -5, 5)).toEqual([0])
    })

    it('coerces NaN/garbage to 0', () => {
        expect(pushSample([], NaN, 5)).toEqual([0])
        expect(pushSample([], 'x' as any, 5)).toEqual([0])
    })

    it('does not mutate the input array', () => {
        const src = [1, 2]
        pushSample(src, 3, 5)
        expect(src).toEqual([1, 2])
    })

    it('trims a longer-than-max history down to max', () => {
        expect(pushSample([10, 20, 30, 40], 50, 3)).toEqual([30, 40, 50])
    })
})

describe('clampSparklineBars', () => {
    it('keeps values in range', () => {
        expect(clampSparklineBars(40)).toBe(40)
        expect(clampSparklineBars(20)).toBe(MIN_SPARKLINE_BARS)
        expect(clampSparklineBars(60)).toBe(MAX_SPARKLINE_BARS)
    })
    it('clamps out-of-range', () => {
        expect(clampSparklineBars(5)).toBe(MIN_SPARKLINE_BARS)
        expect(clampSparklineBars(999)).toBe(MAX_SPARKLINE_BARS)
    })
    it('rounds and falls back to default on garbage', () => {
        expect(clampSparklineBars(42.7)).toBe(43)
        expect(clampSparklineBars(undefined)).toBe(DEFAULT_SPARKLINE_BARS)
        expect(clampSparklineBars(NaN as any)).toBe(DEFAULT_SPARKLINE_BARS)
    })
})

describe('cpuColor', () => {
    it('maps thresholds', () => {
        expect(cpuColor(10)).toBe('#2ecc71')
        expect(cpuColor(60)).toBe('#f1c40f')
        expect(cpuColor(90)).toBe('#e74c3c')
    })
})
