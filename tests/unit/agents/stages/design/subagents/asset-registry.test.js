import { describe, it, expect, vi, beforeEach } from 'vitest';

const MODULE_PATH = '../../../../../../js/agents/stages/design/subagents/asset-registry.js';
const SHARED_MODULE_PATH = '../../../../../../js/agents/shared/index.js';

let idCounter = 0;

vi.mock('../../../../../../js/agents/shared/index.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    makeSecureTimestampedId: vi.fn(() => `asset_${(idCounter += 1)}`),
    toNonEmptyString: vi.fn(actual.toNonEmptyString),
  };
});

const makeDeepObject = (depth) => {
  let obj = { leaf: true };
  for (let i = 0; i < depth; i += 1) {
    obj = { nested: obj };
  }
  return obj;
};

describe('AssetRegistry', () => {
  let AssetRegistry;
  let makeSecureTimestampedId;
  let toNonEmptyString;

  beforeEach(async () => {
    idCounter = 0;
    vi.clearAllMocks();
    vi.resetModules();
    ({ AssetRegistry } = await import(MODULE_PATH));
    ({ makeSecureTimestampedId, toNonEmptyString } = await import(SHARED_MODULE_PATH));
  });

  it('initializes empty state when no initial data', () => {
    const registry = new AssetRegistry();

    expect(registry.uploaded).toEqual([]);
    expect(registry.extracted).toEqual([]);
    expect(registry.videoFrames).toEqual([]);
    expect(registry.generated).toEqual([]);
    expect(registry.byId.size).toBe(0);
    expect(registry.categoryById.size).toBe(0);
    expect(registry.slideAssetMapping.size).toBe(0);
  });

  it('ingests initial lists and slide mappings', () => {
    const registry = new AssetRegistry({
      uploaded: [
        { assetId: 'u1', source: 'pdf', label: 'upload-one' },
        { assetId: 'u2', source: 'upload' },
      ],
      extracted: [{ assetId: 'e1', source: 'upload' }],
      videoFrames: [{ assetId: 'v1', source: 'video' }],
      generated: [{ assetId: 'g1', source: 'custom' }],
      slideAssetMapping: { slideA: ['u1', 'g1', 'u1'], slideB: 'e1' },
    });

    expect(registry.uploaded.map((asset) => asset.assetId)).toEqual(['u1', 'u2']);
    expect(registry.extracted.map((asset) => asset.assetId)).toEqual(['e1']);
    expect(registry.videoFrames.map((asset) => asset.assetId)).toEqual(['v1']);
    expect(registry.generated.map((asset) => asset.assetId)).toEqual(['g1']);
    expect(registry.categoryById.get('u1')).toBe('uploaded');
    expect(registry.categoryById.get('e1')).toBe('extracted');
    expect(registry.categoryById.get('v1')).toBe('videoFrames');
    expect(registry.categoryById.get('g1')).toBe('generated');
    expect(registry.getAssetsForSlide('slideA').map((asset) => asset.assetId)).toEqual(['u1', 'g1']);
    expect(registry.getAssetsForSlide('slideB').map((asset) => asset.assetId)).toEqual(['e1']);
  });

  it('ignores non-array initial lists and invalid mapping input', () => {
    const registry = new AssetRegistry({
      uploaded: {},
      extracted: null,
      videoFrames: 'nope',
      generated: 0,
      slideAssetMapping: 'bad',
    });

    expect(registry.uploaded).toEqual([]);
    expect(registry.extracted).toEqual([]);
    expect(registry.videoFrames).toEqual([]);
    expect(registry.generated).toEqual([]);
    expect(registry.byId.size).toBe(0);
    expect(registry.slideAssetMapping.size).toBe(0);
  });

  describe('addAsset', () => {
    it('returns null for invalid asset input', () => {
      const registry = new AssetRegistry();

      expect(registry.addAsset(null)).toBeNull();
      expect(registry.addAsset(undefined)).toBeNull();
      expect(registry.addAsset('bad')).toBeNull();
      expect(registry.addAsset(123)).toBeNull();
      expect(registry.addAsset(false)).toBeNull();
      expect(registry.byId.size).toBe(0);
      expect(registry.generated).toHaveLength(0);
    });

    it('accepts empty object assets with default category', () => {
      const registry = new AssetRegistry();
      const id = registry.addAsset({});

      expect(id).toBe('asset_1');
      expect(registry.generated).toHaveLength(1);
      expect(registry.categoryById.get(id)).toBe('generated');
    });

    it('generates id for empty assetId and normalizes category', () => {
      const registry = new AssetRegistry();
      const id = registry.addAsset({ assetId: '   ', name: 'logo' }, { category: '  UPLOAD ' });

      expect(id).toBe('asset_1');
      expect(makeSecureTimestampedId).toHaveBeenCalledTimes(1);
      expect(makeSecureTimestampedId).toHaveBeenCalledWith('asset');
      expect(registry.uploaded).toHaveLength(1);
      expect(registry.uploaded[0].assetId).toBe(id);
      expect(registry.categoryById.get(id)).toBe('uploaded');
      expect(toNonEmptyString).toHaveBeenCalled();
    });

    it('infers category from asset source', () => {
      const registry = new AssetRegistry();

      registry.addAsset({ assetId: 'e1', source: 'pdf' });
      registry.addAsset({ assetId: 'v1', source: 'video-frame' });
      registry.addAsset({ assetId: 'u1', source: 'upload' });
      registry.addAsset({ assetId: 'g1', source: 'custom' });
      registry.addAsset({ assetId: 'g2' });

      expect(registry.extracted.map((asset) => asset.assetId)).toEqual(['e1']);
      expect(registry.videoFrames.map((asset) => asset.assetId)).toEqual(['v1']);
      expect(registry.uploaded.map((asset) => asset.assetId)).toEqual(['u1']);
      expect(registry.generated.map((asset) => asset.assetId)).toEqual(['g1', 'g2']);
    });

    it('moves existing assets across categories', () => {
      const registry = new AssetRegistry();

      registry.addAsset({ assetId: 'move1', source: 'upload', note: 'first' });
      expect(registry.uploaded).toHaveLength(1);

      registry.addAsset({ assetId: 'move1', source: 'gen', note: 'second' }, { category: 'generated' });
      expect(registry.uploaded).toHaveLength(0);
      expect(registry.generated).toHaveLength(1);
      expect(registry.generated[0].note).toBe('second');
      expect(registry.categoryById.get('move1')).toBe('generated');
    });

    it('handles boundary asset ids and string-number interchange', () => {
      const registry = new AssetRegistry();

      registry.addAsset({ assetId: 0, source: 'upload', tag: 'zero' });
      registry.addAsset({ assetId: -1, source: 'upload', tag: 'neg' });
      registry.addAsset({ assetId: Number.MAX_SAFE_INTEGER, source: 'upload', tag: 'max' });
      registry.addAsset({ assetId: '123', source: 'upload', tag: 'string' });

      const assetZero = registry.getAsset(0);
      const assetNeg = registry.getAsset(-1);
      const assetMax = registry.getAsset(Number.MAX_SAFE_INTEGER);
      const assetString = registry.getAsset(123);

      expect(assetZero).not.toBeNull();
      expect(assetNeg).not.toBeNull();
      expect(assetMax).not.toBeNull();
      expect(assetString).not.toBeNull();
      expect(assetZero.tag).toBe('zero');
      expect(assetNeg.tag).toBe('neg');
      expect(assetMax.tag).toBe('max');
      expect(assetString.tag).toBe('string');
    });

    it('stores large payloads and deep nested objects', () => {
      const registry = new AssetRegistry();
      const nested = makeDeepObject(50);
      const data = 'x'.repeat(10000);
      const asset = {
        assetId: 'big1',
        source: 'upload',
        file: { name: 'big.bin', size: Number.MAX_SAFE_INTEGER },
        data,
        nested,
      };

      registry.addAsset(asset, { category: 'upload' });
      const stored = registry.getAsset('big1');

      expect(stored).not.toBeNull();
      expect(stored.data.length).toBe(10000);
      expect(stored.file.size).toBe(Number.MAX_SAFE_INTEGER);
      expect(stored.nested).toBe(nested);
    });

    it('handles rapid successive updates', () => {
      const registry = new AssetRegistry();

      for (let i = 0; i < 5; i += 1) {
        registry.addAsset({ assetId: 'rapid', source: 'upload', version: i });
      }

      const stored = registry.getAsset('rapid');

      expect(registry.uploaded).toHaveLength(1);
      expect(stored).not.toBeNull();
      expect(stored.version).toBe(4);
    });
  });

  describe('getAsset', () => {
    it('returns null for empty or whitespace ids', () => {
      const registry = new AssetRegistry();

      expect(registry.getAsset(null)).toBeNull();
      expect(registry.getAsset(undefined)).toBeNull();
      expect(registry.getAsset('')).toBeNull();
      expect(registry.getAsset('   ')).toBeNull();
    });
  });

  describe('linkToSlide', () => {
    it('rejects invalid slide ids and supports empty arrays', () => {
      const registry = new AssetRegistry();

      expect(registry.linkToSlide(null, 'a1')).toBe(false);
      expect(registry.linkToSlide(undefined, ['a1'])).toBe(false);
      expect(registry.linkToSlide('   ', ['a1'])).toBe(false);
      expect(registry.slideAssetMapping.size).toBe(0);

      expect(registry.linkToSlide(0, ['a1', '', null, 'a1', -1])).toBe(true);
      expect(registry.slideAssetMapping.get('0')).toEqual(['a1', '-1']);

      expect(registry.linkToSlide('empty', [])).toBe(true);
      expect(registry.slideAssetMapping.get('empty')).toEqual([]);
    });

    it('accepts object assetIds and normalizes them', () => {
      const registry = new AssetRegistry();
      const payload = { id: 'x' };

      expect(registry.linkToSlide('objSlide', payload)).toBe(true);
      expect(registry.slideAssetMapping.get('objSlide')).toEqual(['[object Object]']);
    });
  });

  describe('getAssetsForSlide', () => {
    it('returns assets for existing ids and filters missing ones', () => {
      const registry = new AssetRegistry();

      registry.addAsset({ assetId: 'a1', source: 'upload' });
      registry.addAsset({ assetId: 'a2', source: 'upload' });
      registry.linkToSlide('slide1', ['a1', 'missing', 'a2']);

      expect(registry.getAssetsForSlide('slide1').map((asset) => asset.assetId)).toEqual(['a1', 'a2']);
      expect(registry.getAssetsForSlide('   ')).toEqual([]);
      expect(registry.getAssetsForSlide('unknown')).toEqual([]);
    });
  });

  describe('export', () => {
    it('returns copies and filters unsafe keys', () => {
      const registry = new AssetRegistry();

      registry.addAsset({ assetId: 'u1', source: 'upload' }, { category: 'upload' });
      registry.addAsset({ assetId: 'g1', source: 'gen' }, { category: 'gen' });
      registry.linkToSlide('__proto__', ['u1']);
      registry.linkToSlide('constructor', ['u1']);
      registry.linkToSlide('prototype', ['u1']);
      registry.linkToSlide('safe', ['u1', 'g1']);
      registry.linkToSlide(0, ['u1']);

      const snapshot = registry.export();

      expect(snapshot.slideAssetMapping).toEqual({ safe: ['u1', 'g1'], '0': ['u1'] });

      snapshot.uploaded.push({ assetId: 'extra' });
      expect(registry.uploaded).toHaveLength(1);

      snapshot.slideAssetMapping.safe.push('extra');
      expect(registry.slideAssetMapping.get('safe')).toEqual(['u1', 'g1']);
    });
  });

  describe('toJSON', () => {
    it('returns a versioned snapshot', () => {
      const registry = new AssetRegistry();

      registry.addAsset({ assetId: 'a1', source: 'upload' });
      registry.linkToSlide('slide1', 'a1');

      const json = registry.toJSON();

      expect(json._v).toBe(1);
      expect(json.uploaded).toHaveLength(1);
      expect(json.slideAssetMapping).toEqual({ slide1: ['a1'] });
    });
  });

  describe('fromJSON', () => {
    it('creates empty registry for invalid input and hydrates valid data', () => {
      const empty = AssetRegistry.fromJSON(null);
      const emptyString = AssetRegistry.fromJSON('bad');

      expect(empty).toBeInstanceOf(AssetRegistry);
      expect(empty.uploaded).toEqual([]);
      expect(emptyString.generated).toEqual([]);

      const registry = AssetRegistry.fromJSON({
        uploaded: [{ assetId: 'u1', source: 'upload' }],
        generated: [{ assetId: 'g1', source: 'gen' }],
        slideAssetMapping: { s1: ['u1', 'g1'] },
      });

      expect(registry.getAssetsForSlide('s1').map((asset) => asset.assetId)).toEqual(['u1', 'g1']);
    });
  });

  it('handles concurrent addAsset calls', async () => {
    const registry = new AssetRegistry();
    const tasks = Array.from({ length: 20 }, () =>
      Promise.resolve().then(() => registry.addAsset({ source: 'upload' })),
    );
    const ids = await Promise.all(tasks);

    expect(ids).toHaveLength(20);
    expect(new Set(ids).size).toBe(20);
    expect(registry.uploaded).toHaveLength(20);
    expect(makeSecureTimestampedId).toHaveBeenCalledTimes(20);
  });
});
