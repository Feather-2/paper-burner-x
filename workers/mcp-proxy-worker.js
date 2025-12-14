/**
 * Paper-Burner MCP Worker
 *
 * Cloudflare Worker 作为 MCP 搜索和内容获取的后端代理
 * 解决浏览器 CORS 限制问题
 *
 * 部署步骤：
 * 1. 在 Cloudflare Dashboard 创建 Worker
 * 2. 复制此代码到 Worker 编辑器
 * 3. 部署并获取 Worker URL（如 https://mcp-proxy.xxx.workers.dev）
 * 4. 在 paper-burner 配置中设置 workerEndpoint
 */

// CORS 响应头 - 允许所有来源（开发模式）
// 生产环境可以设置具体的允许域名列表
function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  };
}

// 处理 OPTIONS 预检请求
function handleOptions(request) {
  const origin = request.headers.get('Origin') || '';
  return new Response(null, {
    status: 204,
    headers: corsHeaders(origin),
  });
}

// JSON 响应
function jsonResponse(data, status = 200, origin = '') {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders(origin),
    },
  });
}

// 错误响应
function errorResponse(message, status = 500, origin = '') {
  return jsonResponse({ success: false, error: message }, status, origin);
}

// 提取 HTML 文本
function extractTextFromHtml(html) {
  let text = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
    .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&#(\d+);/gi, (_, code) => String.fromCharCode(parseInt(code, 10)))
    .replace(/\s+/g, ' ')
    .trim();
  return text;
}

// 提取页面标题
function extractTitle(html) {
  const match = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  return match ? extractTextFromHtml(match[1]).trim() : '';
}

// 提取 meta description
function extractMetaDescription(html) {
  const match = html.match(/<meta\s+name=["']description["']\s+content=["']([^"']*)["']/i) ||
                html.match(/<meta\s+content=["']([^"']*)["']\s+name=["']description["']/i);
  return match ? match[1].trim() : '';
}

// 解析 DuckDuckGo HTML 搜索结果
// 参考 duckduckgo-mcp-server 的实现
function parseDuckDuckGoResults(html) {
  const results = [];
  const seen = new Set();

  // 方法1: 匹配 .result 块，提取 result__a 链接和 result__snippet
  // 正则匹配每个结果块
  const resultBlockPattern = /<div[^>]*class="[^"]*\bresult\b[^"]*"[^>]*>([\s\S]*?)(?=<div[^>]*class="[^"]*\bresult\b|<\/body>|$)/gi;

  let blockMatch;
  while ((blockMatch = resultBlockPattern.exec(html)) !== null) {
    const block = blockMatch[1];

    // 跳过广告结果
    if (block.includes('result--ad') || block.includes('y.js')) {
      continue;
    }

    // 从 result__a 中提取链接和标题
    const titleLinkMatch = block.match(/<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i) ||
                           block.match(/<a[^>]*href="([^"]+)"[^>]*class="[^"]*result__a[^"]*"[^>]*>([\s\S]*?)<\/a>/i);

    if (!titleLinkMatch) continue;

    let [, rawUrl, rawTitle] = titleLinkMatch;

    // 清理 DuckDuckGo 重定向 URL
    let url = rawUrl;
    if (url.startsWith('//duckduckgo.com/l/?uddg=') || url.includes('uddg=')) {
      const uddgMatch = url.match(/uddg=([^&]+)/);
      if (uddgMatch) {
        try {
          url = decodeURIComponent(uddgMatch[1]);
        } catch {}
      }
    }

    // 跳过无效 URL
    if (!url || !url.startsWith('http') || url.includes('duckduckgo.com')) {
      continue;
    }

    if (seen.has(url)) continue;
    seen.add(url);

    const title = extractTextFromHtml(rawTitle) || url;

    // 提取 snippet
    const snippetMatch = block.match(/<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/i) ||
                         block.match(/<span[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/span>/i);
    const snippet = snippetMatch ? extractTextFromHtml(snippetMatch[1]) : '';

    results.push({ url, title, snippet });

    if (results.length >= 20) break;
  }

  // 备用方法: 直接匹配 uddg= 参数
  if (results.length === 0) {
    const uddgPattern = /uddg=([^&"']+)/gi;
    let match;
    while ((match = uddgPattern.exec(html)) !== null) {
      try {
        const url = decodeURIComponent(match[1]);
        if (url.startsWith('http') && !url.includes('duckduckgo.com') && !seen.has(url)) {
          seen.add(url);
          results.push({ url, title: url, snippet: '' });
        }
      } catch {}
      if (results.length >= 20) break;
    }
  }

  return results;
}

// 搜索处理
async function handleSearch(request, origin) {
  try {
    const { query, domain, time_range, limit = 10, debug = false, engine = 'auto' } = await request.json();

    if (!query || typeof query !== 'string') {
      return errorResponse('query is required', 400, origin);
    }

    // 构建搜索查询
    let q = query.trim();
    if (domain) {
      q = `site:${domain} ${q}`;
    }

    // 尝试多个搜索源
    // 目前只使用 DuckDuckGo（SearXNG 公共实例大多禁用了 JSON API）
    const searchEngines = engine === 'auto'
      ? ['duckduckgo']
      : [engine];

    let results = [];
    let usedEngine = null;
    let lastError = null;
    let debugHtml = null;
    let searxngDebug = null;

    for (const eng of searchEngines) {
      try {
        if (eng === 'searxng') {
          const searxResult = await searchViaSearXNG(q, limit, debug);
          searxngDebug = searxResult.debug;
          if (searxResult.results.length > 0) {
            results = searxResult.results;
            usedEngine = 'searxng' + (searxResult.instance ? ` (${searxResult.instance})` : '');
            break;
          }
        } else if (eng === 'duckduckgo') {
          const ddgResult = await searchViaDuckDuckGo(q, time_range, limit, debug);
          debugHtml = ddgResult.debugHtml;
          if (ddgResult.results.length > 0) {
            results = ddgResult.results;
            usedEngine = 'duckduckgo';
            break;
          }
        }
      } catch (err) {
        lastError = err.message;
      }
    }

    // 调试模式
    const debugInfo = debug ? {
      htmlLength: debugHtml?.length || 0,
      htmlPreview: debugHtml?.slice(0, 3000) || '',
      hasResultClass: debugHtml?.includes('result__') || false,
      hasUddg: debugHtml?.includes('uddg=') || false,
      usedEngine,
      triedEngines: searchEngines,
      searxng: searxngDebug,
    } : undefined;

    return jsonResponse({
      success: true,
      query: q,
      results: results.slice(0, limit),
      count: results.length,
      engine: usedEngine,
      debug: debugInfo,
    }, 200, origin);

  } catch (err) {
    return errorResponse(`Search error: ${err.message}`, 500, origin);
  }
}

// SearXNG 搜索（公共实例）
// 实例列表来自 https://searx.space/
async function searchViaSearXNG(query, limit = 10, debug = false) {
  // 公共 SearXNG 实例（按可用性和响应速度排序）
  // 来源: searx.space - 选择有 JSON API 支持且稳定的实例
  const instances = [
    // 高可用实例
    'https://search.ononoki.org',
    'https://searx.be',
    'https://search.sapti.me',
    'https://priv.au',
    'https://searx.tiekoetter.com',
    'https://search.mdosch.de',
    'https://searx.namejeff.xyz',
    'https://search.hbubli.cc',
    'https://searx.oxf.io',
    'https://search.inetol.net',
    'https://searx.rhscz.eu',
    'https://paulgo.io',
    'https://opnxng.com',
    'https://searx.work',
    'https://search.bus-hit.me',
  ];

  const debugInfo = debug ? { tried: [], errors: [] } : null;

  for (const instance of instances) {
    try {
      const params = new URLSearchParams();
      params.set('q', query);
      params.set('format', 'json');
      params.set('categories', 'general');

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);

      const response = await fetch(`${instance}/search?${params.toString()}`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/json, text/javascript, */*; q=0.01',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (debugInfo) {
        debugInfo.tried.push({ instance, status: response.status });
      }

      if (!response.ok) continue;

      const data = await response.json();
      if (data.results && data.results.length > 0) {
        return {
          results: data.results.slice(0, limit).map(r => ({
            url: r.url,
            title: r.title || r.url,
            snippet: r.content || '',
          })),
          instance,
          debug: debugInfo,
        };
      }
    } catch (err) {
      if (debugInfo) {
        debugInfo.errors.push({ instance, error: err.message });
      }
      // 继续尝试下一个实例
    }
  }

  return { results: [], debug: debugInfo };
}

// DuckDuckGo 搜索
async function searchViaDuckDuckGo(query, timeRange, limit, debug) {
  // 多个 User-Agent 轮换，降低被检测概率
  const userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
  ];

  // 尝试多个端点
  const endpoints = [
    'https://html.duckduckgo.com/html',
    'https://lite.duckduckgo.com/lite',
  ];

  let lastHtml = '';

  for (const endpoint of endpoints) {
    const ua = userAgents[Math.floor(Math.random() * userAgents.length)];

    const formData = new URLSearchParams();
    formData.set('q', query);
    formData.set('b', '');
    formData.set('kl', '');

    if (timeRange) {
      const timeMap = { day: 'd', week: 'w', month: 'm', year: 'y' };
      formData.set('df', timeMap[timeRange] || timeRange);
    }

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'User-Agent': ua,
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Referer': 'https://duckduckgo.com/',
          'Origin': 'https://duckduckgo.com',
        },
        body: formData.toString(),
      });

      if (!response.ok) continue;

      const html = await response.text();
      lastHtml = html;

      const results = parseDuckDuckGoResults(html);
      if (results.length > 0) {
        return {
          results,
          debugHtml: debug ? html : null,
        };
      }
    } catch (err) {
      // 继续尝试下一个端点
    }
  }

  return {
    results: [],
    debugHtml: debug ? lastHtml : null,
  };
}

// 内容获取处理
async function handleFetch(request, origin) {
  try {
    const { url } = await request.json();

    if (!url || typeof url !== 'string') {
      return errorResponse('url is required', 400, origin);
    }

    // 验证 URL
    let targetUrl;
    try {
      targetUrl = new URL(url);
    } catch {
      return errorResponse('Invalid URL', 400, origin);
    }

    const response = await fetch(targetUrl.href, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      },
      redirect: 'follow',
    });

    if (!response.ok) {
      return errorResponse(`Fetch failed: HTTP ${response.status}`, response.status, origin);
    }

    const contentType = response.headers.get('content-type') || '';

    // 只处理 HTML
    if (!contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
      return jsonResponse({
        success: true,
        url: targetUrl.href,
        contentType,
        extractedText: `[Non-HTML content: ${contentType}]`,
        metadata: {
          url: targetUrl.href,
          contentType,
          fetchedAt: new Date().toISOString(),
        },
      }, 200, origin);
    }

    const html = await response.text();
    const title = extractTitle(html);
    const description = extractMetaDescription(html);
    const extractedText = extractTextFromHtml(html);

    // 限制文本长度
    const maxLength = 100000;
    const truncatedText = extractedText.length > maxLength
      ? extractedText.slice(0, maxLength) + '...(truncated)'
      : extractedText;

    return jsonResponse({
      success: true,
      url: targetUrl.href,
      title,
      extractedText: truncatedText,
      metadata: {
        url: targetUrl.href,
        title,
        description,
        contentType,
        contentLength: html.length,
        extractedLength: extractedText.length,
        fetchedAt: new Date().toISOString(),
      },
    }, 200, origin);

  } catch (err) {
    return errorResponse(`Fetch error: ${err.message}`, 500, origin);
  }
}

// 健康检查
function handleHealth(origin) {
  return jsonResponse({
    success: true,
    service: 'paper-burner-mcp-worker',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  }, 200, origin);
}

// 主处理函数
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';

    // 处理 CORS 预检
    if (request.method === 'OPTIONS') {
      return handleOptions(request);
    }

    // 路由
    const path = url.pathname;

    if (path === '/health' || path === '/') {
      return handleHealth(origin);
    }

    if (path === '/search' && request.method === 'POST') {
      return handleSearch(request, origin);
    }

    if (path === '/fetch' && request.method === 'POST') {
      return handleFetch(request, origin);
    }

    return errorResponse('Not Found', 404, origin);
  },
};
