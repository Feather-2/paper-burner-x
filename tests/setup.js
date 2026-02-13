/**
 * Global test setup file for Vitest
 * Adds global afterEach cleanup to prevent test pollution
 */
import { afterEach, vi } from 'vitest';

// Global afterEach hook to clean up after every test
afterEach(() => {
  // Clear all mocks to prevent state pollution between tests
  vi.clearAllMocks();

  // Clear all timers to prevent timer leaks
  vi.clearAllTimers();

  // Restore real timers if fake timers were used
  vi.useRealTimers();
});
