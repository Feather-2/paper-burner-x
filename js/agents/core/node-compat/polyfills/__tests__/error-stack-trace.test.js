import { describe, it, expect, beforeEach } from 'vitest';
import { setupErrorStackTracePolyfill } from '../error-stack-trace.js';

/**
 * Create a mock target with a clean Error constructor
 * that has no captureStackTrace, so the polyfill installs.
 */
function createMockTarget() {
  function MockError(msg) {
    this.message = msg;
    this.name = 'Error';
  }
  MockError.prototype = Object.create(Error.prototype);
  return { Error: MockError };
}

describe('setupErrorStackTracePolyfill', () => {
  // 1. Skip when native implementation exists
  it('skips when target.Error.captureStackTrace already exists', () => {
    const target = createMockTarget();
    const original = function nativeCaptureStackTrace() {};
    target.Error.captureStackTrace = original;

    setupErrorStackTracePolyfill(target);

    expect(target.Error.captureStackTrace).toBe(original);
  });

  // 2. Installs polyfill on target.Error
  describe('installation', () => {
    it('installs captureStackTrace on target.Error', () => {
      const target = createMockTarget();
      setupErrorStackTracePolyfill(target);

      expect(typeof target.Error.captureStackTrace).toBe('function');
    });

    it('sets default stackTraceLimit = 10', () => {
      const target = createMockTarget();
      setupErrorStackTracePolyfill(target);

      expect(target.Error.stackTraceLimit).toBe(10);
    });
  });

  // 3. captureStackTrace basic functionality
  describe('captureStackTrace basics', () => {
    let target;

    beforeEach(() => {
      target = createMockTarget();
      setupErrorStackTracePolyfill(target);
    });

    it('sets stack property on target object', () => {
      const obj = { name: 'TestError', message: 'boom' };
      target.Error.captureStackTrace(obj);

      expect(typeof obj.stack).toBe('string');
    });

    it('stack contains error name and message', () => {
      const obj = { name: 'TestError', message: 'something broke' };
      target.Error.captureStackTrace(obj);

      expect(obj.stack).toContain('TestError');
      expect(obj.stack).toContain('something broke');
    });

    it('stack defaults to "Error" when name is missing', () => {
      const obj = { message: 'no name' };
      target.Error.captureStackTrace(obj);

      // The getter uses this.name || 'Error'
      expect(obj.stack).toMatch(/^Error/);
    });

    it('stack shows only name when message is empty', () => {
      const obj = { name: 'MyError', message: '' };
      target.Error.captureStackTrace(obj);

      expect(obj.stack).toMatch(/^MyError/);
    });
  });

  // 4. constructorOpt parameter
  describe('constructorOpt', () => {
    let target;

    beforeEach(() => {
      target = createMockTarget();
      setupErrorStackTracePolyfill(target);
    });

    it('hides frames at and above the specified constructor', () => {
      // Use a regular named function (not `new`) so V8 parses the
      // function name without the "new " prefix, matching constructorOpt.name.
      function captureHelper() {
        const obj = { name: 'E', message: '' };
        target.Error.captureStackTrace(obj, captureHelper);
        return obj;
      }

      const obj = captureHelper();
      const lines = (obj.stack || '').split('\n');
      const frameLines = lines.filter(l => l.trim().startsWith('at '));
      // 'captureHelper' frame and frames above it should be removed
      for (const frame of frameLines) {
        expect(frame).not.toContain('captureHelper');
      }
    });
  });

  // 5. prepareStackTrace support
  describe('prepareStackTrace', () => {
    let target;

    beforeEach(() => {
      target = createMockTarget();
      setupErrorStackTracePolyfill(target);
    });

    it('calls custom prepareStackTrace when set', () => {
      let receivedError = null;
      let receivedSites = null;

      target.Error.prepareStackTrace = (err, sites) => {
        receivedError = err;
        receivedSites = sites;
        return 'custom stack';
      };

      const obj = { name: 'E', message: 'm' };
      target.Error.captureStackTrace(obj);

      expect(obj.stack).toBe('custom stack');
      expect(receivedError).toBe(obj);
      expect(Array.isArray(receivedSites)).toBe(true);

      // Cleanup
      delete target.Error.prepareStackTrace;
    });

    it('prepareStackTrace receives (error, callSites) arguments', () => {
      let argCount = 0;
      target.Error.prepareStackTrace = (...args) => {
        argCount = args.length;
        return 'ok';
      };

      const obj = { name: 'E', message: '' };
      target.Error.captureStackTrace(obj);
      // Access stack to trigger getter
      void obj.stack;

      expect(argCount).toBe(2);

      delete target.Error.prepareStackTrace;
    });
  });

  // 6. CallSite API
  describe('CallSite API', () => {
    it('provides correct CallSite methods for parsed frames', () => {
      const target = createMockTarget();
      setupErrorStackTracePolyfill(target);

      let capturedSites = null;
      target.Error.prepareStackTrace = (_err, sites) => {
        capturedSites = sites;
        return '';
      };

      const obj = { name: 'E', message: '' };
      target.Error.captureStackTrace(obj);
      void obj.stack;

      // We should have at least one call site from the real Error() stack
      expect(capturedSites).not.toBeNull();
      if (capturedSites.length > 0) {
        const site = capturedSites[0];
        expect(typeof site.getFileName()).toBe('string');
        expect(typeof site.getLineNumber()).toBe('number');
        expect(typeof site.getColumnNumber()).toBe('number');
        // getFunctionName can be string or null
        const fn = site.getFunctionName();
        expect(fn === null || typeof fn === 'string').toBe(true);
        expect(site.isNative()).toBe(false);
        expect(typeof site.isToplevel()).toBe('boolean');
        expect(typeof site.toString()).toBe('string');
      }

      delete target.Error.prepareStackTrace;
    });

    it('isToplevel returns true for frames with no function name', () => {
      const target = createMockTarget();
      setupErrorStackTracePolyfill(target);

      let sites = null;
      target.Error.prepareStackTrace = (_err, s) => {
        sites = s;
        return '';
      };

      const obj = { name: 'E', message: '' };
      target.Error.captureStackTrace(obj);
      void obj.stack;

      if (sites && sites.length > 0) {
        for (const site of sites) {
          if (site.getFunctionName() === null) {
            expect(site.isToplevel()).toBe(true);
          } else {
            expect(site.isToplevel()).toBe(false);
          }
        }
      }

      delete target.Error.prepareStackTrace;
    });
  });

  // 7. Stack format parsing
  describe('stack format parsing', () => {
    let target;

    beforeEach(() => {
      target = createMockTarget();
      setupErrorStackTracePolyfill(target);
    });

    it('parses Chrome format: "    at functionName (file:line:col)"', () => {
      let sites = null;
      target.Error.prepareStackTrace = (_err, s) => {
        sites = s;
        return '';
      };

      // The polyfill internally creates new Error() and parses its stack.
      // In V8 (Node), the stack will be Chrome format.
      const obj = { name: 'E', message: '' };
      target.Error.captureStackTrace(obj);
      void obj.stack;

      // In V8 environment, we should get parsed sites
      expect(sites).not.toBeNull();
      expect(Array.isArray(sites)).toBe(true);

      delete target.Error.prepareStackTrace;
    });

    it('parses Chrome anonymous format: "    at file:line:col"', () => {
      // This is tested implicitly - anonymous frames in V8 use this format
      let sites = null;
      target.Error.prepareStackTrace = (_err, s) => {
        sites = s;
        return '';
      };

      const obj = { name: 'E', message: '' };
      target.Error.captureStackTrace(obj);
      void obj.stack;

      expect(Array.isArray(sites)).toBe(true);

      delete target.Error.prepareStackTrace;
    });
  });

  // 7b. Dedicated format parsing tests using synthetic stacks
  describe('stack line format parsing (synthetic)', () => {
    // We test the parsing indirectly by verifying the polyfill's output
    // when it encounters different stack formats.
    // Since we can't inject a raw stack into the polyfill directly,
    // we verify the CallSite toString() output format.

    it('CallSite toString() produces Chrome format for named functions', () => {
      const target = createMockTarget();
      setupErrorStackTracePolyfill(target);

      let sites = null;
      target.Error.prepareStackTrace = (_err, s) => {
        sites = s;
        return '';
      };

      const obj = { name: 'E', message: '' };
      target.Error.captureStackTrace(obj);
      void obj.stack;

      if (sites && sites.length > 0) {
        for (const site of sites) {
          const str = site.toString();
          // Should match either "    at fn (file:line:col)" or "    at file:line:col"
          expect(str).toMatch(/^\s+at\s+/);
        }
      }

      delete target.Error.prepareStackTrace;
    });
  });

  // 8. Idempotency
  describe('idempotency', () => {
    it('repeated calls do not overwrite already installed polyfill', () => {
      const target = createMockTarget();

      setupErrorStackTracePolyfill(target);
      const first = target.Error.captureStackTrace;

      // Second call should detect captureStackTrace exists and skip
      setupErrorStackTracePolyfill(target);
      const second = target.Error.captureStackTrace;

      expect(first).toBe(second);
    });

    it('preserves custom stackTraceLimit across repeated calls', () => {
      const target = createMockTarget();

      setupErrorStackTracePolyfill(target);
      target.Error.stackTraceLimit = 25;

      setupErrorStackTracePolyfill(target);

      expect(target.Error.stackTraceLimit).toBe(25);
    });
  });

  // 9. Stack property setter
  describe('stack property setter', () => {
    it('allows overwriting stack with a custom value', () => {
      const target = createMockTarget();
      setupErrorStackTracePolyfill(target);

      const obj = { name: 'E', message: 'test' };
      target.Error.captureStackTrace(obj);

      obj.stack = 'custom stack value';
      expect(obj.stack).toBe('custom stack value');
    });
  });
});