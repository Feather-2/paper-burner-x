import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { prisma } from '../utils/prisma.js';
import { AppErrors, HTTP_STATUS } from '../utils/errors.js';
import { validateUUID } from '../utils/validation.js';

const router = express.Router();

// 获取文档的所有引用
router.get('/:documentId/references', requireAuth, async (req, res, next) => {
  try {
    const { documentId } = req.params;

    // 验证 UUID 格式
    if (!validateUUID(documentId)) {
      throw AppErrors.validation('Invalid document ID format');
    }

    // 验证文档所有权
    const document = await prisma.document.findFirst({
      where: {
        id: documentId,
        userId: req.user.id
      }
    });

    if (!document) {
      throw AppErrors.notFound('Document');
    }

    const references = await prisma.reference.findMany({
      where: {
        documentId,
        userId: req.user.id
      },
      orderBy: { citationKey: 'asc' }
    });

    res.status(HTTP_STATUS.OK).json(references);
  } catch (error) {
    next(error);
  }
});

// 添加单个引用
router.post('/:documentId/references', requireAuth, async (req, res, next) => {
  try {
    const { documentId } = req.params;
    const { citationKey, doi, title, authors, year, journal, volume, pages, url, metadata } = req.body;

    // 验证 UUID 格式
    if (!validateUUID(documentId)) {
      throw AppErrors.validation('Invalid document ID format');
    }

    // 输入验证
    if (!citationKey || typeof citationKey !== 'string') {
      throw AppErrors.validation('citationKey is required');
    }

    // 限制字符串长度（防止过大的数据）
    const maxLength = 1000;
    if (citationKey.length > maxLength) {
      throw AppErrors.validation(`Citation key too long (max ${maxLength} characters)`);
    }

    // 验证文档所有权
    const document = await prisma.document.findFirst({
      where: {
        id: documentId,
        userId: req.user.id
      }
    });

    if (!document) {
      throw AppErrors.notFound('Document');
    }

    const reference = await prisma.reference.create({
      data: {
        documentId,
        userId: req.user.id,
        citationKey: citationKey.substring(0, maxLength),
        doi: doi ? String(doi).substring(0, maxLength) : null,
        title: title ? String(title).substring(0, maxLength * 2) : null,
        authors: authors ? String(authors).substring(0, maxLength * 2) : null,
        year: year ? parseInt(year) : null,
        journal: journal ? String(journal).substring(0, maxLength * 2) : null,
        volume: volume ? String(volume).substring(0, 100) : null,
        pages: pages ? String(pages).substring(0, 100) : null,
        url: url ? String(url).substring(0, maxLength * 2) : null,
        metadata
      }
    });

    res.status(HTTP_STATUS.CREATED).json(reference);
  } catch (error) {
    // 处理唯一性约束错误
    if (error.code === 'P2002') {
      throw AppErrors.conflict('Citation key already exists for this document');
    }
    next(error);
  }
});

// 批量添加引用（用于导入）
router.post('/:documentId/references/batch', requireAuth, async (req, res, next) => {
  try {
    const { documentId } = req.params;
    const { references } = req.body;

    // 验证 UUID 格式
    if (!validateUUID(documentId)) {
      throw AppErrors.validation('Invalid document ID format');
    }

    // 输入验证
    if (!Array.isArray(references)) {
      throw AppErrors.validation('references must be an array');
    }

    // 限制批量大小
    const maxBatchSize = 1000;
    if (references.length > maxBatchSize) {
      throw AppErrors.validation(`Batch size too large (max ${maxBatchSize} references)`);
    }

    // 验证文档所有权
    const document = await prisma.document.findFirst({
      where: {
        id: documentId,
        userId: req.user.id
      }
    });

    if (!document) {
      throw AppErrors.notFound('Document');
    }

    // 验证并清理引用数据
    const validReferences = references.filter(ref => {
      return ref && typeof ref === 'object' && ref.citationKey;
    });

    if (validReferences.length !== references.length) {
      throw AppErrors.validation('Some references have invalid format');
    }

    const createdReferences = await prisma.reference.createMany({
      data: validReferences.map(ref => ({
        documentId,
        userId: req.user.id,
        citationKey: String(ref.citationKey).substring(0, 1000),
        doi: ref.doi ? String(ref.doi).substring(0, 1000) : null,
        title: ref.title ? String(ref.title).substring(0, 2000) : null,
        authors: ref.authors ? String(ref.authors).substring(0, 2000) : null,
        year: ref.year ? parseInt(ref.year) : null,
        journal: ref.journal ? String(ref.journal).substring(0, 2000) : null,
        volume: ref.volume ? String(ref.volume).substring(0, 100) : null,
        pages: ref.pages ? String(ref.pages).substring(0, 100) : null,
        url: ref.url ? String(ref.url).substring(0, 2000) : null,
        metadata: ref.metadata
      })),
      skipDuplicates: true
    });

    res.status(HTTP_STATUS.CREATED).json({
      success: true,
      count: createdReferences.count
    });
  } catch (error) {
    next(error);
  }
});

// 更新引用
router.put('/:documentId/references/:refId', requireAuth, async (req, res, next) => {
  try {
    const { documentId, refId } = req.params;

    // 验证 UUID 格式
    if (!validateUUID(documentId) || !validateUUID(refId)) {
      throw AppErrors.validation('Invalid document or reference ID format');
    }

    // 验证引用所有权
    const reference = await prisma.reference.findFirst({
      where: {
        id: refId,
        documentId,
        userId: req.user.id
      }
    });

    if (!reference) {
      throw AppErrors.notFound('Reference');
    }

    const updated = await prisma.reference.update({
      where: { id: refId },
      data: req.body
    });

    res.status(HTTP_STATUS.OK).json(updated);
  } catch (error) {
    next(error);
  }
});

// 删除引用
router.delete('/:documentId/references/:refId', requireAuth, async (req, res, next) => {
  try {
    const { documentId, refId } = req.params;

    // 验证 UUID 格式
    if (!validateUUID(documentId) || !validateUUID(refId)) {
      throw AppErrors.validation('Invalid document or reference ID format');
    }

    await prisma.reference.deleteMany({
      where: {
        id: refId,
        documentId,
        userId: req.user.id
      }
    });

    res.status(HTTP_STATUS.OK).json({ success: true });
  } catch (error) {
    next(error);
  }
});

export default router;
