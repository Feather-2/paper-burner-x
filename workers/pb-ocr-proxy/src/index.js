/**
 * Cloudflare Worker - OCR API Proxy
 * 支持 MinerU 和 Doc2X 两种 OCR 服务
 */

const MINERU_BASE_URL = 'https://mineru.net/api/v4';
const DOC2X_BASE_URL = 'https://v2.doc2x.noedgeai.com';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // OPTIONS 预检请求
    if (request.method === 'OPTIONS') {
      return handleCORS(request, env);
    }

    // 身份验证
    const authResult = await authenticate(request, env);
    if (!authResult.success) {
      return jsonResponse({ error: authResult.error }, 401, request, env);
    }

    // 路由处理
    try {
      // ===== MinerU 路由 =====
      if (url.pathname === '/mineru/upload' && request.method === 'POST') {
        return await handleMinerUUpload(request, env);
      }

      if (url.pathname.startsWith('/mineru/result/') && request.method === 'GET') {
        const batchId = url.pathname.split('/mineru/result/')[1];
        return await handleMinerUGetResult(batchId, env, request);
      }

      // ===== Doc2X 路由 =====
      if (url.pathname === '/doc2x/upload' && request.method === 'POST') {
        return await handleDoc2XUpload(request, env);
      }

      if (url.pathname.startsWith('/doc2x/status/') && request.method === 'GET') {
        const uid = url.pathname.split('/doc2x/status/')[1];
        return await handleDoc2XStatus(uid, env, request);
      }

      if (url.pathname === '/doc2x/convert' && request.method === 'POST') {
        return await handleDoc2XConvert(request, env);
      }

      if (url.pathname.startsWith('/doc2x/convert/result/') && request.method === 'GET') {
        const uid = url.pathname.split('/doc2x/convert/result/')[1];
        return await handleDoc2XConvertResult(uid, env, request);
      }

      // ===== 直通 ZIP 代理（解决浏览器跨域限制，支持 HEAD 和 Range 请求） =====
      if (url.pathname === '/mineru/zip' && (request.method === 'GET' || request.method === 'HEAD')) {
        const zipUrl = url.searchParams.get('url');
        return await handleProxyZip(zipUrl, request, env);
      }
      if (url.pathname === '/doc2x/zip' && (request.method === 'GET' || request.method === 'HEAD')) {
        const zipUrl = url.searchParams.get('url');
        return await handleProxyZip(zipUrl, request, env);
      }

      // ===== 通用路由 =====
      if (url.pathname === '/health' && request.method === 'GET') {
        return jsonResponse({
          status: 'ok',
          timestamp: Date.now(),
          services: ['mineru', 'doc2x']
        }, 200, request, env);
      }

      return jsonResponse({ error: 'Not Found' }, 404, request, env);

    } catch (error) {
      console.error('Worker error:', error);
      return jsonResponse({ error: error.message || 'Internal Server Error' }, 500, request, env);
    }
  },
};

/**
 * 身份验证
 */
async function authenticate(request, env) {
  if (env.ENABLE_AUTH !== 'true') {
    return { success: true };
  }

  if (env.ALLOWED_ORIGINS) {
    const origin = request.headers.get('Origin');
    const allowedOrigins = env.ALLOWED_ORIGINS.split(',').map(o => o.trim());
    if (!origin || !allowedOrigins.includes(origin)) {
      return { success: false, error: 'Origin not allowed' };
    }
  }

  if (env.AUTH_SECRET) {
    const authKey = request.headers.get('X-Auth-Key');
    if (authKey !== env.AUTH_SECRET) {
      return { success: false, error: 'Invalid authentication key' };
    }
  }

  return { success: true };
}

// ==================== MinerU 处理函数 ====================

async function handleMinerUUpload(request, env) {
  try {
    const contentType = request.headers.get('Content-Type') || '';
    if (!contentType.includes('multipart/form-data')) {
      return jsonResponse({ error: 'Content-Type must be multipart/form-data' }, 400, request, env);
    }

    const formData = await request.formData();
    const file = formData.get('file');

    if (!file) {
      return jsonResponse({ error: 'No file provided' }, 400, request, env);
    }

    // 统一的布尔参数解析函数，默认值为 true
    const parseBoolean = (value, defaultValue = true) => {
      if (value === null || value === undefined || value === '') return defaultValue;
      if (value === 'true' || value === '1' || value === true) return true;
      if (value === 'false' || value === '0' || value === false) return false;
      return defaultValue;
    };

    const isOcr = parseBoolean(formData.get('is_ocr'), true);
    const enableFormula = parseBoolean(formData.get('enable_formula'), true);
    const enableTable = parseBoolean(formData.get('enable_table'), true);
    const language = formData.get('language') || 'ch';
    const dataId = formData.get('data_id');
    const pageRanges = formData.get('page_ranges');

    console.log('[MinerU Upload] Parameters:', {
      fileName: file.name,
      is_ocr: isOcr,
      enable_formula: enableFormula,
      enable_table: enableTable,
      language,
    });

    // 获取 Token：优先从请求头，其次从环境变量
    const token = getToken(request, env, 'MINERU');
    if (!token) {
      return jsonResponse({
        error: 'MinerU API Token required. Provide via X-MinerU-Key header or MINERU_API_TOKEN env variable'
      }, 401, request, env);
    }

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
          name: file.name,
          is_ocr: isOcr,
          ...(dataId && { data_id: dataId }),
          ...(pageRanges && { page_ranges: pageRanges }),
        }],
      }),
    });

    if (!uploadUrlResponse.ok) {
      const errorText = await uploadUrlResponse.text();
      throw new Error(`MinerU申请上传链接失败: ${errorText}`);
    }

    const uploadData = await uploadUrlResponse.json();

    if (uploadData.code !== 0) {
      throw new Error(`MinerU返回错误: ${uploadData.msg}`);
    }

    // 上传文件到 OSS
    const ossUploadUrl = uploadData.data.file_urls[0];
    const fileArrayBuffer = await file.arrayBuffer();

    const ossUploadResponse = await fetch(ossUploadUrl, {
      method: 'PUT',
      body: fileArrayBuffer,
    });

    if (!ossUploadResponse.ok) {
      throw new Error(`OSS上传失败: ${ossUploadResponse.status} ${ossUploadResponse.statusText}`);
    }

    return jsonResponse({
      success: true,
      batch_id: uploadData.data.batch_id,
      file_name: file.name,
      service: 'mineru'
    }, 200, request, env);

  } catch (error) {
    console.error('MinerU upload error:', error);
    return jsonResponse({ error: error.message || 'Upload failed' }, 500, request, env);
  }
}

async function handleMinerUGetResult(batchId, env, request) {
  try {
    if (!batchId) {
      return jsonResponse({ error: 'batch_id is required' }, 400, request, env);
    }

    // 内部健康检查：用于前端"测试连接"按钮快速校验 Token 与路由
    if (batchId === '__health__') {
      const token = getToken(request, env, 'MINERU');
      if (!token) {
        return jsonResponse({
          error: 'MinerU API Token required. Provide via X-MinerU-Key header or MINERU_API_TOKEN env variable'
        }, 401, request, env);
      }
      
      // 验证Token有效性：向MinerU API发送一个简单的请求
      try {
        const tokenValidationResponse = await fetch(`${MINERU_BASE_URL}/file-urls/batch`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            files: [{
              name: 'health_check.pdf',
              is_ocr: true,
              enable_formula: false,
              enable_table: false,
              language: 'ch'
            }]
          })
        });
        
        if (!tokenValidationResponse.ok) {
          return jsonResponse({
            success: false,
            service: 'mineru',
            error: 'Invalid Token',
            message: `Token validation failed: ${tokenValidationResponse.statusText}`,
            timestamp: Date.now()
          }, 401, request, env);
        }
        
        const validationData = await tokenValidationResponse.json();
        if (validationData.code !== 0) {
          return jsonResponse({
            success: false,
            service: 'mineru',
            error: 'Invalid Token',
            message: `Token validation failed: ${validationData.msg || 'Unknown error'}`,
            timestamp: Date.now()
          }, 401, request, env);
        }
        
        return jsonResponse({ success: true, service: 'mineru', health: true, timestamp: Date.now() }, 200, request, env);
      } catch (error) {
        return jsonResponse({
          success: false,
          service: 'mineru',
          error: 'Token validation error',
          message: error.message,
          timestamp: Date.now()
        }, 401, request, env);
      }
    }

    const token = getToken(request, env, 'MINERU');
    if (!token) {
      return jsonResponse({
        error: 'MinerU API Token required. Provide via X-MinerU-Key header or MINERU_API_TOKEN env variable'
      }, 401, request, env);
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

    return jsonResponse({
      success: true,
      service: 'mineru',
      ...resultData.data,
    }, 200, request, env);

  } catch (error) {
    console.error('MinerU get result error:', error);
    return jsonResponse({ error: error.message || 'Failed to get result' }, 500, request, env);
  }
}

// ==================== Doc2X 处理函数 ====================

async function handleDoc2XUpload(request, env) {
  try {
    const contentType = request.headers.get('Content-Type') || '';
    if (!contentType.includes('multipart/form-data')) {
      return jsonResponse({ error: 'Content-Type must be multipart/form-data' }, 400, request, env);
    }

    const formData = await request.formData();
    const file = formData.get('file');

    if (!file) {
      return jsonResponse({ error: 'No file provided' }, 400, request, env);
    }

    // 获取 Token：优先从请求头，其次从环境变量
    const token = getToken(request, env, 'DOC2X');
    if (!token) {
      return jsonResponse({
        error: 'Doc2X API Token required. Provide via X-Doc2X-Key header or DOC2X_API_TOKEN env variable'
      }, 401, request, env);
    }

    // 1. 请求预上传链接
    const preuploadResponse = await fetch(`${DOC2X_BASE_URL}/api/v2/parse/preupload`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });

    if (!preuploadResponse.ok) {
      const errorText = await preuploadResponse.text();
      throw new Error(`Doc2X预上传失败: ${errorText}`);
    }

    const preuploadData = await preuploadResponse.json();

    if (preuploadData.code !== 'success') {
      throw new Error(`Doc2X返回错误: ${preuploadData.msg || 'Unknown error'}`);
    }

    const { uid, url: uploadUrl } = preuploadData.data;

    // 2. 上传文件到 OSS
    const fileArrayBuffer = await file.arrayBuffer();

    const ossUploadResponse = await fetch(uploadUrl, {
      method: 'PUT',
      body: fileArrayBuffer,
    });

    if (!ossUploadResponse.ok) {
      throw new Error(`Doc2X OSS上传失败: ${ossUploadResponse.status} ${ossUploadResponse.statusText}`);
    }

    return jsonResponse({
      success: true,
      uid: uid,
      file_name: file.name,
      service: 'doc2x'
    }, 200, request, env);

  } catch (error) {
    console.error('Doc2X upload error:', error);
    return jsonResponse({ error: error.message || 'Upload failed' }, 500, request, env);
  }
}

async function handleDoc2XStatus(uid, env, request) {
  try {
    if (!uid) {
      return jsonResponse({ error: 'uid is required' }, 400, request, env);
    }

    // 内部健康检查：用于前端"测试连接"按钮快速校验 Token 与路由
    if (uid === '__health__') {
      const token = getToken(request, env, 'DOC2X');
      if (!token) {
        return jsonResponse({
          error: 'Doc2X API Token required. Provide via X-Doc2X-Key header or DOC2X_API_TOKEN env variable'
        }, 401, request, env);
      }
      
      // 验证Token有效性：向Doc2X API发送一个简单的请求
      try {
        const tokenValidationResponse = await fetch(`${DOC2X_BASE_URL}/api/v2/parse/preupload`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });
        
        if (!tokenValidationResponse.ok) {
          return jsonResponse({
            success: false,
            service: 'doc2x',
            error: 'Invalid Token',
            message: `Token validation failed: ${tokenValidationResponse.statusText}`,
            timestamp: Date.now()
          }, 401, request, env);
        }
        
        const validationData = await tokenValidationResponse.json();
        if (validationData.code !== 'success') {
          return jsonResponse({
            success: false,
            service: 'doc2x',
            error: 'Invalid Token',
            message: `Token validation failed: ${validationData.msg || 'Unknown error'}`,
            timestamp: Date.now()
          }, 401, request, env);
        }
        
        return jsonResponse({ success: true, service: 'doc2x', health: true, timestamp: Date.now() }, 200, request, env);
      } catch (error) {
        return jsonResponse({
          success: false,
          service: 'doc2x',
          error: 'Token validation error',
          message: error.message,
          timestamp: Date.now()
        }, 401, request, env);
      }
    }

    const token = getToken(request, env, 'DOC2X');
    if (!token) {
      return jsonResponse({
        error: 'Doc2X API Token required. Provide via X-Doc2X-Key header or DOC2X_API_TOKEN env variable'
      }, 401, request, env);
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
      // 返回错误码
      return jsonResponse({
        success: false,
        service: 'doc2x',
        error: statusData.code,
        message: statusData.msg || 'Unknown error'
      }, 200, request, env);
    }

    return jsonResponse({
      success: true,
      service: 'doc2x',
      ...statusData.data,
    }, 200, request, env);

  } catch (error) {
    console.error('Doc2X status error:', error);
    return jsonResponse({ error: error.message || 'Failed to get status' }, 500, request, env);
  }
}

async function handleDoc2XConvert(request, env) {
  try {
    const body = await request.json();
    const { uid, to = 'md', formula_mode = 'normal', filename, merge_cross_page_forms = false } = body;

    if (!uid) {
      return jsonResponse({ error: 'uid is required' }, 400, request, env);
    }

    const token = getToken(request, env, 'DOC2X');
    if (!token) {
      return jsonResponse({
        error: 'Doc2X API Token required. Provide via X-Doc2X-Key header or DOC2X_API_TOKEN env variable'
      }, 401, request, env);
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
      const errorText = await convertResponse.text();
      throw new Error(`Doc2X转换失败: ${errorText}`);
    }

    const convertData = await convertResponse.json();

    if (convertData.code !== 'success') {
      return jsonResponse({
        success: false,
        service: 'doc2x',
        error: convertData.code,
        message: convertData.msg || 'Convert failed'
      }, 200, request, env);
    }

    return jsonResponse({
      success: true,
      service: 'doc2x',
      ...convertData.data,
    }, 200, request, env);

  } catch (error) {
    console.error('Doc2X convert error:', error);
    return jsonResponse({ error: error.message || 'Convert failed' }, 500, request, env);
  }
}

async function handleDoc2XConvertResult(uid, env, request) {
  try {
    if (!uid) {
      return jsonResponse({ error: 'uid is required' }, 400, request, env);
    }

    const token = getToken(request, env, 'DOC2X');
    if (!token) {
      return jsonResponse({
        error: 'Doc2X API Token required. Provide via X-Doc2X-Key header or DOC2X_API_TOKEN env variable'
      }, 401, request, env);
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
      return jsonResponse({
        success: false,
        service: 'doc2x',
        error: resultData.code,
        message: resultData.msg || 'Failed to get convert result'
      }, 200, request, env);
    }

    return jsonResponse({
      success: true,
      service: 'doc2x',
      ...resultData.data,
    }, 200, request, env);

  } catch (error) {
    console.error('Doc2X convert result error:', error);
    return jsonResponse({ error: error.message || 'Failed to get convert result' }, 500, request, env);
  }
}

// ==================== 工具函数 ====================

/**
 * 获取 API Token
 * 优先级：请求头 > 环境变量
 * @param {Request} request - 请求对象
 * @param {Object} env - 环境变量
 * @param {string} service - 服务名称 ('MINERU' 或 'DOC2X')
 * @returns {string|null} - Token 或 null
 */
function getToken(request, env, service) {
  // 1. 优先从请求头获取
  const headerKey = service === 'MINERU' ? 'X-MinerU-Key' : 'X-Doc2X-Key';
  let token = request.headers.get(headerKey);
  const tokenSource = token ? 'header' : null;

  // 2. 如果请求头没有，从环境变量获取
  if (!token) {
    const envKey = service === 'MINERU' ? 'MINERU_API_TOKEN' : 'DOC2X_API_TOKEN';
    token = env[envKey];
    if (token) {
      const tokenPreview = token.length > 12
        ? `${token.substring(0, 6)}...${token.substring(token.length - 6)}`
        : token;
      console.log(`[${service}] Token: Using from environment variable (${tokenPreview})`);
    }
  } else {
    const tokenPreview = token.length > 12
      ? `${token.substring(0, 6)}...${token.substring(token.length - 6)}`
      : token;
    console.log(`[${service}] Token: Using from request header (${headerKey}) (${tokenPreview})`);
  }

  // 3. 清理可能误加的 Bearer 前缀
  if (token) {
    const originalToken = token;
    token = token.replace(/^Bearer\s+/i, '').trim();
    if (originalToken !== token) {
      console.log(`[${service}] Token: Cleaned Bearer prefix`);
    }
  }

  if (!token) {
    console.warn(`[${service}] Token: No token found in header or environment`);
  }

  return token || null;
}

function handleCORS(request, env) {
  const origin = request.headers.get('Origin') || '*';

  let allowedOrigin = '*';
  if (env.ALLOWED_ORIGINS) {
    const allowedOrigins = env.ALLOWED_ORIGINS.split(',').map(o => o.trim());
    if (allowedOrigins.includes(origin)) {
      allowedOrigin = origin;
    } else {
      return new Response(null, { status: 403 });
    }
  } else {
    allowedOrigin = origin;
  }

  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': allowedOrigin,
      'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Range, X-Auth-Key, X-MinerU-Key, X-Doc2X-Key',
      'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges',
      'Access-Control-Max-Age': '86400',
    },
  });
}

function jsonResponse(data, status, request, env) {
  const origin = request.headers.get('Origin') || '*';

  let allowedOrigin = '*';
  if (env.ALLOWED_ORIGINS) {
    const allowedOrigins = env.ALLOWED_ORIGINS.split(',').map(o => o.trim());
    if (allowedOrigins.includes(origin)) {
      allowedOrigin = origin;
    }
  } else {
    allowedOrigin = origin;
  }

  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': allowedOrigin,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Auth-Key, X-MinerU-Key, X-Doc2X-Key',
    },
  });
}

/**
 * 代理下载远端 ZIP 并返回，附带 CORS 头部
 * 支持 Range 请求以实现分片下载
 */
async function handleProxyZip(zipUrl, request, env) {
  try {
    if (!zipUrl) {
      return jsonResponse({ error: 'url is required' }, 400, request, env);
    }

    // 构建上游请求头，透传 Range 头（支持分片下载）
    const upstreamHeaders = {};
    const rangeHeader = request.headers.get('Range');
    if (rangeHeader) {
      upstreamHeaders['Range'] = rangeHeader;
      console.log('[Worker] Proxying Range request:', rangeHeader);
    }

    const resp = await fetch(zipUrl, {
      method: request.method || 'GET',
      headers: upstreamHeaders,
      redirect: 'follow'
    });

    if (!resp.ok && resp.status !== 206) {
      return jsonResponse({ error: `Upstream fetch failed: ${resp.status} ${resp.statusText}` }, 502, request, env);
    }

    // 计算允许的 Origin（与 jsonResponse 同步）
    const origin = request.headers.get('Origin') || '*';
    let allowedOrigin = '*';
    if (env.ALLOWED_ORIGINS) {
      const allowedOrigins = env.ALLOWED_ORIGINS.split(',').map(o => o.trim());
      if (allowedOrigins.includes(origin)) {
        allowedOrigin = origin;
      }
    } else {
      allowedOrigin = origin;
    }

    // 构建响应头
    const responseHeaders = {
      'Content-Type': resp.headers.get('Content-Type') || 'application/zip',
      'Access-Control-Allow-Origin': allowedOrigin,
      'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Range, X-Auth-Key, X-MinerU-Key, X-Doc2X-Key',
      'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges',
      'Cache-Control': 'no-store',
    };

    // 透传 Range 相关头部
    if (resp.headers.has('Content-Length')) {
      responseHeaders['Content-Length'] = resp.headers.get('Content-Length');
    }
    if (resp.headers.has('Content-Range')) {
      responseHeaders['Content-Range'] = resp.headers.get('Content-Range');
    }
    if (resp.headers.has('Accept-Ranges')) {
      responseHeaders['Accept-Ranges'] = resp.headers.get('Accept-Ranges');
    }

    return new Response(resp.body, {
      status: resp.status, // 保持原始状态码（200 或 206）
      headers: responseHeaders,
    });
  } catch (e) {
    console.error('Proxy zip error:', e);
    return jsonResponse({ error: e.message || 'Proxy failed' }, 500, request, env);
  }
}
