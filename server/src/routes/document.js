import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { PrismaClient } from '@prisma/client';

const router = express.Router();
const prisma = new PrismaClient();

// 获取文档列表
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const { page = 1, limit = 20, status } = req.query;

    const where = {
      userId: req.user.id,
      ...(status && { status })
    };

    const documents = await prisma.document.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: parseInt(limit),
      select: {
        id: true,
        fileName: true,
        fileType: true,
        status: true,
        ocrProvider: true,
        translationModel: true,
        processingTime: true,
        createdAt: true
      }
    });

    const total = await prisma.document.count({ where });

    res.json({
      documents,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    next(error);
  }
});

// 获取单个文档详情
router.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const document = await prisma.document.findFirst({
      where: {
        id: req.params.id,
        userId: req.user.id
      },
      include: {
        annotations: true,
        semanticGroups: true
      }
    });

    if (!document) {
      return res.status(404).json({ error: 'Document not found' });
    }

    res.json(document);
  } catch (error) {
    next(error);
  }
});

// 创建文档记录
router.post('/', requireAuth, async (req, res, next) => {
  try {
    const document = await prisma.document.create({
      data: {
        userId: req.user.id,
        ...req.body
      }
    });

    res.status(201).json(document);
  } catch (error) {
    next(error);
  }
});

// 更新文档
router.put('/:id', requireAuth, async (req, res, next) => {
  try {
    const document = await prisma.document.updateMany({
      where: {
        id: req.params.id,
        userId: req.user.id
      },
      data: req.body
    });

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// 删除文档
router.delete('/:id', requireAuth, async (req, res, next) => {
  try {
    await prisma.document.deleteMany({
      where: {
        id: req.params.id,
        userId: req.user.id
      }
    });

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// 保存标注
router.post('/:id/annotations', requireAuth, async (req, res, next) => {
  try {
    const annotation = await prisma.annotation.create({
      data: {
        userId: req.user.id,
        documentId: req.params.id,
        ...req.body
      }
    });

    res.status(201).json(annotation);
  } catch (error) {
    next(error);
  }
});

// 获取文档的所有标注
router.get('/:id/annotations', requireAuth, async (req, res, next) => {
  try {
    const annotations = await prisma.annotation.findMany({
      where: {
        documentId: req.params.id,
        userId: req.user.id
      }
    });

    res.json(annotations);
  } catch (error) {
    next(error);
  }
});

export default router;
