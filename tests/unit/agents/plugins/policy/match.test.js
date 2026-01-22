import { describe, it, expect, vi, beforeEach } from 'vitest';

const matchGlobMock = vi.hoisted(() => vi.fn());

vi.mock('../../../../../js/agents/vfs/glob.js', () => ({
    matchGlob: matchGlobMock,
}));

import matchDefault, {
    matchWildcard,
    matchAnyWildcard,
    matchAnyGlob,
} from '../../../../../js/agents/plugins/policy/match.js';

beforeEach(() => {
    vi.clearAllMocks();
});

describe('matchWildcard', () => {
    it('matches exact strings when no wildcard is present', () => {
        expect(matchWildcard('alpha', 'alpha')).toBe(true);
        expect(matchWildcard('alpha', 'alp')).toBe(false);
        expect(matchWildcard('alpha', 'alphax')).toBe(false);
    });

    it('supports star wildcards across positions', () => {
        expect(matchWildcard('foo*bar', 'fooxbar')).toBe(true);
        expect(matchWildcard('foo*bar', 'foobar')).toBe(true);
        expect(matchWildcard('*suffix', 'suffix')).toBe(true);
        expect(matchWildcard('prefix*', 'prefix-and-more')).toBe(true);
        expect(matchWildcard('a**b', 'ab')).toBe(true);
    });

    it('handles empty, whitespace, and non-string inputs safely', () => {
        expect(matchWildcard('', '')).toBe(false);
        expect(matchWildcard(null, 'a')).toBe(false);
        expect(matchWildcard(undefined, 'a')).toBe(false);
        expect(matchWildcard('   ', '   ')).toBe(true);
        expect(matchWildcard('*', '')).toBe(true);
        expect(matchWildcard('a*', '')).toBe(false);
        expect(matchWildcard(0, '0')).toBe(false);
        expect(matchWildcard('0', 0)).toBe(false);
        expect(matchWildcard(-1, '-1')).toBe(false);
        expect(matchWildcard(Number.MAX_SAFE_INTEGER, String(Number.MAX_SAFE_INTEGER))).toBe(false);
        expect(matchWildcard({}, 'a')).toBe(false);
        expect(matchWildcard('a', {})).toBe(false);
        expect(matchWildcard([], 'a')).toBe(false);
        expect(matchWildcard('*', {})).toBe(true);
    });

    it('handles long strings and concurrent/rapid calls', async () => {
        const longValue = `a${'x'.repeat(50000)}b`;
        expect(matchWildcard('a*b', longValue)).toBe(true);

        const patterns = ['a*b', '*b', 'a*', '*', 'miss*'];
        const values = [longValue, 'b', 'a', '', 'nope'];
        const results = await Promise.all(
            patterns.map((pattern, index) => Promise.resolve(matchWildcard(pattern, values[index])))
        );
        expect(results).toEqual([true, true, true, true, false]);

        for (let i = 0; i < 20; i += 1) {
            expect(matchWildcard('*', `tick${i}`)).toBe(true);
        }
    });
});

describe('matchAnyWildcard', () => {
    it('returns true for null, undefined, or empty pattern lists', () => {
        expect(matchAnyWildcard(null, 'x')).toBe(true);
        expect(matchAnyWildcard(undefined, 'x')).toBe(true);
        expect(matchAnyWildcard([], 'x')).toBe(true);
    });

    it('matches when any string pattern matches and ignores non-strings', () => {
        expect(matchAnyWildcard([0, {}, 'foo*'], 'foobar')).toBe(true);
        expect(matchAnyWildcard([0, {}, 'foo*'], 'bar')).toBe(false);
        expect(matchAnyWildcard(['bar', 'baz'], 'bar')).toBe(true);
    });

    it('handles boundary values and non-array objects', () => {
        expect(matchAnyWildcard('', 'x')).toBe(false);
        expect(matchAnyWildcard('   ', '   ')).toBe(true);
        expect(matchAnyWildcard('123', 123)).toBe(false);
        expect(matchAnyWildcard(0, '0')).toBe(false);
        expect(matchAnyWildcard(-1, '-1')).toBe(false);
        expect(matchAnyWildcard(Number.MAX_SAFE_INTEGER, String(Number.MAX_SAFE_INTEGER))).toBe(false);
        expect(matchAnyWildcard({}, 'x')).toBe(false);
        expect(matchAnyWildcard({ 0: 'x*', length: 1 }, 'x')).toBe(false);
    });

    it('handles long strings, deep nested patterns, and large lists', () => {
        const longValue = `a${'x'.repeat(50000)}b`;
        const largeList = Array.from({ length: 200 }, (_, i) => `miss${i}*`);
        largeList.push('a*b');
        expect(matchAnyWildcard(largeList, longValue)).toBe(true);

        const deepNested = [[[[['a*']]]]];
        expect(matchAnyWildcard(deepNested, 'a')).toBe(false);
    });

    it('supports concurrent and rapid calls without shared state', async () => {
        const results = await Promise.all([
            Promise.resolve(matchAnyWildcard(['a*b', 'no*'], 'axxb')),
            Promise.resolve(matchAnyWildcard(['no*', 'x*'], 'x')),
            Promise.resolve(matchAnyWildcard(['miss*'], 'value')),
        ]);
        expect(results).toEqual([true, true, false]);

        for (let i = 0; i < 20; i += 1) {
            expect(matchAnyWildcard('*', `tick${i}`)).toBe(true);
        }
    });
});

describe('matchAnyGlob', () => {
    beforeEach(() => {
        matchGlobMock.mockReset();
        matchGlobMock.mockReturnValue(false);
    });

    it('returns true for null, undefined, or empty pattern lists', () => {
        expect(matchAnyGlob(null, 'path')).toBe(true);
        expect(matchAnyGlob(undefined, 'path')).toBe(true);
        expect(matchAnyGlob([], 'path')).toBe(true);
        expect(matchGlobMock).not.toHaveBeenCalled();
    });

    it('normalizes patterns before calling matchGlob', () => {
        matchGlobMock.mockImplementation((pattern, path) => pattern === 'bar/baz' && path === 'dir/file.txt');
        const result = matchAnyGlob(['///foo////bar', '  ./\\\\bar//baz  '], 'dir/file.txt');
        expect(result).toBe(true);
        expect(matchGlobMock).toHaveBeenCalledTimes(2);
        expect(matchGlobMock.mock.calls[0]).toEqual(['foo/bar', 'dir/file.txt']);
        expect(matchGlobMock.mock.calls[1]).toEqual(['bar/baz', 'dir/file.txt']);
    });

    it('skips empty, whitespace, and non-string patterns', () => {
        const patterns = [null, undefined, '', '   ', './', '/', {}, 0, -1, Number.MAX_SAFE_INTEGER];
        const result = matchAnyGlob(patterns, 'path');
        expect(result).toBe(false);
        expect(matchGlobMock).not.toHaveBeenCalled();
    });

    it('short-circuits after a match and handles deep/long paths', () => {
        const deepSegments = Array.from({ length: 50 }, (_, i) => `level${i}`);
        const deepPath = `${deepSegments.join('/')}/${'a'.repeat(20000)}.txt`;
        matchGlobMock.mockImplementation((pattern, path) => pattern === 'level0/**/file.txt' && path === deepPath);

        const result = matchAnyGlob(['miss*', 'level0/**/file.txt', 'later*'], deepPath);
        expect(result).toBe(true);
        expect(matchGlobMock).toHaveBeenCalledTimes(2);
        expect(matchGlobMock.mock.calls[1][0]).toBe('level0/**/file.txt');
    });

    it('propagates matchGlob errors', () => {
        matchGlobMock.mockImplementation(() => {
            throw new Error('boom');
        });
        expect(() => matchAnyGlob('ok', 'path')).toThrow('boom');
    });

    it('supports concurrent and rapid calls without shared state', async () => {
        matchGlobMock.mockImplementation((pattern, path) => pattern === 'ok' && path === 123);

        const results = await Promise.all([
            Promise.resolve(matchAnyGlob('ok', 123)),
            Promise.resolve(matchAnyGlob(['ok'], 123)),
            Promise.resolve(matchAnyGlob('ok', 123)),
        ]);
        expect(results).toEqual([true, true, true]);

        for (let i = 0; i < 10; i += 1) {
            expect(matchAnyGlob('ok', 123)).toBe(true);
        }
    });
});

describe('default export', () => {
    it('exposes the named match helpers', () => {
        expect(matchDefault).toMatchObject({
            matchWildcard,
            matchAnyWildcard,
            matchAnyGlob,
        });
        expect(matchDefault.matchWildcard).toBe(matchWildcard);
        expect(matchDefault.matchAnyWildcard).toBe(matchAnyWildcard);
        expect(matchDefault.matchAnyGlob).toBe(matchAnyGlob);
    });
});
