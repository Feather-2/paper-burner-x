import express from 'express';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { PrismaClient } from '@prisma/client';

const router = express.Router();
const prisma = new PrismaClient();

// 所有管理员路由都需要管理员权限
router.use(requireAuth, requireAdmin);

// 获取所有用户
router.get('/users', async (req, res, next) => {
  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isActive: true,
        createdAt: true
      },
      orderBy: { createdAt: 'desc' }
    });

    res.json(users);
  } catch (error) {
    next(error);
  }
});

// 更新用户状态
router.put('/users/:id/status', async (req, res, next) => {
  try {
    const { isActive } = req.body;

    await prisma.user.update({
      where: { id: req.params.id },
      data: { isActive }
    });

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
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

// 获取系统配置
router.get('/config', async (req, res, next) => {
  try {
    const configs = await prisma.systemConfig.findMany();

    const configMap = {};
    configs.forEach(c => {
      configMap[c.key] = c.value;
    });

    res.json(configMap);
  } catch (error) {
    next(error);
  }
});

// 更新系统配置
router.put('/config', async (req, res, next) => {
  try {
    const { key, value, description } = req.body;

    await prisma.systemConfig.upsert({
      where: { key },
      update: { value, description },
      create: { key, value, description }
    });

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

router.post('/source-sites', async (req, res, next) => {
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

router.put('/source-sites/:id', async (req, res, next) => {
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

router.delete('/source-sites/:id', async (req, res, next) => {
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
