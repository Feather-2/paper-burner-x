// Runtime environment validation and access helpers
// Production should fail fast on missing critical envs.

const REQUIRED_IN_PROD = [
  'JWT_SECRET',
  'ENCRYPTION_SECRET',
  // DATABASE_URL is required for DB-backed features; server can boot without connecting,
  // but migrations/runtime require it. We warn if missing.
];

export function validateEnv() {
  const nodeEnv = process.env.NODE_ENV || 'development';
  const isProd = nodeEnv === 'production';

  const missing = [];
  if (isProd) {
    for (const key of REQUIRED_IN_PROD) {
      if (!process.env[key] || String(process.env[key]).trim() === '') missing.push(key);
    }
  }

  if (missing.length) {
    const msg = `Missing required environment variables in production: ${missing.join(', ')}`;
    // Fail fast in production
    throw new Error(msg);
  }

  if (!process.env.DATABASE_URL) {
    // Non-fatal warning: helpful in dev/test; CI sets it when needed.
    // eslint-disable-next-line no-console
    console.warn('⚠️  DATABASE_URL not set. DB features and migrations will not work until provided.');
  }
}

export const env = {
  isProd: () => (process.env.NODE_ENV === 'production'),
  isTest: () => (process.env.NODE_ENV === 'test'),
};
