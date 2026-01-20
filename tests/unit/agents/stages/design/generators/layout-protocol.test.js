/**
 * @file tests/unit/agents/stages/design/generators/layout-protocol.test.js
 * @description Unit tests for layout protocol helpers
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';

import layoutProtocol, {
    LAYOUT_REGIONS,
    resolveLayoutType,
    layoutTypeFromCss,
    getRegion,
    regionToDslAttrs
} from '../../../../../../js/agents/stages/design/generators/layout-protocol.js';

vi.mock('node:fs', () => ({
    readFileSync: vi.fn(() => '')
}));

const mockedReadFileSync = vi.mocked(readFileSync);

beforeEach(() => {
    vi.clearAllMocks();
    mockedReadFileSync.mockReturnValue('');
});

describe('LAYOUT_REGIONS', () => {
    it('exposes the expected layout keys', () => {
        const expected = [
            'cover',
            'content',
            'two_column',
            'timeline',
            'chart',
            'image',
            'agenda',
            'process',
            'summary',
            'appendix'
        ];

        const keys = Object.keys(LAYOUT_REGIONS).sort();
        expect(keys).toEqual([...expected].sort());
    });

    it('provides numeric region coordinates within 0-100', () => {
        for (const layout of Object.values(LAYOUT_REGIONS)) {
            const regions = layout?.regions;
            expect(regions && typeof regions).toBe('object');
            for (const region of Object.values(regions)) {
                expect(region).toMatchObject({
                    x: expect.any(Number),
                    y: expect.any(Number),
                    w: expect.any(Number),
                    h: expect.any(Number)
                });
                expect(region.x).toBeGreaterThanOrEqual(0);
                expect(region.y).toBeGreaterThanOrEqual(0);
                expect(region.w).toBeGreaterThanOrEqual(0);
                expect(region.h).toBeGreaterThanOrEqual(0);
                expect(region.x).toBeLessThanOrEqual(100);
                expect(region.y).toBeLessThanOrEqual(100);
                expect(region.w).toBeLessThanOrEqual(100);
                expect(region.h).toBeLessThanOrEqual(100);
            }
        }
    });
});

describe('resolveLayoutType', () => {
    it('maps known page types case-insensitively', () => {
        expect(resolveLayoutType('cover')).toBe('cover');
        expect(resolveLayoutType('AGENDA')).toBe('agenda');
        expect(resolveLayoutType('Comparison')).toBe('two_column');
        expect(resolveLayoutType('roadmap')).toBe('process');
        expect(resolveLayoutType('overview')).toBe('content');
    });

    it('returns content for unknown or empty values', () => {
        expect(resolveLayoutType('unknown')).toBe('content');
        expect(resolveLayoutType('')).toBe('content');
        expect(resolveLayoutType('   ')).toBe('content');
        expect(resolveLayoutType(null)).toBe('content');
        expect(resolveLayoutType(undefined)).toBe('content');
        expect(resolveLayoutType([])).toBe('content');
        expect(resolveLayoutType({})).toBe('content');
    });

    it('handles numeric boundary values', () => {
        expect(resolveLayoutType(0)).toBe('content');
        expect(resolveLayoutType(-1)).toBe('content');
        expect(resolveLayoutType(Number.MAX_SAFE_INTEGER)).toBe('content');
    });

    it('handles large file content inputs from external sources', () => {
        const largeContent = 'x'.repeat(50000);
        mockedReadFileSync.mockReturnValueOnce(largeContent);
        const fileContent = readFileSync('/fake/large.txt', 'utf-8');

        expect(fileContent.length).toBe(50000);
        expect(resolveLayoutType(fileContent)).toBe('content');
        expect(mockedReadFileSync).toHaveBeenCalledWith('/fake/large.txt', 'utf-8');
    });

    it('handles concurrent calls without shared state', async () => {
        const inputs = ['cover', 'agenda', 'unknown', null, 'comparison'];
        const results = await Promise.all(
            inputs.map((input) => Promise.resolve().then(() => resolveLayoutType(input)))
        );

        expect(results).toEqual(['cover', 'agenda', 'content', 'content', 'two_column']);
    });
});

describe('layoutTypeFromCss', () => {
    it('maps known CSS classes to layout types', () => {
        expect(layoutTypeFromCss('layout-hero')).toBe('cover');
        expect(layoutTypeFromCss('layout-two-column')).toBe('two_column');
        expect(layoutTypeFromCss('layout-standard')).toBe('content');
    });

    it('falls back to layout keys defined in LAYOUT_REGIONS', () => {
        expect(layoutTypeFromCss('layout-timeline')).toBe('timeline');
        expect(layoutTypeFromCss('prefix layout-chart suffix')).toBe('chart');
    });

    it('returns content for invalid or unknown inputs', () => {
        expect(layoutTypeFromCss('layout-unknown')).toBe('content');
        expect(layoutTypeFromCss('no-layout-here')).toBe('content');
        expect(layoutTypeFromCss('')).toBe('content');
        expect(layoutTypeFromCss('   ')).toBe('content');
        expect(layoutTypeFromCss(null)).toBe('content');
        expect(layoutTypeFromCss(undefined)).toBe('content');
        expect(layoutTypeFromCss([])).toBe('content');
        expect(layoutTypeFromCss({})).toBe('content');
    });

    it('handles boundary values and deep nested inputs', () => {
        expect(layoutTypeFromCss(0)).toBe('content');
        expect(layoutTypeFromCss(-1)).toBe('content');
        expect(layoutTypeFromCss(Number.MAX_SAFE_INTEGER)).toBe('content');

        const deepNested = [[[[['layout-chart']]]]];
        expect(layoutTypeFromCss(deepNested)).toBe('chart');
    });

    it('handles long strings and array-like objects', () => {
        const longCss = `${'x'.repeat(10000)}layout-chart`;
        expect(layoutTypeFromCss(longCss)).toBe('chart');

        const arrayLike = { 0: 'layout-hero', length: 1 };
        expect(layoutTypeFromCss(arrayLike)).toBe('content');
    });

    it('supports concurrent calls', async () => {
        const inputs = ['layout-hero', 'layout-two-column', 'layout-unknown'];
        const results = await Promise.all(
            inputs.map((input) => Promise.resolve().then(() => layoutTypeFromCss(input)))
        );

        expect(results).toEqual(['cover', 'two_column', 'content']);
    });
});

describe('getRegion', () => {
    it('returns the expected region object for valid inputs', () => {
        const region = getRegion('cover', 'title');
        expect(region).toEqual({ x: 10, y: 35, w: 80, h: 15 });
        expect(region).toBe(LAYOUT_REGIONS.cover.regions.title);
    });

    it('returns null for missing layouts or regions', () => {
        expect(getRegion('cover', 'missing')).toBeNull();
        expect(getRegion('missing', 'title')).toBeNull();
        expect(getRegion('', '')).toBeNull();
    });

    it('handles invalid layout or region types', () => {
        expect(getRegion(null, 'title')).toBeNull();
        expect(getRegion(undefined, 'title')).toBeNull();
        expect(getRegion([], 'title')).toBeNull();
        expect(getRegion({}, 'title')).toBeNull();
        expect(getRegion('cover', null)).toBeNull();
        expect(getRegion('cover', undefined)).toBeNull();
        expect(getRegion('cover', [])).toBeNull();
        expect(getRegion('cover', {})).toBeNull();
    });

    it('handles concurrent access', async () => {
        const results = await Promise.all([
            Promise.resolve().then(() => getRegion('cover', 'title')),
            Promise.resolve().then(() => getRegion('content', 'body')),
            Promise.resolve().then(() => getRegion('chart', 'chart'))
        ]);

        expect(results).toEqual([
            LAYOUT_REGIONS.cover.regions.title,
            LAYOUT_REGIONS.content.regions.body,
            LAYOUT_REGIONS.chart.regions.chart
        ]);
    });
});

describe('regionToDslAttrs', () => {
    it('converts percentage coordinates to data attributes', () => {
        const region = { x: 10, y: 20, w: 30, h: 40 };
        const slideSize = { width: 1000, height: 500 };
        const attrs = regionToDslAttrs(region, slideSize);
        expect(attrs).toBe('data-x="100" data-y="100" data-w="300" data-h="200"');
    });

    it('uses default slide size when not provided', () => {
        const region = LAYOUT_REGIONS.cover.regions.title;
        const attrs = regionToDslAttrs(region);
        expect(attrs).toBe('data-x="96" data-y="189" data-w="768" data-h="81"');
    });

    it('rounds fractional values and accepts numeric strings', () => {
        const region = { x: 33.333, y: 33.333, w: 33.333, h: 33.333 };
        const attrs = regionToDslAttrs(region, { width: 300, height: 300 });
        expect(attrs).toBe('data-x="100" data-y="100" data-w="100" data-h="100"');

        const stringSizeAttrs = regionToDslAttrs(
            { x: 10, y: 20, w: 30, h: 40 },
            { width: '1000', height: '500' }
        );
        expect(stringSizeAttrs).toBe('data-x="100" data-y="100" data-w="300" data-h="200"');
    });

    it('handles boundary values and empty slide sizes', () => {
        const negativeAttrs = regionToDslAttrs(
            { x: 0, y: -1, w: 100, h: 0 },
            { width: 100, height: 100 }
        );
        expect(negativeAttrs).toBe('data-x="0" data-y="-1" data-w="100" data-h="0"');

        const maxSafe = Math.round(Number.MAX_SAFE_INTEGER / 100);
        const maxAttrs = regionToDslAttrs(
            { x: 1, y: 1, w: 1, h: 1 },
            { width: Number.MAX_SAFE_INTEGER, height: Number.MAX_SAFE_INTEGER }
        );
        expect(maxAttrs).toBe(
            `data-x="${maxSafe}" data-y="${maxSafe}" data-w="${maxSafe}" data-h="${maxSafe}"`
        );

        const emptySizeAttrs = regionToDslAttrs({ x: 1, y: 1, w: 1, h: 1 }, {});
        expect(emptySizeAttrs).toBe('data-x="NaN" data-y="NaN" data-w="NaN" data-h="NaN"');
    });

    it('throws for null or undefined region inputs', () => {
        expect(() => regionToDslAttrs(null)).toThrow(TypeError);
        expect(() => regionToDslAttrs(undefined)).toThrow(TypeError);
    });

    it('handles rapid consecutive calls', () => {
        const region = { x: 5, y: 10, w: 15, h: 20 };
        const slideSize = { width: 200, height: 200 };
        const results = [];

        for (let i = 0; i < 50; i += 1) {
            results.push(regionToDslAttrs(region, slideSize));
        }

        expect(new Set(results).size).toBe(1);
        expect(results[0]).toBe('data-x="10" data-y="20" data-w="30" data-h="40"');
    });
});

describe('default', () => {
    it('exposes the named exports on the default object', () => {
        expect(layoutProtocol).toMatchObject({
            LAYOUT_REGIONS,
            resolveLayoutType,
            layoutTypeFromCss,
            getRegion,
            regionToDslAttrs
        });
    });

    it('does not include unexpected keys', () => {
        expect(Object.keys(layoutProtocol).sort()).toEqual(
            ['LAYOUT_REGIONS', 'resolveLayoutType', 'layoutTypeFromCss', 'getRegion', 'regionToDslAttrs']
                .sort()
        );
    });
});
