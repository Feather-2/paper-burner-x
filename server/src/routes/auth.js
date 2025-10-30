import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { prisma } from '../utils/prisma.js';
import { authLimiter } from '../middleware/rateLimit.js';
import { validateRegisterData } from '../utils/validation.js';
import { AppErrors, HTTP_STATUS } from '../utils/errors.js';
import { JWT, CRYPTO, ROLES } from '../utils/constants.js';

const router = express.Router();

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
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || JWT.DEFAULT_EXPIRES_IN;

// 注册
router.post('/register', authLimiter, async (req, res, next) => {
  try {
    const { email, password, name } = req.body;

    // 使用验证工具验证输入
    const validation = validateRegisterData({ email, password, name });
    if (!validation.valid) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        error: 'Validation failed',
        errors: validation.errors
      });
    }

    // 检查用户是否已存在
    const existingUser = await prisma.user.findUnique({
      where: { email }
    });

    if (existingUser) {
      throw AppErrors.conflict('User already exists');
    }

    // 密码加密
    const hashedPassword = await bcrypt.hash(password, CRYPTO.BCRYPT_ROUNDS);

    // 创建用户
    const user = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        name,
        role: ROLES.USER
      }
    });

    // 创建默认设置
    await prisma.userSettings.create({
      data: {
        userId: user.id
      }
    });

    // 生成 JWT
    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    res.status(HTTP_STATUS.CREATED).json({
      success: true,
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role
      }
    });

  } catch (error) {
    next(error);
  }
});

// 登录
router.post('/login', authLimiter, async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      throw AppErrors.validation('Email and password are required');
    }

    // 查找用户
    const user = await prisma.user.findUnique({
      where: { email }
    });

    if (!user) {
      throw AppErrors.unauthorized('Invalid credentials');
    }

    // 验证密码
    const isValidPassword = await bcrypt.compare(password, user.password);

    if (!isValidPassword) {
      throw AppErrors.unauthorized('Invalid credentials');
    }

    // 检查账户状态
    if (!user.isActive) {
      throw AppErrors.forbidden('Account is disabled');
    }

    // 生成 JWT
    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    res.status(HTTP_STATUS.OK).json({
      success: true,
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role
      }
    });

  } catch (error) {
    next(error);
  }
});

// 获取当前用户信息
router.get('/me', async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];

    if (!token) {
      throw AppErrors.unauthorized('Authentication required');
    }

    const decoded = jwt.verify(token, JWT_SECRET);

    const user = await prisma.user.findUnique({
      where: { id: decoded.id },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        createdAt: true
      }
    });

    if (!user) {
      throw AppErrors.notFound('User');
    }

    res.status(HTTP_STATUS.OK).json({ user });

  } catch (error) {
    next(error);
  }
});

export default router;
