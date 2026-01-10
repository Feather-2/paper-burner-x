/**
 * Node.js test runner globals setup
 * Provides browser-like globals for testing ESM modules
 */

import { createRequire } from "node:module";

// Provide a CommonJS `require` for tests running as ESM under `"type": "module"`.
if (typeof globalThis.require === "undefined") {
  globalThis.require = createRequire(import.meta.url);
}

// Provide a minimal globalThis.window for modules that check for browser environment
if (typeof globalThis.window === 'undefined') {
  globalThis.window = globalThis;
}

// Provide localStorage stub
if (typeof globalThis.localStorage === 'undefined') {
  const storage = new Map();
  globalThis.localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: (key) => storage.delete(key),
    clear: () => storage.clear(),
    get length() { return storage.size; },
    key: (index) => [...storage.keys()][index] ?? null,
  };
}

// Provide sessionStorage stub
if (typeof globalThis.sessionStorage === 'undefined') {
  const storage = new Map();
  globalThis.sessionStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: (key) => storage.delete(key),
    clear: () => storage.clear(),
    get length() { return storage.size; },
    key: (index) => [...storage.keys()][index] ?? null,
  };
}

// Provide fetch stub if not available
if (typeof globalThis.fetch === 'undefined') {
  globalThis.fetch = async () => {
    throw new Error('fetch not available in test environment');
  };
}

// Provide crypto.randomUUID if not available
if (typeof globalThis.crypto === 'undefined') {
  globalThis.crypto = {
    randomUUID: () => {
      return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
      });
    },
    getRandomValues: (arr) => {
      for (let i = 0; i < arr.length; i++) {
        arr[i] = Math.floor(Math.random() * 256);
      }
      return arr;
    }
  };
}

console.log('[node-test-globals] Test environment initialized');
