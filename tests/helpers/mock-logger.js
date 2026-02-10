import { vi } from 'vitest';

/**
 * Creates a complete logger mock with all methods.
 * @returns {{ log: Function, debug: Function, info: Function, warn: Function, error: Function }}
 */
export function createMockLogger() {
  return {
    log: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

/**
 * Creates a vi.fn() that returns complete logger mocks.
 * Use in vi.mock() calls.
 * @returns {Function}
 */
export function createLoggerMock() {
  return vi.fn(() => createMockLogger());
}
