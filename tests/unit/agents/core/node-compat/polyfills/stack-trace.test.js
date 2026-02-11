import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  parseStack,
  createCallSite,
  installStackTracePolyfill,
} from '../../../../../../js/agents/core/node-compat/polyfills/stack-trace.js';

describe('stack-trace polyfill', () => {
  // 1. parseStack parses V8 format
  it('parses V8 format stack traces', () => {
    const stack = [
      'Error: test',
      '    at myFunc (file.js:10:5)',
      '    at Object.<anonymous> (main.js:1:1)',
      '    at module.js:20:30',
    ].join('\n');

    const sites = parseStack(stack);
    expect(sites).toHaveLength(3);
    expect(sites[0].getFunctionName()).toBe('myFunc');
    expect(sites[0].getFileName()).toBe('file.js');
    expect(sites[0].getLineNumber()).toBe(10);
    expect(sites[0].getColumnNumber()).toBe(5);
    expect(sites[1].getFunctionName()).toBe('Object.<anonymous>');
    expect(sites[2].getFunctionName()).toBe(null);
    expect(sites[2].getFileName()).toBe('module.js');
  });

  // 2. parseStack parses Safari format
  it('parses Safari/Firefox format stack traces', () => {
    const stack = [
      'myFunc@file.js:10:5',
      '@main.js:1:1',
    ].join('\n');

    const sites = parseStack(stack);
    expect(sites).toHaveLength(2);
    expect(sites[0].getFunctionName()).toBe('myFunc');
    expect(sites[0].getFileName()).toBe('file.js');
    expect(sites[0].getLineNumber()).toBe(10);
    expect(sites[1].getFunctionName()).toBe(null);
    expect(sites[1].isToplevel()).toBe(true);
  });

  // 3. createCallSite returns correct methods
  it('createCallSite returns a valid CallSite object', () => {
    const site = createCallSite('doStuff', 'app.js', 42, 7);
    expect(site.getFileName()).toBe('app.js');
    expect(site.getLineNumber()).toBe(42);
    expect(site.getColumnNumber()).toBe(7);
    expect(site.getFunctionName()).toBe('doStuff');
    expect(site.getTypeName()).toBe(null);
    expect(site.getMethodName()).toBe(null);
    expect(site.isNative()).toBe(false);
    expect(site.isToplevel()).toBe(false);
    expect(site.isConstructor()).toBe(false);
    expect(site.toString()).toBe('doStuff (app.js:42:7)');
  });

  // 4. installStackTracePolyfill makes captureStackTrace available
  describe('installStackTracePolyfill', () => {
    let fakeTarget;

    beforeEach(() => {
      // Use a plain constructor so it does NOT inherit native captureStackTrace
      function FakeError(msg) { this.message = msg; }
      FakeError.prototype = Object.create(Error.prototype);
      FakeError.prototype.constructor = FakeError;
      fakeTarget = { Error: FakeError };
    });

    it('installs captureStackTrace on target Error', () => {
      installStackTracePolyfill(fakeTarget);
      expect(typeof fakeTarget.Error.captureStackTrace).toBe('function');
      expect(fakeTarget.Error.captureStackTrace.__polyfill).toBe(true);
    });

    // 5. captureStackTrace sets .stack property
    it('captureStackTrace sets .stack property on target object', () => {
      installStackTracePolyfill(fakeTarget);
      const obj = {};
      fakeTarget.Error.captureStackTrace(obj);
      // Accessing .stack triggers the getter
      expect(typeof obj.stack).toBe('string');
    });

    // 6. prepareStackTrace callback is invoked
    it('calls prepareStackTrace when defined', () => {
      installStackTracePolyfill(fakeTarget);
      const prepared = [];
      fakeTarget.Error.prepareStackTrace = (err, sites) => {
        prepared.push(sites);
        return 'custom stack';
      };
      const obj = {};
      fakeTarget.Error.captureStackTrace(obj);
      expect(obj.stack).toBe('custom stack');
      expect(prepared.length).toBe(1);
      expect(Array.isArray(prepared[0])).toBe(true);
      delete fakeTarget.Error.prepareStackTrace;
    });

    // 7. Skips installation when native implementation exists
    it('skips when native captureStackTrace exists', () => {
      const nativeFn = function captureStackTrace() {};
      fakeTarget.Error.captureStackTrace = nativeFn;
      installStackTracePolyfill(fakeTarget);
      // Should remain the native function, not replaced
      expect(fakeTarget.Error.captureStackTrace).toBe(nativeFn);
    });
  });
});
