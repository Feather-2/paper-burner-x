import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { prisma } from '../utils/prisma.js';
import { checkQuota, incrementDocumentCount, decrementDocumentCount, logUsage } from '../utils/quota.js';
import { AppErrors, HTTP_STATUS } from '../utils/errors.js';
import { PAGINATION } from '../utils/constants.js';
import { validateUUID } from '../utils/validation.js';

const router = express.Router();

// 允许的状态值白名单
const ALLOWED_STATUSES = ['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED'];

// 获取文档列表
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const { page = PAGINATION.DEFAULT_PAGE, limit = PAGINATION.DEFAULT_LIMIT, status } = req.query;

    const where = {
      userId: req.user.id,
      ...(status && ALLOWED_STATUSES.includes(status) && { status })
    };

    const pageNum = Math.max(parseInt(page) || PAGINATION.DEFAULT_PAGE, 1);
    const limitNum = Math.min(Math.max(parseInt(limit) || PAGINATION.DEFAULT_LIMIT, 1), PAGINATION.MAX_LIMIT);

    const documents = await prisma.document.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (pageNum - 1) * limitNum,
      take: limitNum,
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

    res.status(HTTP_STATUS.OK).json({
      documents,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum)
      }
    });
  } catch (error) {
    next(error);
  }
});

// 获取单个文档详情
router.get('/:id', requireAuth, async (req, res, next) => {
  try {
    // 验证 UUID 格式
    if (!validateUUID(req.params.id)) {
      throw AppErrors.validation('Invalid document ID format');
    }

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
      throw AppErrors.notFound('Document');
    }

    res.status(HTTP_STATUS.OK).json(document);
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
      throw AppErrors.forbidden(quotaCheck.reason);
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

    res.status(HTTP_STATUS.CREATED).json(document);
  } catch (error) {
    next(error);
  }
});

// 更新文档
router.put('/:id', requireAuth, async (req, res, next) => {
  try {
    // 验证 UUID 格式
    if (!validateUUID(req.params.id)) {
      throw AppErrors.validation('Invalid document ID format');
    }

    await prisma.document.updateMany({
      where: {
        id: req.params.id,
        userId: req.user.id
      },
      data: req.body
    });

    res.status(HTTP_STATUS.OK).json({ success: true });
  } catch (error) {
    next(error);
  }
});

// 删除文档
router.delete('/:id', requireAuth, async (req, res, next) => {
  try {
    // 验证 UUID 格式
    if (!validateUUID(req.params.id)) {
      throw AppErrors.validation('Invalid document ID format');
    }

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

    res.status(HTTP_STATUS.OK).json({ success: true });
  } catch (error) {
    next(error);
  }
});

// 保存标注
router.post('/:id/annotations', requireAuth, async (req, res, next) => {
  try {
    // 验证 UUID 格式
    if (!validateUUID(req.params.id)) {
      throw AppErrors.validation('Invalid document ID format');
    }

    const annotation = await prisma.annotation.create({
      data: {
        userId: req.user.id,
        documentId: req.params.id,
        ...req.body
      }
    });

    res.status(HTTP_STATUS.CREATED).json(annotation);
  } catch (error) {
    next(error);
  }
});

// 获取文档的所有标注
router.get('/:id/annotations', requireAuth, async (req, res, next) => {
  try {
    // 验证 UUID 格式
    if (!validateUUID(req.params.id)) {
      throw AppErrors.validation('Invalid document ID format');
    }

    const annotations = await prisma.annotation.findMany({
      where: {
        documentId: req.params.id,
        userId: req.user.id
      }
    });

    res.status(HTTP_STATUS.OK).json(annotations);
  } catch (error) {
    next(error);
  }
});

// 更新标注
router.put('/:documentId/annotations/:annotationId', requireAuth, async (req, res, next) => {
  try {
    // 验证 UUID 格式
    if (!validateUUID(req.params.documentId) || !validateUUID(req.params.annotationId)) {
      throw AppErrors.validation('Invalid document or annotation ID format');
    }

    await prisma.annotation.updateMany({
      where: {
        id: req.params.annotationId,
        documentId: req.params.documentId,
        userId: req.user.id
      },
      data: req.body
    });

    res.status(HTTP_STATUS.OK).json({ success: true });
  } catch (error) {
    next(error);
  }
});

// 删除标注
router.delete('/:documentId/annotations/:annotationId', requireAuth, async (req, res, next) => {
  try {
    // 验证 UUID 格式
    if (!validateUUID(req.params.documentId) || !validateUUID(req.params.annotationId)) {
      throw AppErrors.validation('Invalid document or annotation ID format');
    }

    await prisma.annotation.deleteMany({
      where: {
        id: req.params.annotationId,
        documentId: req.params.documentId,
        userId: req.user.id
      }
    });

    res.status(HTTP_STATUS.OK).json({ success: true });
  } catch (error) {
    next(error);
  }
});

// 保存/更新意群数据
router.post('/:id/semantic-groups', requireAuth, async (req, res, next) => {
  try {
    // 验证 UUID 格式
    if (!validateUUID(req.params.id)) {
      throw AppErrors.validation('Invalid document ID format');
    }

    const { groups, version, source } = req.body;

    // 验证文档所有权
    const document = await prisma.document.findFirst({
      where: {
        id: req.params.id,
        userId: req.user.id
      }
    });

    if (!document) {
      throw AppErrors.notFound('Document');
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

    res.status(HTTP_STATUS.OK).json(semanticGroup);
  } catch (error) {
    next(error);
  }
});

// 获取意群数据
router.get('/:id/semantic-groups', requireAuth, async (req, res, next) => {
  try {
    // 验证 UUID 格式
    if (!validateUUID(req.params.id)) {
      throw AppErrors.validation('Invalid document ID format');
    }

    // 验证文档所有权
    const document = await prisma.document.findFirst({
      where: {
        id: req.params.id,
        userId: req.user.id
      }
    });

    if (!document) {
      throw AppErrors.notFound('Document');
    }

    const semanticGroup = await prisma.semanticGroup.findUnique({
      where: {
        documentId: req.params.id
      }
    });

    if (!semanticGroup) {
      throw AppErrors.notFound('Semantic groups');
    }

    res.status(HTTP_STATUS.OK).json(semanticGroup);
  } catch (error) {
    next(error);
  }
});

export default router;
