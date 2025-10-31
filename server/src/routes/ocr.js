import express from 'express';
import fetch from 'node-fetch';
import dns from 'dns';
import net from 'net';
import { PassThrough } from 'stream';
import { getProxySettings } from '../utils/configCenter.js';

const router = express.Router();

const MINERU_BASE_URL = 'https://mineru.net/api/v4';
const DOC2X_BASE_URL = 'https://v2.doc2x.noedgeai.com';

// 从配置中心动态获取设置
let dynamicProxySettings = {
  whitelist: [],
  allowHttp: false,
  timeoutMs: parseInt(process.env.OCR_UPSTREAM_TIMEOUT_MS || '30000', 10),
  maxDownloadBytes: parseInt(process.env.MAX_PROXY_DOWNLOAD_MB || '100', 10) * 1024 * 1024,
};

async function refreshProxySettings() {
  try {
    dynamicProxySettings = await getProxySettings();
  } catch {
    // ignore; fallback to env defaults
  }
}

// 启动时预取一次
refreshProxySettings();
// 周期刷新（1分钟）
setInterval(refreshProxySettings, 60 * 1000).unref?.();

// ================ 安全辅助函数 ================

function isPrivateIp(ip) {
  if (!ip) return true;
  // IPv4 私网与保留
  const v = net.isIP(ip);
  if (v === 4) {
    const octets = ip.split('.').map(n => parseInt(n, 10));
    const [a, b] = octets;
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 127) return true; // 127.0.0.0/8 回环
    if (a === 169 && b === 254) return true; // 链路本地
    if (a === 0) return true; // 0.0.0.0/8
  }
  if (v === 6) {
    const normalized = ip.toLowerCase();
    if (normalized === '::1') return true; // 回环
    if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true; // fc00::/7 私网
    if (normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb')) return true; // fe80::/10 链路本地
  }
  return false;
}

async function resolveAndValidateHost(urlObj) {
  // 协议限制：仅 https（更安全）；如需放宽到 http，可通过环境变量显式允许
  const allowHttp = dynamicProxySettings.allowHttp === true;
  if (!(urlObj.protocol === 'https:' || (allowHttp && urlObj.protocol === 'http:'))) {
    throw new Error('Only HTTPS is allowed for proxy');
  }

  const hostname = urlObj.hostname.toLowerCase();
  if (hostname === 'localhost') {
    throw new Error('Proxy to localhost is not allowed');
  }

  // 白名单检查（如配置）
  const whitelist = dynamicProxySettings.whitelist || [];
  if (whitelist.length > 0) {
    const hit = whitelist.some(allowed => hostname === allowed || hostname.endsWith('.' + allowed));
    if (!hit) {
      throw new Error('Host is not in whitelist');
    }
  }

  // 解析 A/AAAA 记录并阻断私网
  const lookup = dns.promises.lookup;
  try {
    const result = await lookup(hostname, { all: true });
    for (const addr of result) {
      if (isPrivateIp(addr.address)) {
        throw new Error('Resolved to private or loopback address');
      }
    }
  } catch (err) {
    // DNS 失败也拒绝，避免绕过
    throw new Error('DNS resolution failed');
  }
}

function fetchWithTimeout(url, options = {}, timeoutMs, controller) {
  const effectiveTimeout = parseInt(timeoutMs || dynamicProxySettings.timeoutMs || 30000, 10);
  const ctrl = controller || new AbortController();
  const id = setTimeout(() => ctrl.abort(new Error('Fetch timeout')), effectiveTimeout);
  const finalOptions = { ...options, signal: ctrl.signal };
  return fetch(url, finalOptions)
    .finally(() => clearTimeout(id));
}

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
    const uploadUrlResponse = await fetchWithTimeout(`${MINERU_BASE_URL}/file-urls/batch`, {
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

    const ossUploadResponse = await fetchWithTimeout(ossUploadUrl, {
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

    const resultResponse = await fetchWithTimeout(`${MINERU_BASE_URL}/extract-results/batch/${batchId}`, {
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
    const preuploadResponse = await fetchWithTimeout(`${DOC2X_BASE_URL}/api/v2/parse/preupload`, {
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
    const ossUploadResponse = await fetchWithTimeout(uploadUrl, {
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

    const statusResponse = await fetchWithTimeout(`${DOC2X_BASE_URL}/api/v2/parse/status?uid=${uid}`, {
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

    const convertResponse = await fetchWithTimeout(`${DOC2X_BASE_URL}/api/v2/convert/parse`, {
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

    const resultResponse = await fetchWithTimeout(`${DOC2X_BASE_URL}/api/v2/convert/parse/result?uid=${uid}`, {
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

    let urlObj;
    try {
      urlObj = new URL(zipUrl);
    } catch {
      return res.status(400).json({ error: 'Invalid URL' });
    }

    // 校验域名与解析地址
    try {
      await resolveAndValidateHost(urlObj);
    } catch (err) {
      const msg = process.env.NODE_ENV === 'production' ? 'Upstream validation failed' : `Validation failed: ${err.message}`;
      return res.status(400).json({ error: msg });
    }

    const upstreamHeaders = {};
    const rangeHeader = req.headers['range'];
    if (rangeHeader) {
      upstreamHeaders['Range'] = rangeHeader;
    }

    const controller = new AbortController();
    const response = await fetchWithTimeout(zipUrl, {
      method: req.method,
      headers: upstreamHeaders,
      redirect: 'follow',
    }, dynamicProxySettings.timeoutMs, controller);

    if (!response.ok && response.status !== 206) {
      const msg = process.env.NODE_ENV === 'production' ? 'Upstream fetch failed' : `Upstream fetch failed: ${response.status}`;
      return res.status(502).json({ error: msg });
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

    // 监控大小，超过限制则中止
    let downloaded = 0;
    const monitor = new PassThrough();
    monitor.on('data', (chunk) => {
      downloaded += chunk.length;
      if (downloaded > (dynamicProxySettings.maxDownloadBytes || 100 * 1024 * 1024)) {
        controller.abort();
        monitor.destroy(new Error('Response too large'));
      }
    });

    response.body.on('error', (err) => {
      monitor.destroy(err);
    });

    response.body.pipe(monitor).pipe(res);

  } catch (error) {
    if (process.env.NODE_ENV === 'production') {
      return res.status(502).json({ error: 'Proxy error' });
    }
    next(error);
  }
});

export default router;
