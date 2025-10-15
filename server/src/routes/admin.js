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

export default router;
