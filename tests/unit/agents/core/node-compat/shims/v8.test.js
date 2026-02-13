import { describe, it, expect } from 'vitest';
import v8, {
  getHeapStatistics,
  getHeapSpaceStatistics,
  getHeapCodeStatistics,
  getHeapSnapshot,
  writeHeapSnapshot,
  setFlagsFromString,
  takeCoverage,
  stopCoverage,
  serialize,
  deserialize,
  Serializer,
  Deserializer,
  DefaultSerializer,
  DefaultDeserializer,
  promiseHooks,
} from '../../../../../../js/agents/core/node-compat/shims/v8.js';

describe('v8 shim', () => {
  it('heap/statistics APIs return browser-safe defaults', () => {
    expect(getHeapStatistics()).toEqual({
      total_heap_size: 0,
      total_heap_size_executable: 0,
      total_physical_size: 0,
      total_available_size: 0,
      used_heap_size: 0,
      heap_size_limit: 0,
      malloced_memory: 0,
      peak_malloced_memory: 0,
      does_zap_garbage: 0,
      number_of_native_contexts: 0,
      number_of_detached_contexts: 0,
    });
    expect(getHeapSpaceStatistics()).toEqual([]);
    expect(getHeapCodeStatistics()).toEqual({
      code_and_metadata_size: 0,
      bytecode_and_metadata_size: 0,
      external_script_source_size: 0,
    });
    expect(getHeapSnapshot()).toBeNull();
    expect(writeHeapSnapshot()).toBe('');
  });

  it('coverage/flags methods are no-op', () => {
    expect(() => setFlagsFromString('--trace_gc')).not.toThrow();
    expect(() => takeCoverage()).not.toThrow();
    expect(() => stopCoverage()).not.toThrow();
  });

  it('serialize/deserialize supports JSON round-trip', () => {
    const payload = { a: 1, b: ['x', 'y'] };
    const buf = serialize(payload);
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(deserialize(buf)).toEqual(payload);
  });

  it('Serializer/Deserializer classes expose stub contract', () => {
    const serializer = new Serializer();
    expect(() => serializer.writeHeader()).not.toThrow();
    expect(() => serializer.writeValue({ key: 'value' })).not.toThrow();
    const out = serializer.releaseBuffer();
    expect(Buffer.isBuffer(out)).toBe(true);
    expect(out.length).toBe(0);

    const deserializer = new Deserializer(Buffer.from(''));
    expect(deserializer.readHeader()).toBe(true);
    expect(deserializer.readValue()).toBeNull();

    expect(new DefaultSerializer()).toBeInstanceOf(Serializer);
    expect(new DefaultDeserializer(Buffer.from(''))).toBeInstanceOf(Deserializer);
  });

  it('promiseHooks returns lifecycle handlers and hook factory', () => {
    const hooks = promiseHooks();
    expect(() => hooks.onInit()).not.toThrow();
    expect(() => hooks.onSettled()).not.toThrow();
    expect(() => hooks.onBefore()).not.toThrow();
    expect(() => hooks.onAfter()).not.toThrow();

    const hook = hooks.createHook();
    expect(() => hook.enable()).not.toThrow();
    expect(() => hook.disable()).not.toThrow();
  });

  it('default export mirrors named exports', () => {
    expect(v8.getHeapStatistics).toBe(getHeapStatistics);
    expect(v8.getHeapSpaceStatistics).toBe(getHeapSpaceStatistics);
    expect(v8.getHeapCodeStatistics).toBe(getHeapCodeStatistics);
    expect(v8.getHeapSnapshot).toBe(getHeapSnapshot);
    expect(v8.writeHeapSnapshot).toBe(writeHeapSnapshot);
    expect(v8.setFlagsFromString).toBe(setFlagsFromString);
    expect(v8.takeCoverage).toBe(takeCoverage);
    expect(v8.stopCoverage).toBe(stopCoverage);
    expect(v8.serialize).toBe(serialize);
    expect(v8.deserialize).toBe(deserialize);
    expect(v8.Serializer).toBe(Serializer);
    expect(v8.Deserializer).toBe(Deserializer);
    expect(v8.DefaultSerializer).toBe(DefaultSerializer);
    expect(v8.DefaultDeserializer).toBe(DefaultDeserializer);
    expect(v8.promiseHooks).toBe(promiseHooks);
  });
});
