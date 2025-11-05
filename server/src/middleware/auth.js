import jwt from 'jsonwebtoken';
import crypto from 'crypto';

/**
 * 获取 JWT 密钥
 * - 生产环境：必须设置 JWT_SECRET 环境变量
 * - 开发环境：如果未设置，会生成随机密钥并给出警告
 */
const getJwtSecret = () => {
  if (process.env.JWT_SECRET) {
    return process.env.JWT_SECRET;
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET must be set in production environment');
  }

  // 开发环境：生成随机密钥（每次启动会变化，但给出警告）
  const devSecret = 'dev-secret-' + crypto.randomBytes(16).toString('hex');
  console.warn('⚠️  Using auto-generated JWT_SECRET for development. Set JWT_SECRET env var for production.');
  return devSecret;
};

const JWT_SECRET = getJwtSecret();

export const requireAuth = (req, res, next) => {
  try {
    // 仅接受 Authorization 头，避免 CSRF 混淆
    const token = req.headers.authorization?.split(' ')[1];

    if (!token) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};

export const requireAdmin = (req, res, next) => {
  if (req.user?.role !== 'ADMIN') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
};

export const optionalAuth = (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];

    if (token) {
      const decoded = jwt.verify(token, JWT_SECRET);
      req.user = decoded;
    }
  } catch {
    // 忽略错误，继续处理
  }
  next();
};
