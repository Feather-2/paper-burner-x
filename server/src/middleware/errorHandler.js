import { AppError } from '../utils/errors.js';

/**
 * 统一错误处理中间件
 * 处理应用错误和未知错误
 */
export const errorHandler = (err, req, res, next) => {
  const isProduction = process.env.NODE_ENV === 'production';

  // 如果是 AppError，使用其状态码和消息
  if (err instanceof AppError) {
    console.error(`[AppError] ${err.statusCode} ${err.message}`);

    return res.status(err.statusCode).json({
      error: err.message,
      // 开发环境返回详细错误信息
      ...(isProduction ? {} : {
        stack: err.stack,
        ...(req.id && { requestId: req.id })
      })
    });
  }

  // Prisma 错误处理
  if (err.code && err.code.startsWith('P')) {
    console.error('[Prisma Error]', err);

    // 常见的 Prisma 错误
    if (err.code === 'P2002') {
      return res.status(409).json({
        error: 'Unique constraint violation',
        ...(isProduction ? {} : { details: err.meta })
      });
    }

    if (err.code === 'P2025') {
      return res.status(404).json({
        error: 'Record not found',
        ...(isProduction ? {} : { details: err.meta })
      });
    }
  }

  // 未知错误
  console.error('[Unknown Error]', err);

  const statusCode = err.statusCode || 500;
  const message = err.message || 'Internal Server Error';

  res.status(statusCode).json({
    error: message,
    // 明确检查生产环境：仅开发环境返回 stack trace
    ...(isProduction ? {} : {
      stack: err.stack,
      // 可以添加请求 ID 用于追踪（如果中间件添加了 req.id）
      ...(req.id && { requestId: req.id })
    })
  });
};
