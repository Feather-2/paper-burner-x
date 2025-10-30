import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { prisma } from '../utils/prisma.js';

const router = express.Router();

// 获取文档的所有引用
router.get('/:documentId/references', requireAuth, async (req, res, next) => {
  try {
    const { documentId } = req.params;

    // 验证文档所有权
    const document = await prisma.document.findFirst({
      where: {
        id: documentId,
        userId: req.user.id
      }
    });

    if (!document) {
      return res.status(404).json({ error: 'Document not found' });
    }

    const references = await prisma.reference.findMany({
      where: {
        documentId,
        userId: req.user.id
      },
      orderBy: { citationKey: 'asc' }
    });

    res.json(references);
  } catch (error) {
    next(error);
  }
});

// 添加单个引用
router.post('/:documentId/references', requireAuth, async (req, res, next) => {
  try {
    const { documentId } = req.params;
    const { citationKey, doi, title, authors, year, journal, volume, pages, url, metadata } = req.body;

    if (!citationKey) {
      return res.status(400).json({ error: 'citationKey is required' });
    }

    // 验证文档所有权
    const document = await prisma.document.findFirst({
      where: {
        id: documentId,
        userId: req.user.id
      }
    });

    if (!document) {
      return res.status(404).json({ error: 'Document not found' });
    }

    const reference = await prisma.reference.create({
      data: {
        documentId,
        userId: req.user.id,
        citationKey,
        doi,
        title,
        authors,
        year,
        journal,
        volume,
        pages,
        url,
        metadata
      }
    });

    res.status(201).json(reference);
  } catch (error) {
    // 处理唯一性约束错误
    if (error.code === 'P2002') {
      return res.status(409).json({ error: 'Citation key already exists for this document' });
    }
    next(error);
  }
});

// 批量添加引用（用于导入）
router.post('/:documentId/references/batch', requireAuth, async (req, res, next) => {
  try {
    const { documentId } = req.params;
    const { references } = req.body;

    if (!Array.isArray(references)) {
      return res.status(400).json({ error: 'references must be an array' });
    }

    // 验证文档所有权
    const document = await prisma.document.findFirst({
      where: {
        id: documentId,
        userId: req.user.id
      }
    });

    if (!document) {
      return res.status(404).json({ error: 'Document not found' });
    }

    const createdReferences = await prisma.reference.createMany({
      data: references.map(ref => ({
        documentId,
        userId: req.user.id,
        citationKey: ref.citationKey,
        doi: ref.doi,
        title: ref.title,
        authors: ref.authors,
        year: ref.year,
        journal: ref.journal,
        volume: ref.volume,
        pages: ref.pages,
        url: ref.url,
        metadata: ref.metadata
      })),
      skipDuplicates: true
    });

    res.status(201).json({
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

    // 验证引用所有权
    const reference = await prisma.reference.findFirst({
      where: {
        id: refId,
        documentId,
        userId: req.user.id
      }
    });

    if (!reference) {
      return res.status(404).json({ error: 'Reference not found' });
    }

    const updated = await prisma.reference.update({
      where: { id: refId },
      data: req.body
    });

    res.json(updated);
  } catch (error) {
    next(error);
  }
});

// 删除引用
router.delete('/:documentId/references/:refId', requireAuth, async (req, res, next) => {
  try {
    const { documentId, refId } = req.params;

    await prisma.reference.deleteMany({
      where: {
        id: refId,
        documentId,
        userId: req.user.id
      }
    });

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

export default router;
