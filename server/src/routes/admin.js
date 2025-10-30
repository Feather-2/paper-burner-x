import express from 'express';
import bcrypt from 'bcryptjs';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { adminWriteLimiter } from '../middleware/rateLimit.js';
import { PrismaClient } from '@prisma/client';

const router = express.Router();
const prisma = new PrismaClient();

// 所有管理员路由都需要管理员权限
router.use(requireAuth, requireAdmin);

// 获取所有用户
router.get('/users', async (req, res, next) => {
  try {
    const { page = 1, pageSize = 20, search = '', sort = 'createdAt', order = 'desc' } = req.query;
    const p = Math.max(parseInt(page), 1);
    const ps = Math.min(Math.max(parseInt(pageSize), 1), 100);
    const where = search
      ? {
          OR: [
            { email: { contains: String(search), mode: 'insensitive' } },
            { name: { contains: String(search), mode: 'insensitive' } }
          ]
        }
      : {};

    const [total, items] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        select: { id: true, email: true, name: true, role: true, isActive: true, createdAt: true },
        orderBy: { [String(sort)]: String(order).toLowerCase() === 'asc' ? 'asc' : 'desc' },
        skip: (p - 1) * ps,
        take: ps
      })
    ]);

    res.json({ total, page: p, pageSize: ps, items });
  } catch (error) {
    next(error);
  }
});

// 创建用户（管理员）
router.post('/users', adminWriteLimiter, async (req, res, next) => {
  try {
    const { email, name = '', role = 'USER', password } = req.body || {};
    if (!email || typeof email !== 'string') return res.status(400).json({ error: 'email is required' });
    if (!['USER', 'ADMIN'].includes(role)) return res.status(400).json({ error: 'invalid role' });
    const pwd = typeof password === 'string' && password.length >= 8 ? password : Math.random().toString(36).slice(2, 10) + 'A1!';

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) return res.status(409).json({ error: 'User already exists' });

    const hashed = await bcrypt.hash(pwd, 10);
    const user = await prisma.user.create({
      data: { email, name, role, password: hashed, isActive: true }
    });
    await prisma.userSettings.create({ data: { userId: user.id } });

    try { await prisma.usageLog.create({ data: { userId: req.user.id, action: 'admin_create_user', resourceId: user.id, metadata: { email, role } } }); } catch {}

    res.status(201).json({ id: user.id, email: user.email, name: user.name, role: user.role, isActive: user.isActive, tempPassword: password ? undefined : pwd });
  } catch (error) { next(error); }
});

// 编辑用户（邮箱/姓名/角色）
router.put('/users/:id', adminWriteLimiter, async (req, res, next) => {
  try {
    const { email, name, role } = req.body || {};
    const userId = req.params.id;

    const target = await prisma.user.findUnique({ where: { id: userId } });
    if (!target) return res.status(404).json({ error: 'User not found' });

    if (role && role !== 'ADMIN' && target.role === 'ADMIN') {
      const adminCount = await prisma.user.count({ where: { role: 'ADMIN', isActive: true } });
      if (adminCount <= 1) return res.status(400).json({ error: 'Cannot demote the last active admin' });
    }

    const data = {};
    if (typeof email === 'string' && email) data.email = email;
    if (typeof name === 'string') data.name = name;
    if (role && ['USER', 'ADMIN'].includes(role)) data.role = role;

    if (Object.keys(data).length === 0) return res.json({ success: true });

    await prisma.user.update({ where: { id: userId }, data });
    try { await prisma.usageLog.create({ data: { userId: req.user.id, action: 'admin_update_user', resourceId: userId, metadata: data } }); } catch {}
    res.json({ success: true });
  } catch (error) { next(error); }
});

// 更新用户状态
router.put('/users/:id/status', adminWriteLimiter, async (req, res, next) => {
  try {
    const { isActive } = req.body;
    const userId = req.params.id;
    const target = await prisma.user.findUnique({ where: { id: userId } });
    if (!target) return res.status(404).json({ error: 'User not found' });

    if (target.role === 'ADMIN' && isActive === false) {
      const adminCount = await prisma.user.count({ where: { role: 'ADMIN', isActive: true } });
      if (adminCount <= 1) return res.status(400).json({ error: 'Cannot disable the last active admin' });
    }

    await prisma.user.update({ where: { id: userId }, data: { isActive: !!isActive } });
    try { await prisma.usageLog.create({ data: { userId: req.user.id, action: 'admin_update_user_status', resourceId: userId, metadata: { isActive: !!isActive } } }); } catch {}
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// 重置用户密码
router.put('/users/:id/password', adminWriteLimiter, async (req, res, next) => {
  try {
    const userId = req.params.id;
    const { password } = req.body || {};
    if (typeof password !== 'string' || password.length < 8) return res.status(400).json({ error: 'password (>=8 chars) required' });
    const hashed = await bcrypt.hash(password, 10);
    await prisma.user.update({ where: { id: userId }, data: { password: hashed } });
    try { await prisma.usageLog.create({ data: { userId: req.user.id, action: 'admin_reset_password', resourceId: userId } }); } catch {}
    res.json({ success: true });
  } catch (error) { next(error); }
});

// 删除用户（保护最后一个管理员）
router.delete('/users/:id', adminWriteLimiter, async (req, res, next) => {
  try {
    const userId = req.params.id;
    const target = await prisma.user.findUnique({ where: { id: userId } });
    if (!target) return res.status(404).json({ error: 'User not found' });
    if (target.role === 'ADMIN') {
      const adminCount = await prisma.user.count({ where: { role: 'ADMIN', isActive: true } });
      if (adminCount <= 1) return res.status(400).json({ error: 'Cannot delete the last active admin' });
    }
    await prisma.user.delete({ where: { id: userId } });
    try { await prisma.usageLog.create({ data: { userId: req.user.id, action: 'admin_delete_user', resourceId: userId } }); } catch {}
    res.json({ success: true });
  } catch (error) { next(error); }
});

// 获取系统统计
router.get('/stats', async (req, res, next) => {
  try {
    const [
      totalUsers,
      totalDocuments,
      documentsToday,
      activeUsers
    ] = await Promise.all([
      prisma.user.count(),
      prisma.document.count(),
      prisma.document.count({
        where: {
          createdAt: {
            gte: new Date(new Date().setHours(0, 0, 0, 0))
          }
        }
      }),
      prisma.user.count({
        where: { isActive: true }
      })
    ]);

    res.json({
      totalUsers,
      totalDocuments,
      documentsToday,
      activeUsers
    });
  } catch (error) {
    next(error);
  }
});

// 获取系统配置（敏感掩码）
router.get('/config', async (req, res, next) => {
  try {
    const configs = await prisma.systemConfig.findMany();
    const sensitiveKeys = new Set(['JWT_SECRET', 'ENCRYPTION_SECRET']);
    const configMap = {};
    configs.forEach(c => { configMap[c.key] = sensitiveKeys.has(c.key) ? '********' : c.value; });
    res.json(configMap);
  } catch (error) {
    next(error);
  }
});

// 更新系统配置（白名单）
router.put('/config', adminWriteLimiter, async (req, res, next) => {
  try {
    const { key, value, description } = req.body || {};
    const allowList = new Set(['SITE_NAME','ALLOW_REGISTRATION','MAX_UPLOAD_SIZE_MB','ENFORCE_2FA','FRONTEND_CDN_MODE']);
    if (!key || !allowList.has(key)) return res.status(400).json({ error: 'Invalid config key' });
    await prisma.systemConfig.upsert({
      where: { key },
      update: { value, description },
      create: { key, value, description }
    });
    try { await prisma.usageLog.create({ data: { userId: req.user.id, action: 'admin_update_config', resourceId: key, metadata: { valueChanged: true } } }); } catch {}
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// 全局自定义源站管理
router.get('/source-sites', async (req, res, next) => {
  try {
    const sites = await prisma.customSourceSite.findMany({
      where: { userId: null } // 全局配置
    });

    res.json(sites);
  } catch (error) {
    next(error);
  }
});

router.post('/source-sites', adminWriteLimiter, async (req, res, next) => {
  try {
    const site = await prisma.customSourceSite.create({
      data: {
        userId: null, // 全局配置
        ...req.body
      }
    });

    res.status(201).json(site);
  } catch (error) {
    next(error);
  }
});

router.put('/source-sites/:id', adminWriteLimiter, async (req, res, next) => {
  try {
    await prisma.customSourceSite.update({
      where: { id: req.params.id },
      data: req.body
    });

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

router.delete('/source-sites/:id', adminWriteLimiter, async (req, res, next) => {
  try {
    await prisma.customSourceSite.delete({
      where: { id: req.params.id }
    });

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// ==================== 用户配额管理 ====================

// 获取用户配额
router.get('/users/:userId/quota', async (req, res, next) => {
  try {
    let quota = await prisma.userQuota.findUnique({
      where: { userId: req.params.userId }
    });

    if (!quota) {
      // 创建默认配额
      quota = await prisma.userQuota.create({
        data: { userId: req.params.userId }
      });
    }

    res.json(quota);
  } catch (error) {
    next(error);
  }
});

// 更新用户配额
router.put('/users/:userId/quota', async (req, res, next) => {
  try {
    const quota = await prisma.userQuota.upsert({
      where: { userId: req.params.userId },
      update: req.body,
      create: {
        userId: req.params.userId,
        ...req.body
      }
    });

    res.json(quota);
  } catch (error) {
    next(error);
  }
});

// ==================== 高级统计 ====================

// 获取详细的系统统计
router.get('/stats/detailed', async (req, res, next) => {
  try {
    const { startDate, endDate } = req.query;

    // 基础统计
    const [
      totalUsers,
      activeUsers,
      totalDocuments,
      totalStorage,
      documentsToday,
      documentsThisWeek,
      documentsThisMonth
    ] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { isActive: true } }),
      prisma.document.count(),
      prisma.document.aggregate({
        _sum: { fileSize: true }
      }),
      prisma.document.count({
        where: {
          createdAt: {
            gte: new Date(new Date().setHours(0, 0, 0, 0))
          }
        }
      }),
      prisma.document.count({
        where: {
          createdAt: {
            gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
          }
        }
      }),
      prisma.document.count({
        where: {
          createdAt: {
            gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1)
          }
        }
      })
    ]);

    // 按状态统计文档
    const documentsByStatus = await prisma.document.groupBy({
      by: ['status'],
      _count: true
    });

    // 最活跃的用户（本月）
    const topUsers = await prisma.document.groupBy({
      by: ['userId'],
      _count: true,
      where: {
        createdAt: {
          gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1)
        }
      },
      orderBy: {
        _count: {
          userId: 'desc'
        }
      },
      take: 10
    });

    // 获取用户详细信息
    const topUsersDetails = await Promise.all(
      topUsers.map(async (u) => {
        const user = await prisma.user.findUnique({
          where: { id: u.userId },
          select: { id: true, email: true, name: true }
        });
        return {
          ...user,
          documentCount: u._count
        };
      })
    );

    res.json({
      basic: {
        totalUsers,
        activeUsers,
        totalDocuments,
        totalStorageMB: Math.round((totalStorage._sum.fileSize || 0) / 1024 / 1024),
        documentsToday,
        documentsThisWeek,
        documentsThisMonth
      },
      documentsByStatus: documentsByStatus.map(d => ({
        status: d.status,
        count: d._count
      })),
      topUsers: topUsersDetails
    });
  } catch (error) {
    next(error);
  }
});

// 获取使用趋势
router.get('/stats/trends', async (req, res, next) => {
  try {
    const { days = 30 } = req.query;
    const startDate = new Date(Date.now() - parseInt(days) * 24 * 60 * 60 * 1000);

    // 按天统计文档创建数
    const documents = await prisma.document.findMany({
      where: {
        createdAt: { gte: startDate }
      },
      select: {
        createdAt: true,
        status: true
      }
    });

    // 按天分组
    const trendMap = {};
    documents.forEach(doc => {
      const date = doc.createdAt.toISOString().split('T')[0];
      if (!trendMap[date]) {
        trendMap[date] = { date, total: 0, completed: 0, failed: 0 };
      }
      trendMap[date].total++;
      if (doc.status === 'COMPLETED') trendMap[date].completed++;
      if (doc.status === 'FAILED') trendMap[date].failed++;
    });

    const trends = Object.values(trendMap).sort((a, b) =>
      new Date(a.date) - new Date(b.date)
    );

    res.json(trends);
  } catch (error) {
    next(error);
  }
});

// 用户活动日志
router.get('/users/:userId/activity', async (req, res, next) => {
  try {
    const { limit = 50, offset = 0 } = req.query;

    const logs = await prisma.usageLog.findMany({
      where: { userId: req.params.userId },
      orderBy: { createdAt: 'desc' },
      take: parseInt(limit),
      skip: parseInt(offset)
    });

    res.json(logs);
  } catch (error) {
    next(error);
  }
});

export default router;
