/**
 * Paper Burner 本地代理服务器
 *
 * 功能完全等同于 Cloudflare Worker，用户可以本地快速部署使用
 *
 * 支持的服务：
 * 1. OCR 代理 (MinerU / Doc2X)
 * 2. 学术搜索代理 (Semantic Scholar / PubMed / CrossRef / OpenAlex / arXiv)
 * 3. PDF/ZIP 下载代理
 *
 * 使用方法：
 *   1. npm install
 *   2. 复制 .env.example 到 .env 并配置
 *   3. npm start
 *
 * 然后在 Paper Burner 前端设置代理地址为 http://localhost:3456
 */

import http from 'http';
import { URL, URLSearchParams } from 'url';
import fetch from 'node-fetch';
import { createReadStream, readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { Readable } from 'stream';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ==================== 配置加载 ====================

// 尝试加载 .env 文件
function loadEnv() {
  const envPath = join(__dirname, '.env');
  if (existsSync(envPath)) {
    const content = readFileSync(envPath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const [key, ...valueParts] = trimmed.split('=');
        if (key && valueParts.length > 0) {
          process.env[key.trim()] = valueParts.join('=').trim().replace(/^["']|["']$/g, '');
        }
      }
    }
  }
}
loadEnv();

const PORT = parseInt(process.env.PORT || '3456', 10);
const MINERU_BASE_URL = 'https://mineru.net/api/v4';
const DOC2X_BASE_URL = 'https://v2.doc2x.noedgeai.com';

// ==================== 工具函数 ====================

function jsonResponse(res, data, status = 200, origin = '*') {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, HEAD, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Range, X-Auth-Key, X-Api-Key, X-MinerU-Key, X-Doc2X-Key',
    'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges',
  });
  res.end(JSON.stringify(data));
}

function handleCORS(res, origin = '*') {
  res.writeHead(204, {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, HEAD, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Range, X-Auth-Key, X-Api-Key, X-MinerU-Key, X-Doc2X-Key',
    'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges',
    'Access-Control-Max-Age': '86400',
  });
  res.end();
}

function getToken(headers, service) {
  const headerKey = service === 'MINERU' ? 'x-mineru-key' : 'x-doc2x-key';
  let token = headers[headerKey];

  if (!token) {
    const envKey = service === 'MINERU' ? 'MINERU_API_TOKEN' : 'DOC2X_API_TOKEN';
    token = process.env[envKey];
  }

  if (token) {
    token = token.replace(/^Bearer\s+/i, '').trim();
  }

  return token || null;
}

async function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// 简易 multipart 解析器
async function parseMultipart(req) {
  const contentType = req.headers['content-type'] || '';
  const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/);
  if (!boundaryMatch) throw new Error('No boundary found');

  const boundary = boundaryMatch[1] || boundaryMatch[2];
  const body = await readBody(req);
  const parts = [];

  const boundaryBuffer = Buffer.from(`--${boundary}`);
  const endBoundary = Buffer.from(`--${boundary}--`);

  let start = body.indexOf(boundaryBuffer) + boundaryBuffer.length + 2; // skip \r\n

  while (start < body.length) {
    const nextBoundary = body.indexOf(boundaryBuffer, start);
    if (nextBoundary === -1) break;

    const partData = body.slice(start, nextBoundary - 2); // remove trailing \r\n
    const headerEnd = partData.indexOf('\r\n\r\n');

    if (headerEnd !== -1) {
      const headerStr = partData.slice(0, headerEnd).toString();
      const content = partData.slice(headerEnd + 4);

      const nameMatch = headerStr.match(/name="([^"]+)"/);
      const filenameMatch = headerStr.match(/filename="([^"]+)"/);

      if (nameMatch) {
        parts.push({
          name: nameMatch[1],
          filename: filenameMatch ? filenameMatch[1] : null,
          data: filenameMatch ? content : content.toString()
        });
      }
    }

    start = nextBoundary + boundaryBuffer.length + 2;
  }

  return parts;
}

// ==================== MinerU 处理 ====================

async function handleMinerUUpload(req, res, origin) {
  try {
    const parts = await parseMultipart(req);
    const filePart = parts.find(p => p.name === 'file');

    if (!filePart || !filePart.filename) {
      return jsonResponse(res, { error: 'No file provided' }, 400, origin);
    }

    const token = getToken(req.headers, 'MINERU');
    if (!token) {
      return jsonResponse(res, {
        error: 'MinerU API Token required. Provide via X-MinerU-Key header or MINERU_API_TOKEN env variable'
      }, 401, origin);
    }

    // 解析表单字段
    const getField = (name, defaultVal) => {
      const part = parts.find(p => p.name === name);
      return part ? part.data : defaultVal;
    };

    const isOcr = getField('is_ocr', 'true') !== 'false';
    const enableFormula = getField('enable_formula', 'true') !== 'false';
    const enableTable = getField('enable_table', 'true') !== 'false';
    const language = getField('language', 'ch');
    const dataId = getField('data_id', null);
    const pageRanges = getField('page_ranges', null);

    console.log(`[MinerU] Uploading: ${filePart.filename}`);

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
        language,
        files: [{
          name: filePart.filename,
          is_ocr: isOcr,
          ...(dataId && { data_id: dataId }),
          ...(pageRanges && { page_ranges: pageRanges }),
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

    // 上传到 OSS
    const ossUrl = uploadData.data.file_urls[0];
    console.log(`[MinerU] Uploading to OSS: ${filePart.data.length} bytes`);
    const ossResponse = await fetch(ossUrl, {
      method: 'PUT',
      body: filePart.data,
      headers: {
        'Content-Length': filePart.data.length.toString(),
      },
    });

    if (!ossResponse.ok) {
      throw new Error(`OSS上传失败: ${ossResponse.status}`);
    }

    jsonResponse(res, {
      success: true,
      batch_id: uploadData.data.batch_id,
      file_name: filePart.filename,
      service: 'mineru'
    }, 200, origin);

  } catch (error) {
    console.error('[MinerU] Upload error:', error.message);
    jsonResponse(res, { error: error.message }, 500, origin);
  }
}

async function handleMinerUResult(req, res, batchId, origin) {
  try {
    if (batchId === '__health__') {
      const token = getToken(req.headers, 'MINERU');
      if (!token) {
        return jsonResponse(res, { error: 'MinerU API Token required' }, 401, origin);
      }
      return jsonResponse(res, { success: true, service: 'mineru', health: true, timestamp: Date.now() }, 200, origin);
    }

    const token = getToken(req.headers, 'MINERU');
    if (!token) {
      return jsonResponse(res, { error: 'MinerU API Token required' }, 401, origin);
    }

    const response = await fetch(`${MINERU_BASE_URL}/extract-results/batch/${batchId}`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`MinerU查询失败: ${response.statusText}`);
    }

    const data = await response.json();
    if (data.code !== 0) {
      throw new Error(`MinerU返回错误: ${data.msg}`);
    }

    jsonResponse(res, { success: true, service: 'mineru', ...data.data }, 200, origin);

  } catch (error) {
    console.error('[MinerU] Result error:', error.message);
    jsonResponse(res, { error: error.message }, 500, origin);
  }
}

// ==================== Doc2X 处理 ====================

async function handleDoc2XUpload(req, res, origin) {
  try {
    const parts = await parseMultipart(req);
    const filePart = parts.find(p => p.name === 'file');

    if (!filePart || !filePart.filename) {
      return jsonResponse(res, { error: 'No file provided' }, 400, origin);
    }

    const token = getToken(req.headers, 'DOC2X');
    if (!token) {
      return jsonResponse(res, { error: 'Doc2X API Token required' }, 401, origin);
    }

    console.log(`[Doc2X] Uploading: ${filePart.filename}`);

    // 请求预上传链接
    const preuploadResponse = await fetch(`${DOC2X_BASE_URL}/api/v2/parse/preupload`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
    });

    if (!preuploadResponse.ok) {
      throw new Error(`Doc2X预上传失败: ${await preuploadResponse.text()}`);
    }

    const preuploadData = await preuploadResponse.json();
    if (preuploadData.code !== 'success') {
      throw new Error(`Doc2X返回错误: ${preuploadData.msg}`);
    }

    const { uid, url: uploadUrl } = preuploadData.data;

    // 上传到 OSS
    console.log(`[Doc2X] Uploading to OSS: ${filePart.data.length} bytes`);
    const ossResponse = await fetch(uploadUrl, {
      method: 'PUT',
      body: filePart.data,
      headers: {
        'Content-Length': filePart.data.length.toString(),
      },
    });

    if (!ossResponse.ok) {
      throw new Error(`Doc2X OSS上传失败: ${ossResponse.status}`);
    }

    jsonResponse(res, {
      success: true,
      uid,
      file_name: filePart.filename,
      service: 'doc2x'
    }, 200, origin);

  } catch (error) {
    console.error('[Doc2X] Upload error:', error.message);
    jsonResponse(res, { error: error.message }, 500, origin);
  }
}

async function handleDoc2XStatus(req, res, uid, origin) {
  try {
    if (uid === '__health__') {
      const token = getToken(req.headers, 'DOC2X');
      if (!token) {
        return jsonResponse(res, { error: 'Doc2X API Token required' }, 401, origin);
      }
      return jsonResponse(res, { success: true, service: 'doc2x', health: true, timestamp: Date.now() }, 200, origin);
    }

    const token = getToken(req.headers, 'DOC2X');
    if (!token) {
      return jsonResponse(res, { error: 'Doc2X API Token required' }, 401, origin);
    }

    const response = await fetch(`${DOC2X_BASE_URL}/api/v2/parse/status?uid=${uid}`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });

    if (!response.ok) {
      throw new Error(`Doc2X查询失败: ${response.statusText}`);
    }

    const data = await response.json();
    if (data.code !== 'success') {
      return jsonResponse(res, { success: false, service: 'doc2x', error: data.code, message: data.msg }, 200, origin);
    }

    jsonResponse(res, { success: true, service: 'doc2x', ...data.data }, 200, origin);

  } catch (error) {
    console.error('[Doc2X] Status error:', error.message);
    jsonResponse(res, { error: error.message }, 500, origin);
  }
}

async function handleDoc2XConvert(req, res, origin) {
  try {
    const body = JSON.parse((await readBody(req)).toString());
    const { uid, to = 'md', formula_mode = 'normal', filename, merge_cross_page_forms = false } = body;

    if (!uid) {
      return jsonResponse(res, { error: 'uid is required' }, 400, origin);
    }

    const token = getToken(req.headers, 'DOC2X');
    if (!token) {
      return jsonResponse(res, { error: 'Doc2X API Token required' }, 401, origin);
    }

    const response = await fetch(`${DOC2X_BASE_URL}/api/v2/convert/parse`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ uid, to, formula_mode, ...(filename && { filename }), merge_cross_page_forms }),
    });

    if (!response.ok) {
      throw new Error(`Doc2X转换失败: ${await response.text()}`);
    }

    const data = await response.json();
    if (data.code !== 'success') {
      return jsonResponse(res, { success: false, service: 'doc2x', error: data.code, message: data.msg }, 200, origin);
    }

    jsonResponse(res, { success: true, service: 'doc2x', ...data.data }, 200, origin);

  } catch (error) {
    console.error('[Doc2X] Convert error:', error.message);
    jsonResponse(res, { error: error.message }, 500, origin);
  }
}

async function handleDoc2XConvertResult(req, res, uid, origin) {
  try {
    const token = getToken(req.headers, 'DOC2X');
    if (!token) {
      return jsonResponse(res, { error: 'Doc2X API Token required' }, 401, origin);
    }

    const response = await fetch(`${DOC2X_BASE_URL}/api/v2/convert/parse/result?uid=${uid}`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });

    if (!response.ok) {
      throw new Error(`Doc2X查询转换结果失败: ${response.statusText}`);
    }

    const data = await response.json();
    if (data.code !== 'success') {
      return jsonResponse(res, { success: false, service: 'doc2x', error: data.code, message: data.msg }, 200, origin);
    }

    jsonResponse(res, { success: true, service: 'doc2x', ...data.data }, 200, origin);

  } catch (error) {
    console.error('[Doc2X] Convert result error:', error.message);
    jsonResponse(res, { error: error.message }, 500, origin);
  }
}

// ==================== 学术搜索代理 ====================

async function proxySemanticScholar(req, res, path, searchParams, origin) {
  try {
    const apiKey = req.headers['x-api-key'] || process.env.SEMANTIC_SCHOLAR_API_KEY;
    const url = `https://api.semanticscholar.org/${path}?${searchParams}`;

    console.log(`[Semantic Scholar] Proxying: ${url}`);

    const headers = { 'User-Agent': 'PaperBurner-LocalProxy/1.0' };
    if (apiKey) headers['x-api-key'] = apiKey;

    const response = await fetch(url, { headers });
    const data = await response.json();
    jsonResponse(res, data, response.status, origin);
  } catch (error) {
    console.error('[Semantic Scholar] Error:', error.message);
    jsonResponse(res, { error: 'Semantic Scholar upstream error', message: error.message }, 503, origin);
  }
}

async function proxyPubMed(req, res, path, searchParams, origin) {
  try {
    const apiKey = req.headers['x-api-key'] || process.env.PUBMED_API_KEY;
    const params = new URLSearchParams(searchParams);
    if (apiKey) params.set('api_key', apiKey);

    const url = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/${path}?${params}`;

    console.log(`[PubMed] Proxying: ${url}`);

    const response = await fetch(url, { headers: { 'User-Agent': 'PaperBurner-LocalProxy/1.0' } });
    const contentType = response.headers.get('content-type') || '';
    const text = await response.text();

    res.writeHead(response.status, {
      'Content-Type': contentType.includes('xml') ? 'application/xml' : 'text/plain',
      'Access-Control-Allow-Origin': origin,
    });
    res.end(text);
  } catch (error) {
    console.error('[PubMed] Error:', error.message);
    jsonResponse(res, { error: 'PubMed upstream error', message: error.message }, 503, origin);
  }
}

async function proxyCrossRef(req, res, path, searchParams, origin) {
  try {
    const url = `https://api.crossref.org/${path}?${searchParams}`;
    console.log(`[CrossRef] Proxying: ${url}`);

    const response = await fetch(url, { headers: { 'User-Agent': 'PaperBurner-LocalProxy/1.0' } });
    const data = await response.json();
    jsonResponse(res, data, response.status, origin);
  } catch (error) {
    console.error('[CrossRef] Error:', error.message);
    jsonResponse(res, { error: 'CrossRef upstream error', message: error.message }, 503, origin);
  }
}

async function proxyOpenAlex(req, res, path, searchParams, origin) {
  try {
    const url = `https://api.openalex.org/${path}?${searchParams}`;
    console.log(`[OpenAlex] Proxying: ${url}`);

    const response = await fetch(url, { headers: { 'User-Agent': 'PaperBurner-LocalProxy/1.0' } });
    const data = await response.json();
    jsonResponse(res, data, response.status, origin);
  } catch (error) {
    console.error('[OpenAlex] Error:', error.message);
    jsonResponse(res, { error: 'OpenAlex upstream error', message: error.message }, 503, origin);
  }
}

async function proxyArXiv(req, res, path, searchParams, origin) {
  try {
    const url = `http://export.arxiv.org/api/${path}?${searchParams}`;
    console.log(`[arXiv] Proxying: ${url}`);

    const response = await fetch(url);
    const text = await response.text();

    res.writeHead(response.status, {
      'Content-Type': 'application/xml',
      'Access-Control-Allow-Origin': origin,
    });
    res.end(text);
  } catch (error) {
    console.error('[arXiv] Error:', error.message);
    jsonResponse(res, { error: 'arXiv upstream error', message: error.message }, 503, origin);
  }
}

// ==================== ZIP/PDF 代理 ====================

async function handleProxyDownload(req, res, downloadUrl, origin) {
  try {
    if (!downloadUrl) {
      return jsonResponse(res, { error: 'url parameter is required' }, 400, origin);
    }

    const method = req.method || 'GET';
    console.log(`[Proxy] ${method} ${downloadUrl}`);

    const headers = { 'User-Agent': 'PaperBurner-LocalProxy/1.0' };
    const rangeHeader = req.headers['range'];
    if (rangeHeader) {
      headers['Range'] = rangeHeader;
    }

    const response = await fetch(downloadUrl, { method, headers, redirect: 'follow' });

    if (!response.ok && response.status !== 206) {
      return jsonResponse(res, { error: `Upstream fetch failed: ${response.status}` }, 502, origin);
    }

    const contentLength = response.headers.get('Content-Length');
    console.log(`[Proxy] ${method} response: ${response.status}, Content-Length: ${contentLength}`);

    const responseHeaders = {
      'Content-Type': response.headers.get('Content-Type') || 'application/octet-stream',
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Range, X-Auth-Key',
      'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges',
      'Cache-Control': 'no-store',
    };

    if (contentLength) {
      responseHeaders['Content-Length'] = contentLength;
    }
    if (response.headers.get('Content-Range')) {
      responseHeaders['Content-Range'] = response.headers.get('Content-Range');
    }
    if (response.headers.get('Accept-Ranges')) {
      responseHeaders['Accept-Ranges'] = response.headers.get('Accept-Ranges');
    }

    // HEAD 请求不返回 body
    if (method === 'HEAD') {
      res.writeHead(response.status, responseHeaders);
      return res.end();
    }

    // 对于 GET 请求，使用简单的方式：先读取全部数据再发送
    // 这样更可靠，虽然会占用更多内存
    console.log(`[Proxy] Reading response body...`);
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    console.log(`[Proxy] Got ${buffer.length} bytes, sending to client...`);

    // 更新实际的 Content-Length
    responseHeaders['Content-Length'] = buffer.length.toString();

    res.writeHead(response.status, responseHeaders);
    res.end(buffer);
    console.log(`[Proxy] Done sending ${buffer.length} bytes`);

  } catch (error) {
    console.error('[Proxy] Download error:', error.message);
    // 只有在还没发送响应头时才返回错误
    if (!res.headersSent) {
      jsonResponse(res, { error: error.message }, 500, origin);
    } else {
      res.end();
    }
  }
}

// ==================== 主路由 ====================

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;
  const searchParams = url.searchParams.toString();
  const origin = req.headers.origin || '*';

  // CORS 预检
  if (req.method === 'OPTIONS') {
    return handleCORS(res, origin);
  }

  try {
    // ===== OCR 路由 (兼容 CF Worker) =====

    // MinerU
    if (pathname === '/mineru/upload' && req.method === 'POST') {
      return await handleMinerUUpload(req, res, origin);
    }
    if (pathname.startsWith('/mineru/result/') && req.method === 'GET') {
      const batchId = pathname.split('/mineru/result/')[1];
      return await handleMinerUResult(req, res, batchId, origin);
    }

    // Doc2X
    if (pathname === '/doc2x/upload' && req.method === 'POST') {
      return await handleDoc2XUpload(req, res, origin);
    }
    if (pathname.startsWith('/doc2x/status/') && req.method === 'GET') {
      const uid = pathname.split('/doc2x/status/')[1];
      return await handleDoc2XStatus(req, res, uid, origin);
    }
    if (pathname === '/doc2x/convert' && req.method === 'POST') {
      return await handleDoc2XConvert(req, res, origin);
    }
    if (pathname.startsWith('/doc2x/convert/result/') && req.method === 'GET') {
      const uid = pathname.split('/doc2x/convert/result/')[1];
      return await handleDoc2XConvertResult(req, res, uid, origin);
    }

    // ZIP 代理
    if ((pathname === '/mineru/zip' || pathname === '/doc2x/zip') && (req.method === 'GET' || req.method === 'HEAD')) {
      const zipUrl = url.searchParams.get('url');
      return await handleProxyDownload(req, res, zipUrl, origin);
    }

    // ===== 学术搜索路由 (兼容 CF Worker) =====

    if (pathname.startsWith('/api/semanticscholar/')) {
      const path = pathname.replace('/api/semanticscholar/', '');
      return await proxySemanticScholar(req, res, path, searchParams, origin);
    }

    if (pathname.startsWith('/api/pubmed/')) {
      const path = pathname.replace('/api/pubmed/', '');
      return await proxyPubMed(req, res, path, searchParams, origin);
    }

    if (pathname.startsWith('/api/crossref/')) {
      const path = pathname.replace('/api/crossref/', '');
      return await proxyCrossRef(req, res, path, searchParams, origin);
    }

    if (pathname.startsWith('/api/openalex/')) {
      const path = pathname.replace('/api/openalex/', '');
      return await proxyOpenAlex(req, res, path, searchParams, origin);
    }

    if (pathname.startsWith('/api/arxiv/')) {
      const path = pathname.replace('/api/arxiv/', '');
      return await proxyArXiv(req, res, path, searchParams, origin);
    }

    // PDF 下载代理
    if (pathname === '/api/pdf/download' && (req.method === 'GET' || req.method === 'HEAD')) {
      const pdfUrl = url.searchParams.get('url');
      return await handleProxyDownload(req, res, pdfUrl, origin);
    }

    // ===== 健康检查 =====
    if (pathname === '/health') {
      return jsonResponse(res, {
        status: 'ok',
        timestamp: Date.now(),
        version: '1.0.0',
        services: {
          ocr: {
            mineru: { enabled: true, hasToken: !!process.env.MINERU_API_TOKEN },
            doc2x: { enabled: true, hasToken: !!process.env.DOC2X_API_TOKEN },
          },
          academic: {
            semanticscholar: { enabled: true, hasApiKey: !!process.env.SEMANTIC_SCHOLAR_API_KEY },
            pubmed: { enabled: true, hasApiKey: !!process.env.PUBMED_API_KEY },
            crossref: { enabled: true },
            openalex: { enabled: true },
            arxiv: { enabled: true },
          }
        }
      }, 200, origin);
    }

    // 404
    if (!res.headersSent) {
      jsonResponse(res, { error: 'Not Found' }, 404, origin);
    }

  } catch (error) {
    console.error('Server error:', error);
    if (!res.headersSent) {
      jsonResponse(res, { error: error.message || 'Internal Server Error' }, 500, origin);
    }
  }
});

// ==================== 启动服务器 ====================

// 设置服务器超时时间（5分钟，用于大文件传输）
server.timeout = 300000;
server.keepAliveTimeout = 120000;
server.headersTimeout = 120000;

server.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════════════╗
║     Paper Burner Local Proxy Server                   ║
╠═══════════════════════════════════════════════════════╣
║  Port: ${PORT.toString().padEnd(47)} ║
║  URL:  http://localhost:${PORT.toString().padEnd(30)} ║
╠═══════════════════════════════════════════════════════╣
║  OCR Services:                                        ║
║    MinerU Token: ${(process.env.MINERU_API_TOKEN ? '✓ Configured' : '✗ Not set').padEnd(36)} ║
║    Doc2X Token:  ${(process.env.DOC2X_API_TOKEN ? '✓ Configured' : '✗ Not set').padEnd(36)} ║
║                                                       ║
║  Academic Search:                                     ║
║    Semantic Scholar, PubMed, CrossRef,                ║
║    OpenAlex, arXiv                                    ║
╠═══════════════════════════════════════════════════════╣
║  在 Paper Burner 中设置代理地址为:                    ║
║  http://localhost:${PORT.toString().padEnd(38)} ║
╚═══════════════════════════════════════════════════════╝
  `);
});
