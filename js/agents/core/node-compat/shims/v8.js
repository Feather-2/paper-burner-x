/**
 * v8 shim - V8 engine internals are not available in browser
 * Provides stubs for common usage patterns
 */

export function getHeapStatistics() {
  return {
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
  };
}

export function getHeapSpaceStatistics() {
  return [];
}

export function getHeapCodeStatistics() {
  return {
    code_and_metadata_size: 0,
    bytecode_and_metadata_size: 0,
    external_script_source_size: 0,
  };
}

export function getHeapSnapshot() {
  return null;
}

export function writeHeapSnapshot() {
  return '';
}

export function setFlagsFromString(_flags) {}

export function takeCoverage() {}

export function stopCoverage() {}

export function serialize(value) {
  const json = JSON.stringify(value);
  return Buffer.from(json);
}

export function deserialize(buffer) {
  return JSON.parse(buffer.toString());
}

export class Serializer {
  writeHeader() {}
  writeValue(_value) {}
  releaseBuffer() {
    return Buffer.from('');
  }
}

export class Deserializer {
  constructor(_buffer) {}
  readHeader() {
    return true;
  }
  readValue() {
    return null;
  }
}

export class DefaultSerializer extends Serializer {}
export class DefaultDeserializer extends Deserializer {}

export function promiseHooks() {
  return {
    onInit: () => {},
    onSettled: () => {},
    onBefore: () => {},
    onAfter: () => {},
    createHook: () => ({ enable: () => {}, disable: () => {} }),
  };
}

export default {
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
};
