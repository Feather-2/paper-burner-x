/**
 * @file tests/unit/agents/plugins/policy/engine.test.js
 * @description Unit tests for PolicyEngine behavior, covering normalization, matching, and boundary/error cases.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../../js/agents/plugins/policy/match.js', async () => {
    const actual = await vi.importActual('../../../../../js/agents/plugins/policy/match.js');
    return {
        ...actual,
        matchAnyWildcard: vi.fn(actual.matchAnyWildcard),
        matchAnyGlob: vi.fn(actual.matchAnyGlob),
    };
});

vi.mock('../../../../../js/agents/shared/index.js', async () => {
    const actual = await vi.importActual('../../../../../js/agents/shared/index.js');
    return {
        ...actual,
        makeSecureTimestampedId: vi.fn((prefix = 'id') => `${prefix}_fixed`),
    };
});

import PolicyEngineDefault, { PolicyEngine as PolicyEngineNamed } from '../../../../../js/agents/plugins/policy/engine.js';
import { makeSecureTimestampedId } from '../../../../../js/agents/shared/index.js';

beforeEach(() => {
    vi.clearAllMocks();
});

describe('default export', () => {
    it('aliases the named export', () => {
        expect(PolicyEngineDefault).toBe(PolicyEngineNamed);
    });
});

describe('PolicyEngine', () => {
    describe('constructor', () => {
        it('normalizes rules, defaults, and uses generated ids', () => {
            const engine = new PolicyEngineNamed({
                defaultEffect: 'deny',
                rules: [
                    {
                        effect: 'ALLOW',
                        type: ['read', '   '],
                        tool: 'fetch',
                        domainSuffix: '.Example.COM',
                        timeRange: {
                            start: '08:30',
                            end: '09:45',
                            timezone: 'UTC',
                            daysOfWeek: [0, '1', 'bad', 9],
                        },
                        when: { resource: 'https://example.com/*' },
                        priority: '5',
                        createdAt: '2024-01-01T00:00:00.000Z',
                        updatedAt: '   ',
                    },
                    {
                        id: 'explicit',
                        effect: 'deny',
                        priority: -1,
                        updatedAt: '2024-01-02T00:00:00.000Z',
                    },
                ],
            });

            const rules = engine.getRules();

            expect(engine.defaultEffect).toBe('deny');
            expect(makeSecureTimestampedId).toHaveBeenCalledTimes(1);
            expect(makeSecureTimestampedId).toHaveBeenCalledWith('rule');

            const [first, second] = rules;
            expect(first.ruleId).toBe('rule_fixed');
            expect(first.effect).toBe('allow');
            expect(first.types).toEqual(['read']);
            expect(first.domainSuffixes).toEqual(['example.com']);
            expect(first.timeRange).toEqual({
                startMin: 510,
                endMin: 585,
                timezone: 'utc',
                daysOfWeek: [0, 1],
            });
            expect(first.match).toEqual({ resource: 'https://example.com/*' });
            expect(first.enabled).toBe(true);
            expect(first.priority).toBe(5);
            expect(first.createdAt).toBe('2024-01-01T00:00:00.000Z');
            expect(first.updatedAt).toBe('2024-01-01T00:00:00.000Z');

            expect(second.ruleId).toBe('explicit');
            expect(second.effect).toBe('deny');
        });
    });

    describe('setRules', () => {
        it('sorts rules by priority and updatedAt using boundary values', () => {
            const engine = new PolicyEngineNamed();

            engine.setRules([
                { id: 'low', effect: 'allow', priority: -1, updatedAt: '2024-01-01T00:00:00Z' },
                { id: 'mid', effect: 'allow', priority: 0, updatedAt: '2024-01-02T00:00:00Z' },
                { id: 'high', effect: 'allow', priority: Number.MAX_SAFE_INTEGER, updatedAt: '2024-01-03T00:00:00Z' },
                { id: 'tieA', effect: 'allow', priority: 5, updatedAt: '2024-01-04T00:00:00Z' },
                { id: 'tieB', effect: 'allow', priority: 5, updatedAt: '2024-01-05T00:00:00Z' },
            ]);

            const order = engine.getRules().map((rule) => rule.ruleId);
            expect(order).toEqual(['high', 'tieB', 'tieA', 'mid', 'low']);
        });

        it('clears rules when non-array input is provided', () => {
            const engine = new PolicyEngineNamed({
                rules: [{ id: 'keep', effect: 'allow' }],
            });

            engine.setRules(null);
            expect(engine.getRules()).toEqual([]);

            engine.setRules(undefined);
            expect(engine.getRules()).toEqual([]);

            engine.setRules({});
            expect(engine.getRules()).toEqual([]);
        });
    });

    describe('getRules', () => {
        it('returns a copy that does not mutate internal rules', () => {
            const engine = new PolicyEngineNamed({
                rules: [{ id: 'r1', effect: 'allow' }],
            });

            const rules = engine.getRules();
            rules.push({ ruleId: 'r2', effect: 'deny' });

            expect(engine.getRules()).toHaveLength(1);
            expect(engine.getRules()[0].ruleId).toBe('r1');
        });
    });

    describe('evaluate', () => {
        it('requires approval when type is missing or blank', () => {
            const engine = new PolicyEngineNamed({
                rules: [{ id: 'allow', effect: 'allow', type: 'read' }],
            });

            const cases = [null, undefined, {}, { type: '' }, { type: '   ' }];
            for (const input of cases) {
                const result = engine.evaluate(input);
                expect(result.allowed).toBe(false);
                expect(result.requiresApproval).toBe(true);
                expect(result.reason).toBe('missing_type');
            }
        });

        it('gives deny rules precedence over allow rules', () => {
            const engine = new PolicyEngineNamed({
                rules: [
                    { id: 'allow', effect: 'allow', type: 'read', tool: 'fetch', updatedAt: '2024-01-02T00:00:00Z' },
                    { id: 'deny', effect: 'deny', type: 'read', tool: 'fetch', updatedAt: '2024-01-01T00:00:00Z' },
                ],
            });

            const result = engine.evaluate({
                type: 'read',
                tool: 'fetch',
                resource: 'https://example.com/data',
            });

            expect(result).toEqual({
                allowed: false,
                requiresApproval: false,
                effect: 'deny',
                ruleId: 'deny',
                reason: 'matched_deny_rule',
            });
        });

        it('applies default effects when no rules match', () => {
            const request = { type: 0 };

            const allowEngine = new PolicyEngineNamed({ defaultEffect: 'allow' });
            expect(allowEngine.evaluate(request)).toEqual({
                allowed: true,
                requiresApproval: false,
                effect: 'allow',
                reason: 'default_allow',
            });

            const denyEngine = new PolicyEngineNamed({ defaultEffect: 'deny' });
            expect(denyEngine.evaluate(request)).toEqual({
                allowed: false,
                requiresApproval: false,
                effect: 'deny',
                reason: 'default_deny',
            });

            const promptEngine = new PolicyEngineNamed();
            expect(promptEngine.evaluate(request)).toEqual({
                allowed: false,
                requiresApproval: true,
                reason: 'no_matching_rule',
            });
        });

        it('matches rules even when the type list is empty', () => {
            const engine = new PolicyEngineNamed({
                rules: [
                    { id: 'empty-types', effect: 'allow', types: [], tool: 'fetch', updatedAt: '2024-01-01T00:00:00Z' },
                ],
            });

            const result = engine.evaluate({
                type: 'anything',
                tool: 'fetch',
                resource: 'https://example.com/data',
            });

            expect(result.allowed).toBe(true);
            expect(result.ruleId).toBe('empty-types');
            expect(result.reason).toBe('matched_allow_rule');
        });

        it('ignores rules with object types and falls back to default', () => {
            const engine = new PolicyEngineNamed({
                defaultEffect: 'deny',
                rules: [
                    { id: 'bad-types', effect: 'allow', types: { bad: true }, updatedAt: '2024-01-01T00:00:00Z' },
                ],
            });

            const result = engine.evaluate({
                type: 'read',
                tool: 'fetch',
                resource: 'https://example.com/data',
            });

            expect(result).toEqual({
                allowed: false,
                requiresApproval: false,
                effect: 'deny',
                reason: 'default_deny',
            });
        });

        it('supports complex match conditions including string resources and not clauses', () => {
            const engine = new PolicyEngineNamed({
                rules: [
                    {
                        id: 'complex',
                        effect: 'allow',
                        type: 'network',
                        match: {
                            all: [{ tool: 'fetch' }],
                            any: ['https://example.com/*', { resource: 'https://example.org/*' }],
                            not: [{ resource: 'https://example.com/private/*' }],
                        },
                    },
                ],
            });

            const allowed = engine.evaluate({
                type: 'network',
                tool: 'fetch',
                resource: 'https://example.com/data',
            });
            expect(allowed.allowed).toBe(true);
            expect(allowed.ruleId).toBe('complex');

            const blocked = engine.evaluate({
                type: 'network',
                tool: 'fetch',
                resource: 'https://example.com/private/secret',
            });
            expect(blocked.allowed).toBe(false);
            expect(blocked.requiresApproval).toBe(true);
            expect(blocked.reason).toBe('no_matching_rule');
        });

        it('rejects empty any-lists in match conditions', () => {
            const engine = new PolicyEngineNamed({
                defaultEffect: 'deny',
                rules: [
                    {
                        id: 'empty-any',
                        effect: 'allow',
                        type: 'network',
                        match: { any: [] },
                    },
                ],
            });

            const result = engine.evaluate({
                type: 'network',
                resource: 'https://example.com/data',
            });

            expect(result.reason).toBe('default_deny');
        });

        it('matches time ranges at boundary values', () => {
            const engine = new PolicyEngineNamed({
                rules: [
                    {
                        id: 'midnight',
                        effect: 'allow',
                        type: 'time',
                        timeRange: {
                            start: '00:00',
                            end: '00:00',
                            timezone: 'UTC',
                            daysOfWeek: [1],
                        },
                        updatedAt: '2024-01-01T00:00:00Z',
                    },
                ],
            });

            const result = engine.evaluate({
                type: 'time',
                ts: '2024-01-01T00:00:00Z',
            });

            expect(result.allowed).toBe(true);
            expect(result.ruleId).toBe('midnight');
        });

        it('treats invalid time ranges in match conditions as non-matches', () => {
            const engine = new PolicyEngineNamed({
                defaultEffect: 'deny',
                rules: [
                    {
                        id: 'bad-time',
                        effect: 'allow',
                        type: 'time',
                        match: {
                            timeRange: { start: '25:00', end: '26:00' },
                        },
                    },
                ],
            });

            const result = engine.evaluate({
                type: 'time',
                ts: '2024-01-01T00:00:00Z',
            });

            expect(result.reason).toBe('default_deny');
        });

        it('rejects overly deep match trees', () => {
            const buildDeepCondition = (depth) => {
                let cond = { resource: 'https://example.com/*' };
                for (let i = 0; i < depth; i += 1) {
                    cond = { all: [cond] };
                }
                return cond;
            };

            const engine = new PolicyEngineNamed({
                defaultEffect: 'deny',
                rules: [
                    {
                        id: 'deep',
                        effect: 'allow',
                        type: 'network',
                        match: buildDeepCondition(13),
                    },
                ],
            });

            const result = engine.evaluate({
                type: 'network',
                resource: 'https://example.com/data',
            });

            expect(result.reason).toBe('default_deny');
        });

        it('handles long resources and large file paths', () => {
            const longSegment = 'a'.repeat(5000);
            const longResource = `https://sub.example.com/${longSegment}`;
            const longPath = `data/${'b'.repeat(5000)}/file.txt`;

            const engine = new PolicyEngineNamed({
                rules: [
                    {
                        id: 'net-long',
                        effect: 'allow',
                        type: 'network',
                        resource: '*',
                        domainSuffix: 'example.com',
                        updatedAt: '2024-01-01T00:00:00Z',
                    },
                    {
                        id: 'file-long',
                        effect: 'allow',
                        type: 'file',
                        path: 'data/**',
                        updatedAt: '2024-01-01T00:00:00Z',
                    },
                ],
            });

            const netResult = engine.evaluate({
                type: 'network',
                resource: longResource,
            });
            expect(netResult.allowed).toBe(true);
            expect(netResult.ruleId).toBe('net-long');

            const fileResult = engine.evaluate({
                type: 'file',
                path: longPath,
                resource: longPath,
            });
            expect(fileResult.allowed).toBe(true);
            expect(fileResult.ruleId).toBe('file-long');
        });

        it('supports concurrent evaluate calls', async () => {
            const engine = new PolicyEngineNamed({
                rules: [
                    { id: 'allow-read', effect: 'allow', type: 'read', updatedAt: '2024-01-01T00:00:00Z' },
                    { id: 'deny-write', effect: 'deny', type: 'write', updatedAt: '2024-01-01T00:00:00Z' },
                ],
            });

            const requests = [
                { type: 'read', resource: 'a' },
                { type: 'write', resource: 'b' },
                { type: 'read', resource: 'c' },
            ];

            const results = await Promise.all(
                requests.map((req) => Promise.resolve(engine.evaluate(req)))
            );

            expect(results[0].allowed).toBe(true);
            expect(results[1].allowed).toBe(false);
            expect(results[1].reason).toBe('matched_deny_rule');
            expect(results[2].allowed).toBe(true);
        });

        it('handles rapid sequential evaluate calls consistently', () => {
            const engine = new PolicyEngineNamed({
                rules: [
                    { id: 'allow', effect: 'allow', type: 'read', updatedAt: '2024-01-01T00:00:00Z' },
                ],
            });

            for (let i = 0; i < 25; i += 1) {
                const result = engine.evaluate({
                    type: 'read',
                    resource: `res-${i}`,
                });
                expect(result.allowed).toBe(true);
                expect(result.ruleId).toBe('allow');
                expect(result.reason).toBe('matched_allow_rule');
            }
        });
    });
});
