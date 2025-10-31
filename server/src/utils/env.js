// Runtime environment validation and access helpers
// Production should fail fast on missing critical envs.

const REQUIRED_IN_PROD = [
  'JWT_SECRET',
  'ENCRYPTION_SECRET',
];

const SUGGESTED_IN_PROD = [
  'DATABASE_URL', // DB 依赖功能需要
  'CORS_ORIGIN',  // 生产建议显式配置跨域白名单
  'UPLOAD_STORAGE', // 建议使用 disk
  'MAX_UPLOAD_SIZE',
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

  // 友好警告（非致命）
  const softMissing = SUGGESTED_IN_PROD.filter(k => !process.env[k]);
  if (softMissing.length) {
    // eslint-disable-next-line no-console
    console.warn(`⚠️  Suggested envs not set: ${softMissing.join(', ')}.`);
  }
}

export const env = {
  isProd: () => (process.env.NODE_ENV === 'production'),
  isTest: () => (process.env.NODE_ENV === 'test'),
};
