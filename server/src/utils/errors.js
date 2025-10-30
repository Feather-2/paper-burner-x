/**
 * 应用错误类
 * 用于统一错误处理，支持 HTTP 状态码
 */
export class AppError extends Error {
  /**
   * @param {string} message - 错误消息
   * @param {number} statusCode - HTTP 状态码（默认 500）
   * @param {boolean} isOperational - 是否为操作错误（默认 true）
   */
  constructor(message, statusCode = 500, isOperational = true) {
    super(message);

    this.statusCode = statusCode;
    this.isOperational = isOperational;
    this.name = 'AppError';

    // 保持正确的堆栈跟踪
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * HTTP 状态码常量（用于导出）
 */
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

/**
 * 常用错误工厂函数
 */
export const AppErrors = {
  /**
   * 未找到资源错误
   */
  notFound: (resource = 'Resource') => {
    return new AppError(`${resource} not found`, HTTP_STATUS.NOT_FOUND);
  },

  /**
   * 未授权错误
   */
  unauthorized: (message = 'Unauthorized') => {
    return new AppError(message, HTTP_STATUS.UNAUTHORIZED);
  },

  /**
   * 禁止访问错误
   */
  forbidden: (message = 'Forbidden') => {
    return new AppError(message, HTTP_STATUS.FORBIDDEN);
  },

  /**
   * 验证错误
   */
  validation: (message = 'Validation failed') => {
    return new AppError(message, HTTP_STATUS.BAD_REQUEST);
  },

  /**
   * 冲突错误
   */
  conflict: (message = 'Resource conflict') => {
    return new AppError(message, HTTP_STATUS.CONFLICT);
  },

  /**
   * 内部服务器错误
   */
  internal: (message = 'Internal server error') => {
    return new AppError(message, HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }
};

