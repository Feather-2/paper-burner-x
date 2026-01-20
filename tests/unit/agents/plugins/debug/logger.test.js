import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../../js/agents/core/plugin.js', async () => {
  const actual = await vi.importActual('../../../../../js/agents/core/plugin.js');
  return {
    ...actual,
    createPlugin: vi.fn((config) => actual.createPlugin(config)),
  };
});

import loggerPlugin from '../../../../../js/agents/plugins/debug/logger.js';

vi.spyOn(console, 'debug').mockImplementation(() => {});
vi.spyOn(console, 'info').mockImplementation(() => {});
vi.spyOn(console, 'warn').mockImplementation(() => {});
vi.spyOn(console, 'error').mockImplementation(() => {});

const baseConfig = {
  level: 'debug',
  pretty: true,
  includeTimestamp: false,
  includeEventData: true,
  maxDataLength: 100,
  maxBuffer: 50,
  sensitiveFields: [],
};

const createMockCtx = (configOverrides = {}) => {
  /** @type {any} */
  const ctx = {
    config: { ...baseConfig, ...configOverrides },
    _services: {},
    _eventPattern: null,
    _eventHandler: null,
    _statePattern: null,
    _stateHandler: null,
    registerService: vi.fn((name, service) => {
      ctx._services[name] = service;
    }),
    on: vi.fn((pattern, cb) => {
      ctx._eventPattern = pattern;
      ctx._eventHandler = cb;
      return vi.fn();
    }),
    state: {
      subscribe: vi.fn((pattern, cb) => {
        ctx._statePattern = pattern;
        ctx._stateHandler = cb;
        return vi.fn();
      }),
      set: vi.fn(),
    },
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  };

  return ctx;
};

const setupLogger = (configOverrides = {}) => {
  const ctx = createMockCtx(configOverrides);
  loggerPlugin.install(ctx);
  return {
    ctx,
    service: ctx._services.logger,
    emitEvent: (evt) => ctx._eventHandler?.(evt),
    emitState: (newValue, oldValue, path) => ctx._stateHandler?.(newValue, oldValue, path),
  };
};

const createDeepObject = (finalValue) => {
  const root = { level: 0 };
  let node = root;
  for (let i = 1; i <= 10; i += 1) {
    node.next = { level: i };
    node = node.next;
  }
  node.refreshToken = finalValue;
  return root;
};

beforeEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('default', () => {
  it('exposes plugin metadata and defaults', () => {
    expect(loggerPlugin.name).toBe('debug/logger');
    expect(loggerPlugin.version).toBe('1.0.0');
    expect(typeof loggerPlugin.description).toBe('string');
    expect(loggerPlugin.description.length).toBeGreaterThan(0);
    expect(loggerPlugin.defaultConfig).toEqual({
      level: 'debug',
      pretty: true,
      includeTimestamp: true,
      includeEventData: false,
      maxDataLength: 500,
      sensitiveFields: [],
    });
    expect(typeof loggerPlugin.install).toBe('function');
  });

  it('registers service, listeners, and installedAt with config copies', () => {
    vi.useFakeTimers();
    const now = new Date('2024-01-01T00:00:00.000Z');
    vi.setSystemTime(now);

    const { ctx, service, emitEvent } = setupLogger({ maxBuffer: 5 });

    expect(ctx.registerService).toHaveBeenCalledWith('logger', expect.any(Object));
    expect(service).toBeDefined();
    expect(ctx._eventPattern).toBe('*');
    expect(ctx._statePattern).toBe('*');
    expect(ctx.state.set).toHaveBeenCalledWith('installedAt', now.getTime());
    expect(ctx.log.info).toHaveBeenCalledWith('Debug logger plugin installed');

    const configCopy = service.getConfig();
    expect(configCopy).toEqual(ctx.config);
    configCopy.level = 'error';
    expect(ctx.config.level).toBe('debug');

    emitEvent({ name: 'custom.event', payload: { ok: true } });
    expect(service.getBuffer()).toHaveLength(1);

    const bufferCopy = service.getBuffer();
    bufferCopy.push({ level: 'debug', event: 'x', data: {}, timestamp: 0 });
    expect(service.getBuffer()).toHaveLength(1);

    expect(service.clearBuffer()).toBe(true);
    expect(service.getBuffer()).toHaveLength(0);
  });

  it('classifies event levels and formats pretty timestamps', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'));

    const { service, emitEvent } = setupLogger({
      includeTimestamp: true,
      pretty: true,
      includeEventData: false,
      maxBuffer: 10,
    });

    emitEvent({ name: 'custom.error', payload: { ok: true } });
    emitEvent({ name: 'custom.warning', payload: { ok: true } });
    emitEvent({ name: 'custom.warn', payload: { ok: true } });
    emitEvent({ name: 'kernel.started', payload: { ok: true } });
    emitEvent({ name: 'plugin.ready', payload: { ok: true } });
    emitEvent({ name: 'random.event', payload: { ok: true } });

    const buffer = service.getBuffer();
    const levelsByEvent = Object.fromEntries(buffer.map((entry) => [entry.event, entry.level]));

    expect(levelsByEvent['custom.error']).toBe('error');
    expect(levelsByEvent['custom.warning']).toBe('warn');
    expect(levelsByEvent['custom.warn']).toBe('warn');
    expect(levelsByEvent['kernel.started']).toBe('info');
    expect(levelsByEvent['plugin.ready']).toBe('info');
    expect(levelsByEvent['random.event']).toBe('debug');

    const debugCall = console.debug.mock.calls.find((call) => call[0].includes('random.event'))?.[0];
    expect(debugCall).toBeDefined();
    expect(debugCall).toContain('[DEBUG]');
    expect(debugCall).toContain('[00:00:00.000]');

    const warnCall = console.warn.mock.calls.find((call) => call[0].includes('custom.warning'))?.[0];
    expect(warnCall).toBeDefined();
    expect(warnCall).toContain('[WARN');

    const infoCall = console.info.mock.calls.find((call) => call[0].includes('kernel.started'))?.[0];
    expect(infoCall).toBeDefined();
    expect(infoCall).toContain('[INFO');

    const errorCall = console.error.mock.calls.find((call) => call[0].includes('custom.error'))?.[0];
    expect(errorCall).toBeDefined();
    expect(errorCall).toContain('[ERROR');
  });

  it('sanitizes payloads and preserves boundary values', () => {
    const deepRaw = createDeepObject('deep-secret');
    const deepSanitized = createDeepObject('[REDACTED]');

    const payload = {
      token: 'secret-token',
      password: 'pw',
      tokenNull: null,
      tokenUndefined: undefined,
      emptyString: '',
      whitespace: '   ',
      zero: 0,
      negative: -1,
      max: Number.MAX_SAFE_INTEGER,
      nullValue: null,
      undefinedValue: undefined,
      emptyArray: [],
      emptyObject: {},
      array: [
        { apiKey: 'key-123', keep: 'ok' },
        null,
        '',
      ],
      arrayLike: { 0: 'zero', 1: 'one', length: 2 },
      nested: {
        privateField: 'hide-me',
        accessToken: undefined,
        child: { refreshToken: 'refresh', ok: true },
      },
      deep: deepRaw,
    };

    const { service, emitEvent } = setupLogger({
      sensitiveFields: ['privateField'],
      includeEventData: true,
      maxBuffer: 5,
    });

    emitEvent({ name: 'custom.event', payload });

    const buffer = service.getBuffer();
    expect(buffer).toHaveLength(1);
    expect(payload.token).toBe('secret-token');

    expect(buffer[0].data).toEqual({
      token: '[REDACTED]',
      password: '[REDACTED]',
      tokenNull: null,
      tokenUndefined: undefined,
      emptyString: '',
      whitespace: '   ',
      zero: 0,
      negative: -1,
      max: Number.MAX_SAFE_INTEGER,
      nullValue: null,
      undefinedValue: undefined,
      emptyArray: [],
      emptyObject: {},
      array: [
        { apiKey: '[REDACTED]', keep: 'ok' },
        null,
        '',
      ],
      arrayLike: { 0: 'zero', 1: 'one', length: 2 },
      nested: {
        privateField: '[REDACTED]',
        accessToken: undefined,
        child: { refreshToken: '[REDACTED]', ok: true },
      },
      deep: deepSanitized,
    });
  });

  it('logs state changes and handles empty or non-string event names', () => {
    const { service, emitEvent, emitState } = setupLogger({
      includeEventData: true,
      includeTimestamp: false,
      pretty: false,
      maxBuffer: 5,
    });

    emitEvent({ name: 123, payload: { ok: true } });
    emitState(null, undefined, '');

    const buffer = service.getBuffer();
    expect(buffer.some((entry) => entry.event === '')).toBe(true);
    expect(buffer.some((entry) => entry.event === 'state.change:')).toBe(true);

    const stateEntry = buffer.find((entry) => entry.event === 'state.change:');
    expect(stateEntry).toBeDefined();
    expect(stateEntry.data).toEqual({ old: undefined, new: null });
    expect(console.debug).toHaveBeenCalled();
  });

  it('handles JSON serialization errors with [circular] output', () => {
    const { service, emitEvent } = setupLogger({
      includeEventData: true,
      includeTimestamp: false,
      pretty: false,
      maxBuffer: 5,
    });

    emitEvent({ name: 'custom.event', payload: { value: BigInt(10) } });

    const buffer = service.getBuffer();
    expect(buffer).toHaveLength(1);
    expect(buffer[0].data).toEqual({ value: BigInt(10) });
    expect(console.debug).toHaveBeenCalledWith(expect.stringContaining('[circular]'));
  });

  it('filters logs below the configured level', () => {
    const { service, emitEvent } = setupLogger({
      level: 'warn',
      includeEventData: false,
      includeTimestamp: false,
      pretty: false,
      maxBuffer: 10,
    });

    emitEvent({ name: 'random.event', payload: { ok: true } });
    emitEvent({ name: 'kernel.started', payload: { ok: true } });
    emitEvent({ name: 'custom.warning', payload: { ok: true } });
    emitEvent({ name: 'custom.error', payload: { ok: true } });

    const buffer = service.getBuffer();
    expect(buffer.some((entry) => entry.event === 'random.event')).toBe(false);
    expect(buffer.some((entry) => entry.event === 'kernel.started')).toBe(false);
    expect(buffer.some((entry) => entry.event === 'custom.warning')).toBe(true);
    expect(buffer.some((entry) => entry.event === 'custom.error')).toBe(true);

    expect(console.debug).not.toHaveBeenCalled();
    expect(console.info).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalled();
    expect(console.error).toHaveBeenCalled();
  });

  it('disables buffering when maxBuffer is negative', () => {
    const { service, emitEvent } = setupLogger({
      maxBuffer: -1,
      includeEventData: false,
    });

    emitEvent({ name: 'random.event', payload: { ok: true } });

    expect(service.getBuffer()).toHaveLength(0);
    expect(console.debug).toHaveBeenCalled();
  });

  it('defaults maxBuffer for numeric string config and trims on bursts', async () => {
    const { service, emitEvent } = setupLogger({
      maxBuffer: '5',
      includeEventData: false,
      includeTimestamp: false,
      pretty: false,
    });

    const events = Array.from({ length: 210 }, (_, idx) => ({
      name: `event.${idx}`,
      payload: { idx },
    }));

    await Promise.all(events.map((evt) => Promise.resolve().then(() => emitEvent(evt))));

    const buffer = service.getBuffer();
    expect(buffer).toHaveLength(200);
    expect(buffer.some((entry) => entry.event === 'event.0')).toBe(false);
    expect(buffer.some((entry) => entry.event === 'event.209')).toBe(true);
  });

  it('truncates large payloads with numeric string maxDataLength', () => {
    const longText = 'x'.repeat(10000);
    const bigArray = Array.from({ length: 1000 }, (_, idx) => idx);

    const { emitEvent } = setupLogger({
      includeEventData: true,
      includeTimestamp: false,
      pretty: false,
      maxDataLength: '12',
      maxBuffer: 5,
    });

    emitEvent({ name: 'large.payload', payload: { text: longText, data: bigArray } });

    const output = console.debug.mock.calls[0][0];
    expect(output).toContain('...');
    expect(output.length).toBeLessThan(200);
    expect(output).not.toContain('x'.repeat(50));
  });
});
