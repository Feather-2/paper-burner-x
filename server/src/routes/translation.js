import express from 'express';

const router = express.Router();

// 翻译路由暂时为空，可以根据需要添加翻译 API 代理

router.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'translation' });
});

export default router;
