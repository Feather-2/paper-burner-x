import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { prisma } from '../utils/prisma.js';
import { checkQuota, incrementDocumentCount, decrementDocumentCount, logUsage } from '../utils/quota.js';

const router = express.Router();

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
    // 检查配额
    const quotaCheck = await checkQuota(req.user.id);
    if (!quotaCheck.allowed) {
      return res.status(403).json({ error: quotaCheck.reason });
    }

    const document = await prisma.document.create({
      data: {
        userId: req.user.id,
        ...req.body
      }
    });

    // 增加文档计数
    await incrementDocumentCount(req.user.id, req.body.fileSize || 0);

    // 记录使用日志
    await logUsage(req.user.id, 'document_create', document.id, {
      fileName: document.fileName,
      fileType: document.fileType
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
    // 先获取文档信息以获取文件大小
    const document = await prisma.document.findFirst({
      where: {
        id: req.params.id,
        userId: req.user.id
      }
    });

    if (document) {
      await prisma.document.delete({
        where: { id: req.params.id }
      });

      // 减少文档计数
      await decrementDocumentCount(req.user.id, document.fileSize || 0);

      // 记录使用日志
      await logUsage(req.user.id, 'document_delete', req.params.id);
    }

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

// 更新标注
router.put('/:documentId/annotations/:annotationId', requireAuth, async (req, res, next) => {
  try {
    await prisma.annotation.updateMany({
      where: {
        id: req.params.annotationId,
        documentId: req.params.documentId,
        userId: req.user.id
      },
      data: req.body
    });

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// 删除标注
router.delete('/:documentId/annotations/:annotationId', requireAuth, async (req, res, next) => {
  try {
    await prisma.annotation.deleteMany({
      where: {
        id: req.params.annotationId,
        documentId: req.params.documentId,
        userId: req.user.id
      }
    });

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// 保存/更新意群数据
router.post('/:id/semantic-groups', requireAuth, async (req, res, next) => {
  try {
    const { groups, version, source } = req.body;

    // 验证文档所有权
    const document = await prisma.document.findFirst({
      where: {
        id: req.params.id,
        userId: req.user.id
      }
    });

    if (!document) {
      return res.status(404).json({ error: 'Document not found' });
    }

    const semanticGroup = await prisma.semanticGroup.upsert({
      where: {
        documentId: req.params.id
      },
      update: {
        groups,
        version,
        source
      },
      create: {
        documentId: req.params.id,
        groups,
        version,
        source
      }
    });

    res.json(semanticGroup);
  } catch (error) {
    next(error);
  }
});

// 获取意群数据
router.get('/:id/semantic-groups', requireAuth, async (req, res, next) => {
  try {
    // 验证文档所有权
    const document = await prisma.document.findFirst({
      where: {
        id: req.params.id,
        userId: req.user.id
      }
    });

    if (!document) {
      return res.status(404).json({ error: 'Document not found' });
    }

    const semanticGroup = await prisma.semanticGroup.findUnique({
      where: {
        documentId: req.params.id
      }
    });

    if (!semanticGroup) {
      return res.status(404).json({ error: 'Semantic groups not found' });
    }

    res.json(semanticGroup);
  } catch (error) {
    next(error);
  }
});

export default router;
