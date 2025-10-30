export const errorHandler = (err, req, res, next) => {
  const isProduction = process.env.NODE_ENV === 'production';

  console.error('Error:', err);

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
