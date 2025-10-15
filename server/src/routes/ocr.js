import express from 'express';
import fetch from 'node-fetch';

const router = express.Router();

const MINERU_BASE_URL = 'https://mineru.net/api/v4';
const DOC2X_BASE_URL = 'https://v2.doc2x.noedgeai.com';

// ==================== Helper Functions ====================

function getToken(req, service) {
  // 优先从请求头获取
  const headerKey = service === 'MINERU' ? 'x-mineru-key' : 'x-doc2x-key';
  let token = req.headers[headerKey];

  // 如果没有，从环境变量获取
  if (!token) {
    const envKey = service === 'MINERU' ? 'MINERU_API_TOKEN' : 'DOC2X_API_TOKEN';
    token = process.env[envKey];
  }

  // 清理可能的 Bearer 前缀
  if (token) {
    token = token.replace(/^Bearer\s+/i, '').trim();
  }

  return token || null;
}

// ==================== MinerU Routes ====================

// MinerU 文件上传
router.post('/mineru/upload', async (req, res, next) => {
  try {
    // 文件从 multer 中间件获取
    const file = req.file;

    if (!file) {
      return res.status(400).json({ error: 'No file provided' });
    }

    const token = getToken(req, 'MINERU');
    if (!token) {
      return res.status(401).json({
        error: 'MinerU API Token required. Provide via X-MinerU-Key header or MINERU_API_TOKEN env variable'
      });
    }

    const isOcr = req.body.is_ocr !== 'false';
    const enableFormula = req.body.enable_formula !== 'false';
    const enableTable = req.body.enable_table !== 'false';
    const language = req.body.language || 'ch';

    // 申请上传链接
    const uploadUrlResponse = await fetch(`${MINERU_BASE_URL}/file-urls/batch`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        enable_formula: enableFormula,
        enable_table: enableTable,
        language: language,
        files: [{
          name: file.originalname,
          is_ocr: isOcr,
          ...(req.body.data_id && { data_id: req.body.data_id }),
          ...(req.body.page_ranges && { page_ranges: req.body.page_ranges }),
        }],
      }),
    });

    if (!uploadUrlResponse.ok) {
      throw new Error(`MinerU申请上传链接失败: ${await uploadUrlResponse.text()}`);
    }

    const uploadData = await uploadUrlResponse.json();

    if (uploadData.code !== 0) {
      throw new Error(`MinerU返回错误: ${uploadData.msg}`);
    }

    // 上传文件到 OSS
    const ossUploadUrl = uploadData.data.file_urls[0];

    const ossUploadResponse = await fetch(ossUploadUrl, {
      method: 'PUT',
      body: file.buffer,
    });

    if (!ossUploadResponse.ok) {
      throw new Error(`OSS上传失败: ${ossUploadResponse.status} ${ossUploadResponse.statusText}`);
    }

    res.json({
      success: true,
      batch_id: uploadData.data.batch_id,
      file_name: file.originalname,
      service: 'mineru'
    });

  } catch (error) {
    next(error);
  }
});

// MinerU 获取结果
router.get('/mineru/result/:batchId', async (req, res, next) => {
  try {
    const { batchId } = req.params;

    if (!batchId) {
      return res.status(400).json({ error: 'batch_id is required' });
    }

    // 健康检查
    if (batchId === '__health__') {
      const token = getToken(req, 'MINERU');
      if (!token) {
        return res.status(401).json({
          error: 'MinerU API Token required'
        });
      }
      return res.json({ success: true, service: 'mineru', health: true, timestamp: Date.now() });
    }

    const token = getToken(req, 'MINERU');
    if (!token) {
      return res.status(401).json({
        error: 'MinerU API Token required'
      });
    }

    const resultResponse = await fetch(`${MINERU_BASE_URL}/extract-results/batch/${batchId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
      },
    });

    if (!resultResponse.ok) {
      throw new Error(`MinerU查询失败: ${resultResponse.statusText}`);
    }

    const resultData = await resultResponse.json();

    if (resultData.code !== 0) {
      throw new Error(`MinerU返回错误: ${resultData.msg}`);
    }

    res.json({
      success: true,
      service: 'mineru',
      ...resultData.data,
    });

  } catch (error) {
    next(error);
  }
});

// ==================== Doc2X Routes ====================

// Doc2X 文件上传
router.post('/doc2x/upload', async (req, res, next) => {
  try {
    const file = req.file;

    if (!file) {
      return res.status(400).json({ error: 'No file provided' });
    }

    const token = getToken(req, 'DOC2X');
    if (!token) {
      return res.status(401).json({
        error: 'Doc2X API Token required'
      });
    }

    // 1. 请求预上传链接
    const preuploadResponse = await fetch(`${DOC2X_BASE_URL}/api/v2/parse/preupload`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });

    if (!preuploadResponse.ok) {
      throw new Error(`Doc2X预上传失败: ${await preuploadResponse.text()}`);
    }

    const preuploadData = await preuploadResponse.json();

    if (preuploadData.code !== 'success') {
      throw new Error(`Doc2X返回错误: ${preuploadData.msg || 'Unknown error'}`);
    }

    const { uid, url: uploadUrl } = preuploadData.data;

    // 2. 上传文件到 OSS
    const ossUploadResponse = await fetch(uploadUrl, {
      method: 'PUT',
      body: file.buffer,
    });

    if (!ossUploadResponse.ok) {
      throw new Error(`Doc2X OSS上传失败: ${ossUploadResponse.status} ${ossUploadResponse.statusText}`);
    }

    res.json({
      success: true,
      uid: uid,
      file_name: file.originalname,
      service: 'doc2x'
    });

  } catch (error) {
    next(error);
  }
});

// Doc2X 查询状态
router.get('/doc2x/status/:uid', async (req, res, next) => {
  try {
    const { uid } = req.params;

    if (!uid) {
      return res.status(400).json({ error: 'uid is required' });
    }

    if (uid === '__health__') {
      const token = getToken(req, 'DOC2X');
      if (!token) {
        return res.status(401).json({ error: 'Doc2X API Token required' });
      }
      return res.json({ success: true, service: 'doc2x', health: true, timestamp: Date.now() });
    }

    const token = getToken(req, 'DOC2X');
    if (!token) {
      return res.status(401).json({ error: 'Doc2X API Token required' });
    }

    const statusResponse = await fetch(`${DOC2X_BASE_URL}/api/v2/parse/status?uid=${uid}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });

    if (!statusResponse.ok) {
      throw new Error(`Doc2X查询失败: ${statusResponse.statusText}`);
    }

    const statusData = await statusResponse.json();

    if (statusData.code !== 'success') {
      return res.json({
        success: false,
        service: 'doc2x',
        error: statusData.code,
        message: statusData.msg || 'Unknown error'
      });
    }

    res.json({
      success: true,
      service: 'doc2x',
      ...statusData.data,
    });

  } catch (error) {
    next(error);
  }
});

// Doc2X 转换
router.post('/doc2x/convert', async (req, res, next) => {
  try {
    const { uid, to = 'md', formula_mode = 'normal', filename, merge_cross_page_forms = false } = req.body;

    if (!uid) {
      return res.status(400).json({ error: 'uid is required' });
    }

    const token = getToken(req, 'DOC2X');
    if (!token) {
      return res.status(401).json({ error: 'Doc2X API Token required' });
    }

    const convertResponse = await fetch(`${DOC2X_BASE_URL}/api/v2/convert/parse`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        uid,
        to,
        formula_mode,
        ...(filename && { filename }),
        merge_cross_page_forms,
      }),
    });

    if (!convertResponse.ok) {
      throw new Error(`Doc2X转换失败: ${await convertResponse.text()}`);
    }

    const convertData = await convertResponse.json();

    if (convertData.code !== 'success') {
      return res.json({
        success: false,
        service: 'doc2x',
        error: convertData.code,
        message: convertData.msg || 'Convert failed'
      });
    }

    res.json({
      success: true,
      service: 'doc2x',
      ...convertData.data,
    });

  } catch (error) {
    next(error);
  }
});

// Doc2X 获取转换结果
router.get('/doc2x/convert/result/:uid', async (req, res, next) => {
  try {
    const { uid } = req.params;

    if (!uid) {
      return res.status(400).json({ error: 'uid is required' });
    }

    const token = getToken(req, 'DOC2X');
    if (!token) {
      return res.status(401).json({ error: 'Doc2X API Token required' });
    }

    const resultResponse = await fetch(`${DOC2X_BASE_URL}/api/v2/convert/parse/result?uid=${uid}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });

    if (!resultResponse.ok) {
      throw new Error(`Doc2X查询转换结果失败: ${resultResponse.statusText}`);
    }

    const resultData = await resultResponse.json();

    if (resultData.code !== 'success') {
      return res.json({
        success: false,
        service: 'doc2x',
        error: resultData.code,
        message: resultData.msg || 'Failed to get convert result'
      });
    }

    res.json({
      success: true,
      service: 'doc2x',
      ...resultData.data,
    });

  } catch (error) {
    next(error);
  }
});

// ==================== ZIP 代理 ====================

router.get('/proxy/zip', async (req, res, next) => {
  try {
    const zipUrl = req.query.url;

    if (!zipUrl) {
      return res.status(400).json({ error: 'url parameter is required' });
    }

    const upstreamHeaders = {};
    const rangeHeader = req.headers['range'];
    if (rangeHeader) {
      upstreamHeaders['Range'] = rangeHeader;
    }

    const response = await fetch(zipUrl, {
      method: req.method,
      headers: upstreamHeaders,
      redirect: 'follow'
    });

    if (!response.ok && response.status !== 206) {
      return res.status(502).json({ error: `Upstream fetch failed: ${response.status}` });
    }

    res.setHeader('Content-Type', response.headers.get('Content-Type') || 'application/zip');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');
    res.setHeader('Cache-Control', 'no-store');

    if (response.headers.get('Content-Length')) {
      res.setHeader('Content-Length', response.headers.get('Content-Length'));
    }
    if (response.headers.get('Content-Range')) {
      res.setHeader('Content-Range', response.headers.get('Content-Range'));
    }
    if (response.headers.get('Accept-Ranges')) {
      res.setHeader('Accept-Ranges', response.headers.get('Accept-Ranges'));
    }

    res.status(response.status);
    response.body.pipe(res);

  } catch (error) {
    next(error);
  }
});

export default router;
