import rateLimit from 'express-rate-limit';

// 登录/注册等鉴权接口限流（按 IP）
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // limit each IP to 10 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});

// 管理端写操作限流（按 IP）
export const adminWriteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});

// OCR 高成本接口限流（IP + 用户维度）
export function createOcrLimiter({ windowMs = 60 * 1000, maxPerIp = 30, maxPerUser = 30 } = {}) {
  const ipLimiter = rateLimit({
    windowMs,
    max: maxPerIp,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many OCR requests from this IP, slow down.' },
    keyGenerator: (req) => req.ip,
  });

  const userLimiter = rateLimit({
    windowMs,
    max: maxPerUser,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many OCR requests from this user, slow down.' },
    keyGenerator: (req) => req.user?.id || 'anonymous',
  });

  return [ipLimiter, userLimiter];
}
