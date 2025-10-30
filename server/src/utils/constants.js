/**
 * 应用常量定义
 * 集中管理魔法数字和字符串
 */

// ==================== HTTP 相关 ====================

export const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INTERNAL_SERVER_ERROR: 500
};

// ==================== 分页相关 ====================

export const PAGINATION = {
  DEFAULT_PAGE: 1,
  DEFAULT_LIMIT: 20,
  MAX_LIMIT: 100
};

// ==================== 文件上传相关 ====================

export const FILE_UPLOAD = {
  MAX_SIZE_MB: 100,
  MAX_SIZE_BYTES: 100 * 1024 * 1024, // 100MB
  DEFAULT_MAX_SIZE_MB: 100
};

// ==================== 验证相关 ====================

export const VALIDATION = {
  PASSWORD_MIN_LENGTH: 8,
  PASSWORD_MAX_LENGTH: 100,
  EMAIL_MAX_LENGTH: 255,
  NAME_MAX_LENGTH: 100
};

// ==================== JWT 相关 ====================

export const JWT = {
  DEFAULT_EXPIRES_IN: '7d',
  EXPIRES_IN_OPTIONS: ['1h', '7d', '30d', '90d']
};

// ==================== 加密相关 ====================

export const CRYPTO = {
  BCRYPT_ROUNDS: 10,
  PBKDF2_ITERATIONS: 100000,
  KEY_LENGTH: 32,
  IV_LENGTH: 16,
  SALT_LENGTH: 64,
  TAG_LENGTH: 16
};

// ==================== 配额相关 ====================

export const QUOTA = {
  DEFAULT_DOCUMENT_LIMIT: 100,
  DEFAULT_STORAGE_LIMIT_MB: 1000
};

// ==================== 角色相关 ====================

export const ROLES = {
  USER: 'USER',
  ADMIN: 'ADMIN'
};

// ==================== 部署模式相关 ====================

export const DEPLOYMENT_MODE = {
  FRONTEND: 'frontend',
  BACKEND: 'backend'
};

