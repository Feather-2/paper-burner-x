// js/processing/reference-doi-resolver.js
// 多源DOI解析器 - CrossRef + OpenAlex + PubMed + arXiv + Semantic Scholar

(function(global) {
    'use strict';

    /**
     * 代理配置 - 从 localStorage 读取
     */
    function getProxyConfig() {
        try {
            const config = JSON.parse(localStorage.getItem('academicSearchProxyConfig') || 'null');
            if (!config) {
                return {
                    enabled: false,
                    baseUrl: '',
                    authKey: null,
                    semanticScholarApiKey: null,
                    pubmedApiKey: null,
                    rateLimit: null
                };
            }
            return {
                enabled: config.enabled !== false,
                baseUrl: config.baseUrl || '',
                authKey: config.authKey || null,
                semanticScholarApiKey: config.semanticScholarApiKey || null,
                pubmedApiKey: config.pubmedApiKey || null,
                rateLimit: config.rateLimit || null  // 从health检测获取的速率限制信息
            };
        } catch (error) {
            console.warn('[DOIResolver] Failed to load proxy config:', error);
            return {
                enabled: false,
                baseUrl: '',
                authKey: null,
                semanticScholarApiKey: null,
                pubmedApiKey: null,
                rateLimit: null
            };
        }
    }

    /**
     * 标题规范化 - 去除特殊符号和格式
     * @param {string} title - 原始标题
     * @returns {string} 清理后的标题
     */
    function normalizeTitle(title) {
        if (!title) return '';

        let normalized = title;

        // 1. 处理同位素标记：(18)F → 18F, [(11)C] → 11C, (99m)Tc → 99mTc
        normalized = normalized.replace(/[\(\[](\d+m?)\)?\]?([A-Z][a-z]?)/g, '$1$2');

        // 2. 处理化学式和数学符号：去除多余括号
        normalized = normalized.replace(/\[([^\]]+)\]/g, '$1');
        normalized = normalized.replace(/\(([^)]{1,3})\)/g, '$1'); // 只处理短括号内容（避免误删作者名等）

        // 3. 去除多余的标点符号
        normalized = normalized.replace(/\s+([,;:.!?])/g, '$1'); // 标点前的空格
        normalized = normalized.replace(/([,;:.!?])\s*([,;:.!?])/g, '$1'); // 连续标点

        // 4. 统一空格
        normalized = normalized.replace(/\s+/g, ' ').trim();

        // 5. 去除末尾的句号（如果存在）
        normalized = normalized.replace(/\.$/, '');

        console.log(`[TitleNormalize] "${title.substring(0, 60)}..." → "${normalized.substring(0, 60)}..."`);

        return normalized;
    }

    /**
     * 获取学术搜索源配置
     */
    function getSourcesConfig() {
        try {
            const config = JSON.parse(localStorage.getItem('academicSearchSourcesConfig') || 'null');
            if (!config || !config.sources) {
                // 默认配置
                return {
                    sources: [
                        { key: 'crossref', name: 'CrossRef', enabled: true, order: 0 },
                        { key: 'openalex', name: 'OpenAlex', enabled: true, order: 1 },
                        { key: 'arxiv', name: 'arXiv', enabled: true, order: 2 },
                        { key: 'pubmed', name: 'PubMed', enabled: true, order: 3 },
                        { key: 'semanticscholar', name: 'Semantic Scholar', enabled: true, order: 4 }
                    ]
                };
            }
            return config;
        } catch (error) {
            console.warn('[DOIResolver] Failed to load sources config:', error);
            return {
                sources: [
                    { key: 'crossref', name: 'CrossRef', enabled: true, order: 0 },
                    { key: 'openalex', name: 'OpenAlex', enabled: true, order: 1 },
                    { key: 'arxiv', name: 'arXiv', enabled: true, order: 2 },
                    { key: 'pubmed', name: 'PubMed', enabled: true, order: 3 },
                    { key: 'semanticscholar', name: 'Semantic Scholar', enabled: true, order: 4 }
                ]
            };
        }
    }

    /**
     * 构建代理 URL（只对需要的服务使用代理）
     */
    function buildProxyUrl(service, path) {
        const config = getProxyConfig();

        // PubMed、Semantic Scholar 和 arXiv 需要代理
        const needsProxy = ['pubmed', 'semanticscholar', 'arxiv'];

        if (!config.enabled || !needsProxy.includes(service)) {
            return null;
        }

        return `${config.baseUrl}/api/${service}/${path}`;
    }

    /**
     * 添加代理认证头
     * @param {string} service - 服务名称（用于选择正确的 API Key）
     */
    function getProxyHeaders(service) {
        const config = getProxyConfig();
        const headers = {};

        // Auth Key（共享模式）
        if (config.authKey) {
            headers['X-Auth-Key'] = config.authKey;
        }

        // API Key 透传（透传模式）
        if (service === 'semanticscholar' && config.semanticScholarApiKey) {
            headers['X-Api-Key'] = config.semanticScholarApiKey;
        } else if (service === 'pubmed' && config.pubmedApiKey) {
            headers['X-Api-Key'] = config.pubmedApiKey;
        }

        return headers;
    }

    /**
     * CrossRef API查询
     * 免费，无需API key，覆盖140M+ DOI
     */
    class CrossRefResolver {
        constructor() {
            this.baseUrl = 'https://api.crossref.org/works';
            // CrossRef建议提供邮箱可获得更高速率限制（polite pool）
            const config = getProxyConfig();
            this.mailto = config.contactEmail || null;
        }

        /**
         * 通过标题查询DOI
         * @param {string} title - 论文标题
         * @param {Object} metadata - 可选的额外元数据（author, year等）
         * @returns {Promise<Object|null>} DOI信息
         */
        async queryByTitle(title, metadata = {}) {
            if (!title || title.length < 10) {
                return null;
            }

            try {
                // 标题规范化
                const normalizedTitle = normalizeTitle(title);

                // 构建查询URL
                const params = new URLSearchParams({
                    'query.title': normalizedTitle,
                    rows: 5 // 返回前5个结果
                });

                // 只在有邮箱时才添加mailto参数
                if (this.mailto) {
                    params.append('mailto', this.mailto);
                }

                // 如果有作者信息，添加到查询
                if (metadata.authors && metadata.authors.length > 0) {
                    params.append('query.author', metadata.authors[0]);
                }

                // CrossRef 支持 CORS，不需要代理
                const url = `${this.baseUrl}?${params.toString()}`;
                console.log('[CrossRef] Querying:', title.substring(0, 50));

                const headers = {};
                // 只在有邮箱时才设置User-Agent
                if (this.mailto) {
                    headers['User-Agent'] = `PaperBurner/1.0 (mailto:${this.mailto})`;
                }

                const response = await fetch(url, { headers });

                if (!response.ok) {
                    console.warn('[CrossRef] API error:', response.status);
                    return null;
                }

                const data = await response.json();

                if (!data.message || !data.message.items || data.message.items.length === 0) {
                    return null;
                }

                // 选择最佳匹配
                const bestMatch = this._findBestMatch(data.message.items, title, metadata);

                if (bestMatch) {
                    return this._formatResult(bestMatch);
                }

                return null;

            } catch (error) {
                console.error('[CrossRef] Query failed:', error);
                return null;
            }
        }

        /**
         * 批量查询
         * @param {Array} references - 文献列表
         * @returns {Promise<Array>} 查询结果
         */
        async batchQuery(references) {
            console.log(`[CrossRef] Batch querying ${references.length} references`);

            const results = [];

            for (let i = 0; i < references.length; i++) {
                const ref = references[i];

                const result = await this.queryByTitle(ref.title, {
                    authors: ref.authors,
                    year: ref.year
                });

                results.push({
                    original: ref,
                    resolved: result,
                    success: !!result
                });

                // CrossRef 不限制但保持礼貌，较短延迟
                if (i < references.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 400));
                }
            }

            return results;
        }

        /**
         * 查找最佳匹配结果
         */
        _findBestMatch(items, queryTitle, metadata) {
            const queryTitleLower = queryTitle.toLowerCase().trim();

            for (const item of items) {
                const itemTitle = (item.title && item.title[0]) || '';
                const itemTitleLower = itemTitle.toLowerCase().trim();

                // 计算相似度
                const similarity = this._calculateSimilarity(queryTitleLower, itemTitleLower);

                // 相似度阈值：0.8
                if (similarity >= 0.8) {
                    // 如果有年份信息，验证年份
                    if (metadata.year && item.published) {
                        const itemYear = item.published['date-parts']?.[0]?.[0];
                        if (itemYear && Math.abs(itemYear - metadata.year) > 1) {
                            continue; // 年份不匹配，跳过
                        }
                    }

                    return item;
                }
            }

            return null;
        }

        /**
         * 简单的字符串相似度计算（Levenshtein距离）
         */
        _calculateSimilarity(str1, str2) {
            const longer = str1.length > str2.length ? str1 : str2;
            const shorter = str1.length > str2.length ? str2 : str1;

            if (longer.length === 0) {
                return 1.0;
            }

            // 如果短字符串是长字符串的子串，认为高度相似
            if (longer.includes(shorter)) {
                return 0.95;
            }

            const editDistance = this._levenshteinDistance(str1, str2);
            return (longer.length - editDistance) / longer.length;
        }

        /**
         * Levenshtein距离算法
         */
        _levenshteinDistance(str1, str2) {
            const matrix = [];

            for (let i = 0; i <= str2.length; i++) {
                matrix[i] = [i];
            }

            for (let j = 0; j <= str1.length; j++) {
                matrix[0][j] = j;
            }

            for (let i = 1; i <= str2.length; i++) {
                for (let j = 1; j <= str1.length; j++) {
                    if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
                        matrix[i][j] = matrix[i - 1][j - 1];
                    } else {
                        matrix[i][j] = Math.min(
                            matrix[i - 1][j - 1] + 1,
                            matrix[i][j - 1] + 1,
                            matrix[i - 1][j] + 1
                        );
                    }
                }
            }

            return matrix[str2.length][str1.length];
        }

        /**
         * 格式化结果
         */
        _formatResult(item) {
            const authors = (item.author || []).map(a => {
                return `${a.given || ''} ${a.family || ''}`.trim();
            });

            return {
                doi: item.DOI,
                title: item.title?.[0] || null,
                authors: authors.length > 0 ? authors : null,
                year: item.published?.['date-parts']?.[0]?.[0] || null,
                journal: item['container-title']?.[0] || null,
                volume: item.volume || null,
                issue: item.issue || null,
                pages: item.page || null,
                url: item.URL || `https://doi.org/${item.DOI}`,
                publisher: item.publisher || null,
                type: item.type || null,
                abstract: item.abstract || null,
                source: 'crossref',
                confidence: 0.9
            };
        }
    }

    /**
     * OpenAlex API查询
     * 免费开放学术图谱，覆盖更广（包括预印本）
     */
    class OpenAlexResolver {
        constructor() {
            this.baseUrl = 'https://api.openalex.org/works';
            // OpenAlex建议提供邮箱可获得更高速率限制，但不强制
            // 从配置读取，如果没有则不发送mailto参数
            const config = getProxyConfig();
            this.email = config.contactEmail || null;
        }

        async queryByTitle(title, metadata = {}) {
            if (!title || title.length < 10) {
                return null;
            }

            try {
                // 标题规范化
                const normalizedTitle = normalizeTitle(title);

                const params = new URLSearchParams({
                    search: normalizedTitle
                });

                // 只在有邮箱时才添加mailto参数
                if (this.email) {
                    params.append('mailto', this.email);
                }

                // OpenAlex 支持 CORS，不需要代理
                const url = `${this.baseUrl}?${params.toString()}`;
                console.log('[OpenAlex] Querying:', title.substring(0, 50));

                const response = await fetch(url);

                if (!response.ok) {
                    console.warn('[OpenAlex] API error:', response.status);
                    return null;
                }

                const data = await response.json();

                if (!data.results || data.results.length === 0) {
                    return null;
                }

                // 选择最佳匹配
                const bestMatch = this._findBestMatch(data.results, title, metadata);

                if (bestMatch) {
                    return this._formatResult(bestMatch);
                }

                return null;

            } catch (error) {
                console.error('[OpenAlex] Query failed:', error);
                return null;
            }
        }

        _findBestMatch(results, queryTitle, metadata) {
            const queryTitleLower = queryTitle.toLowerCase().trim();

            for (const item of results) {
                const itemTitle = (item.title || '').toLowerCase().trim();

                // 简单的包含判断
                if (itemTitle.includes(queryTitleLower) || queryTitleLower.includes(itemTitle)) {
                    // 验证年份
                    if (metadata.year && item.publication_year) {
                        if (Math.abs(item.publication_year - metadata.year) > 1) {
                            continue;
                        }
                    }

                    return item;
                }
            }

            return null;
        }

        _formatResult(item) {
            const authors = (item.authorships || []).map(a => a.author?.display_name).filter(Boolean);

            return {
                doi: item.doi?.replace('https://doi.org/', '') || null,
                title: item.title || null,
                authors: authors.length > 0 ? authors : null,
                year: item.publication_year || null,
                journal: item.primary_location?.source?.display_name || null,
                url: item.doi || item.id || null,
                openAccessUrl: item.open_access?.oa_url || null,
                citationCount: item.cited_by_count || 0,
                abstract: item.abstract_inverted_index ? this._reconstructAbstract(item.abstract_inverted_index) : null,
                source: 'openalex',
                confidence: 0.85
            };
        }

        /**
         * 重建摘要（OpenAlex使用倒排索引存储摘要）
         */
        _reconstructAbstract(invertedIndex) {
            try {
                const words = [];
                for (const [word, positions] of Object.entries(invertedIndex)) {
                    positions.forEach(pos => {
                        words[pos] = word;
                    });
                }
                return words.join(' ');
            } catch (error) {
                return null;
            }
        }

        /**
         * 批量查询
         * @param {Array} references - 文献列表
         * @returns {Promise<Array>} 查询结果
         */
        async batchQuery(references) {
            console.log(`[OpenAlex] Batch querying ${references.length} references`);

            const results = [];

            for (let i = 0; i < references.length; i++) {
                const ref = references[i];

                const result = await this.queryByTitle(ref.title, {
                    authors: ref.authors,
                    year: ref.year
                });

                results.push({
                    original: ref,
                    resolved: result,
                    success: !!result
                });

                // OpenAlex Polite Pool: 10 req/s，留余量使用较短延迟
                if (i < references.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 300));
                }
            }

            return results;
        }
    }

    /**
     * Semantic Scholar API查询
     * 学术搜索引擎，支持批量查询
     */
    class SemanticScholarResolver {
        constructor() {
            this.baseUrl = 'https://api.semanticscholar.org/graph/v1';
            this.batchUrl = 'https://api.semanticscholar.org/graph/v1/paper/batch';
        }

        async queryByTitle(title, metadata = {}) {
            if (!title || title.length < 10) {
                return null;
            }

            try {
                // 标题规范化
                const normalizedTitle = normalizeTitle(title);

                const params = new URLSearchParams({
                    query: normalizedTitle,
                    limit: 5,
                    fields: 'title,authors,year,venue,externalIds,url,citationCount,abstract'
                });

                // Semantic Scholar 需要通过代理
                const proxyUrl = buildProxyUrl('semanticscholar', `graph/v1/paper/search?${params.toString()}`);
                const url = proxyUrl || `${this.baseUrl}/paper/search?${params.toString()}`;
                const headers = proxyUrl ? getProxyHeaders('semanticscholar') : {};

                console.log('[SemanticScholar] Querying:', title.substring(0, 50), proxyUrl ? '(via proxy)' : '(direct - may fail due to CORS)');

                const response = await fetch(url, { headers });

                if (!response.ok) {
                    console.warn('[SemanticScholar] API error:', response.status);
                    return null;
                }

                const data = await response.json();

                if (!data.data || data.data.length === 0) {
                    return null;
                }

                const bestMatch = this._findBestMatch(data.data, title, metadata);

                if (bestMatch) {
                    return this._formatResult(bestMatch);
                }

                return null;

            } catch (error) {
                console.error('[SemanticScholar] Query failed:', error);
                return null;
            }
        }

        /**
         * 批量查询（一次性查询多个文献）
         */
        async batchQuery(references) {
            if (!references || references.length === 0) {
                return [];
            }

            try {
                console.log(`[SemanticScholar] Batch querying ${references.length} references`);

                // 从配置读取速率限制
                const proxyConfig = getProxyConfig();
                let delay = 1200; // 默认保守值

                if (proxyConfig.rateLimit?.services?.semanticscholar?.tps) {
                    const tps = proxyConfig.rateLimit.services.semanticscholar.tps;
                    // 计算延迟 = (1000 / TPS) * 1.5 (留50%余量)
                    delay = Math.ceil((1000 / tps) * 1.5);
                    console.log(`[SemanticScholar] Using rate limit: ${tps} TPS, delay: ${delay}ms`);
                }

                const results = [];

                // 为了遵守速率限制，串行处理每个文献
                for (let i = 0; i < references.length; i++) {
                    const ref = references[i];

                    // 在每个请求前延迟（除了第一个），确保严格遵守速率限制
                    if (i > 0) {
                        await new Promise(resolve => setTimeout(resolve, delay));
                    }

                    const result = await this.queryByTitle(ref.title, {
                        authors: ref.authors,
                        year: ref.year
                    });

                    results.push({
                        original: ref,
                        resolved: result,
                        success: !!result
                    });
                }

                return results;

            } catch (error) {
                console.error('[SemanticScholar] Batch query failed:', error);
                return [];
            }
        }

        _findBestMatch(papers, queryTitle, metadata) {
            const queryTitleLower = queryTitle.toLowerCase().trim();

            for (const paper of papers) {
                const paperTitle = (paper.title || '').toLowerCase().trim();

                if (paperTitle.includes(queryTitleLower) || queryTitleLower.includes(paperTitle)) {
                    if (metadata.year && paper.year) {
                        if (Math.abs(paper.year - metadata.year) > 1) {
                            continue;
                        }
                    }

                    return paper;
                }
            }

            return null;
        }

        _formatResult(paper) {
            const authors = (paper.authors || []).map(a => a.name).filter(Boolean);

            return {
                doi: paper.externalIds?.DOI || null,
                title: paper.title || null,
                authors: authors.length > 0 ? authors : null,
                year: paper.year || null,
                journal: paper.venue || null,
                url: paper.url || (paper.externalIds?.DOI ? `https://doi.org/${paper.externalIds.DOI}` : null),
                citationCount: paper.citationCount || 0,
                paperId: paper.paperId || null,
                abstract: paper.abstract || null,
                source: 'semanticscholar',
                confidence: 0.8
            };
        }
    }

    /**
     * PubMed API查询
     * 医学/生物学领域最全，返回PMID（可转换为DOI）
     */
    class PubMedResolver {
        constructor() {
            this.searchUrl = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi';
            this.fetchUrl = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi';
        }

        async queryByTitle(title, metadata = {}) {
            if (!title || title.length < 10) {
                return null;
            }

            try {
                // 标题规范化
                const normalizedTitle = normalizeTitle(title);

                // 截断过长的标题，避免URL过长或查询超时
                // PubMed 搜索对长标题支持不好，取前200字符通常足够匹配
                let searchTitle = normalizedTitle.length > 200 ? normalizedTitle.substring(0, 200) : normalizedTitle;

                // Step 1: 搜索获取PMID
                const searchParams = new URLSearchParams({
                    db: 'pubmed',
                    term: searchTitle,
                    retmode: 'json',
                    retmax: 5
                });

                // PubMed 需要通过代理
                const searchProxyUrl = buildProxyUrl('pubmed', `esearch.fcgi?${searchParams.toString()}`);
                const searchUrl = searchProxyUrl || `${this.searchUrl}?${searchParams.toString()}`;
                const headers = searchProxyUrl ? getProxyHeaders('pubmed') : {};

                console.log('[PubMed] Searching:', searchTitle.substring(0, 50), searchProxyUrl ? '(via proxy)' : '(direct)');

                const searchResponse = await fetch(searchUrl, { headers });
                if (!searchResponse.ok) {
                    console.warn('[PubMed] Search failed:', searchResponse.status);
                    return null;
                }

                const searchData = await searchResponse.json();
                const pmids = searchData.esearchresult?.idlist || [];

                if (pmids.length === 0) {
                    return null;
                }

                // Step 2: 获取详细信息
                const fetchParams = new URLSearchParams({
                    db: 'pubmed',
                    id: pmids.join(','),
                    retmode: 'xml'
                });

                const fetchProxyUrl = buildProxyUrl('pubmed', `efetch.fcgi?${fetchParams.toString()}`);
                const fetchUrl = fetchProxyUrl || `${this.fetchUrl}?${fetchParams.toString()}`;

                const fetchResponse = await fetch(fetchUrl, { headers });
                if (!fetchResponse.ok) {
                    return null;
                }

                const xmlText = await fetchResponse.text();
                const result = this._parseXML(xmlText, title, metadata);

                return result;

            } catch (error) {
                console.error('[PubMed] Query failed:', error);
                return null;
            }
        }

        _parseXML(xmlText, queryTitle, metadata) {
            try {
                const parser = new DOMParser();
                const xmlDoc = parser.parseFromString(xmlText, 'text/xml');

                const articles = xmlDoc.getElementsByTagName('PubmedArticle');

                for (let i = 0; i < articles.length; i++) {
                    const article = articles[i];

                    // 提取标题
                    const titleElement = article.querySelector('ArticleTitle');
                    const articleTitle = titleElement ? titleElement.textContent : '';

                    // 标题匹配
                    if (!this._isTitleMatch(articleTitle, queryTitle)) {
                        continue;
                    }

                    // 提取PMID
                    const pmidElement = article.querySelector('PMID');
                    const pmid = pmidElement ? pmidElement.textContent : null;

                    // 提取DOI
                    let doi = null;
                    const articleIds = article.querySelectorAll('ArticleId');
                    for (let id of articleIds) {
                        if (id.getAttribute('IdType') === 'doi') {
                            doi = id.textContent;
                            break;
                        }
                    }

                    // 提取作者
                    const authorElements = article.querySelectorAll('Author');
                    const authors = Array.from(authorElements).map(author => {
                        const lastName = author.querySelector('LastName')?.textContent || '';
                        const foreName = author.querySelector('ForeName')?.textContent || '';
                        return `${foreName} ${lastName}`.trim();
                    }).filter(Boolean);

                    // 提取年份
                    const yearElement = article.querySelector('PubDate Year');
                    const year = yearElement ? parseInt(yearElement.textContent) : null;

                    // 提取期刊
                    const journalElement = article.querySelector('Journal Title');
                    const journal = journalElement ? journalElement.textContent : null;

                    // 提取摘要
                    const abstractElements = article.querySelectorAll('AbstractText');
                    let abstract = null;
                    if (abstractElements.length > 0) {
                        abstract = Array.from(abstractElements)
                            .map(el => el.textContent)
                            .join(' ');
                    }

                    return {
                        doi: doi,
                        pmid: pmid,
                        title: articleTitle,
                        authors: authors.length > 0 ? authors : null,
                        year: year,
                        journal: journal,
                        abstract: abstract,
                        url: doi ? `https://doi.org/${doi}` : `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
                        source: 'pubmed',
                        confidence: 0.9
                    };
                }

                return null;

            } catch (error) {
                console.error('[PubMed] XML parsing failed:', error);
                return null;
            }
        }

        _isTitleMatch(title1, title2) {
            const t1 = title1.toLowerCase().trim();
            const t2 = title2.toLowerCase().trim();
            return t1.includes(t2) || t2.includes(t1);
        }

        /**
         * 批量查询
         * @param {Array} references - 文献列表
         * @returns {Promise<Array>} 查询结果
         */
        async batchQuery(references) {
            console.log(`[PubMed] Batch querying ${references.length} references`);

            // 从配置读取速率限制
            const proxyConfig = getProxyConfig();
            let delay = 1200; // 默认保守值

            if (proxyConfig.rateLimit?.services?.pubmed?.tps) {
                const tps = proxyConfig.rateLimit.services.pubmed.tps;
                // 计算延迟 = (1000 / TPS) * 1.5 (留50%余量)
                delay = Math.ceil((1000 / tps) * 1.5);
                console.log(`[PubMed] Using rate limit: ${tps} TPS, delay: ${delay}ms`);
            }

            const results = [];

            for (let i = 0; i < references.length; i++) {
                const ref = references[i];

                // 在每个请求前延迟（除了第一个）
                if (i > 0) {
                    await new Promise(resolve => setTimeout(resolve, delay));
                }

                const result = await this.queryByTitle(ref.title, {
                    authors: ref.authors,
                    year: ref.year
                });

                results.push({
                    original: ref,
                    resolved: result,
                    success: !!result
                });
            }

            return results;
        }
    }

    /**
     * arXiv API查询
     * 免费预印本库，主要覆盖CS/物理/数学领域
     */
    class ArXivResolver {
        constructor() {
            this.baseUrl = 'http://export.arxiv.org/api/query';
        }

        async queryByTitle(title, metadata = {}) {
            if (!title || title.length < 10) {
                return null;
            }

            try {
                // 标题规范化
                const normalizedTitle = normalizeTitle(title);

                // 构建查询
                const params = new URLSearchParams({
                    search_query: `ti:"${normalizedTitle}"`,
                    start: 0,
                    max_results: 5,
                    sortBy: 'relevance',
                    sortOrder: 'descending'
                });

                // arXiv 需要通过代理
                const proxyUrl = buildProxyUrl('arxiv', `query?${params.toString()}`);
                const url = proxyUrl || `${this.baseUrl}?${params.toString()}`;
                const headers = proxyUrl ? getProxyHeaders('arxiv') : {};

                console.log('[arXiv] Querying:', title.substring(0, 50), proxyUrl ? '(via proxy)' : '(direct - may fail due to CORS)');

                const response = await fetch(url, { headers });

                if (!response.ok) {
                    console.warn('[arXiv] API error:', response.status);
                    return null;
                }

                const xmlText = await response.text();
                const result = this._parseXML(xmlText, title, metadata);

                return result;

            } catch (error) {
                console.error('[arXiv] Query failed:', error);
                return null;
            }
        }

        _parseXML(xmlText, queryTitle, metadata) {
            try {
                const parser = new DOMParser();
                const xmlDoc = parser.parseFromString(xmlText, 'application/xml');

                // arXiv 使用 Atom 格式
                const entries = xmlDoc.getElementsByTagName('entry');

                for (let i = 0; i < entries.length; i++) {
                    const entry = entries[i];

                    // 提取标题
                    const titleElement = entry.querySelector('title');
                    const entryTitle = titleElement ? titleElement.textContent.trim() : '';

                    // 标题匹配
                    if (!this._isTitleMatch(entryTitle, queryTitle)) {
                        continue;
                    }

                    // 提取arXiv ID
                    const idElement = entry.querySelector('id');
                    const arxivId = idElement ? idElement.textContent.split('/').pop() : null;

                    // 提取DOI（如果有）
                    let doi = null;
                    const doiElement = entry.querySelector('arxiv\\:doi, doi');
                    if (doiElement) {
                        doi = doiElement.textContent.trim();
                    }

                    // 提取作者
                    const authorElements = entry.querySelectorAll('author name');
                    const authors = Array.from(authorElements).map(el => el.textContent.trim()).filter(Boolean);

                    // 提取年份
                    const publishedElement = entry.querySelector('published');
                    let year = null;
                    if (publishedElement) {
                        const dateStr = publishedElement.textContent;
                        year = parseInt(dateStr.substring(0, 4));
                    }

                    // 提取摘要
                    const summaryElement = entry.querySelector('summary');
                    const abstract = summaryElement ? summaryElement.textContent.trim() : null;

                    // 提取分类
                    const categoryElements = entry.querySelectorAll('category');
                    const categories = Array.from(categoryElements).map(el => el.getAttribute('term')).filter(Boolean);

                    // 验证年份
                    if (metadata.year && year) {
                        if (Math.abs(year - metadata.year) > 1) {
                            continue;
                        }
                    }

                    return {
                        doi: doi,
                        arxivId: arxivId,
                        title: entryTitle,
                        authors: authors.length > 0 ? authors : null,
                        year: year,
                        journal: 'arXiv',
                        categories: categories,
                        abstract: abstract,
                        url: doi ? `https://doi.org/${doi}` : `https://arxiv.org/abs/${arxivId}`,
                        pdfUrl: `https://arxiv.org/pdf/${arxivId}.pdf`,
                        source: 'arxiv',
                        confidence: 0.85
                    };
                }

                return null;

            } catch (error) {
                console.error('[arXiv] XML parsing failed:', error);
                return null;
            }
        }

        _isTitleMatch(title1, title2) {
            const t1 = title1.toLowerCase().trim();
            const t2 = title2.toLowerCase().trim();
            return t1.includes(t2) || t2.includes(t1);
        }

        /**
         * 批量查询
         * @param {Array} references - 文献列表
         * @returns {Promise<Array>} 查询结果
         */
        async batchQuery(references) {
            console.log(`[arXiv] Batch querying ${references.length} references`);

            // arXiv 使用全局速率限制（没有单独的服务级限制）
            const proxyConfig = getProxyConfig();
            let delay = 1000; // 默认值

            if (proxyConfig.rateLimit?.perIpTps) {
                const tps = proxyConfig.rateLimit.perIpTps;
                // 计算延迟 = (1000 / TPS) * 1.5 (留50%余量)
                delay = Math.ceil((1000 / tps) * 1.5);
                console.log(`[arXiv] Using rate limit: ${tps} TPS (global), delay: ${delay}ms`);
            }

            const results = [];

            for (let i = 0; i < references.length; i++) {
                const ref = references[i];

                // 在每个请求前延迟（除了第一个）
                if (i > 0) {
                    await new Promise(resolve => setTimeout(resolve, delay));
                }

                const result = await this.queryByTitle(ref.title, {
                    authors: ref.authors,
                    year: ref.year
                });

                results.push({
                    original: ref,
                    resolved: result,
                    success: !!result
                });
            }

            return results;
        }
    }

    /**
     * 多源DOI解析器 - 统一接口
     */
    class MultiSourceDOIResolver {
        constructor(options = {}) {
            this.crossref = new CrossRefResolver();
            this.openalex = new OpenAlexResolver();
            this.pubmed = new PubMedResolver();
            this.arxiv = new ArXivResolver();
            this.semanticscholar = new SemanticScholarResolver();

            // 从 localStorage 读取源配置
            const sourcesConfig = getSourcesConfig();
            const enabledSources = sourcesConfig.sources
                .filter(s => s.enabled && s.key !== 'semanticscholar')  // semanticscholar 单独处理
                .sort((a, b) => a.order - b.order)
                .map(s => s.key);

            // 可配置查询顺序（不包括semanticscholar，它用于托底）
            this.queryOrder = options.queryOrder || enabledSources;

            // 超时设置（毫秒）
            this.timeout = options.timeout || 8000;

            // 是否启用Semantic Scholar托底（从配置读取）
            const s2Source = sourcesConfig.sources.find(s => s.key === 'semanticscholar');
            this.enableSemanticScholarFallback = options.enableSemanticScholarFallback !== undefined
                ? options.enableSemanticScholarFallback
                : (s2Source ? s2Source.enabled : true);

            console.log('[DOIResolver] Initialized with funnel strategy - source order:', this.queryOrder,
                       'S2 fallback:', this.enableSemanticScholarFallback);
        }

        /**
         * 统一查询接口（多源回退）
         * @param {Object} reference - 文献信息 {title, authors, year, journal}
         * @returns {Promise<Object|null>} 包含DOI的完整元数据
         */
        async resolve(reference) {
            if (!reference || !reference.title) {
                return null;
            }

            const title = reference.title;
            const metadata = {
                authors: reference.authors,
                year: reference.year,
                journal: reference.journal
            };

            console.log(`[DOIResolver] Resolving: "${title.substring(0, 60)}..."`);

            // 按顺序尝试各个数据源
            for (const source of this.queryOrder) {
                try {
                    const resolver = this._getResolver(source);
                    if (!resolver) continue;

                    // 添加超时保护
                    const result = await Promise.race([
                        resolver.queryByTitle(title, metadata),
                        new Promise((_, reject) =>
                            setTimeout(() => reject(new Error('Timeout')), this.timeout)
                        )
                    ]);

                    if (result && result.doi) {
                        console.log(`[DOIResolver] ✓ Found via ${source}: ${result.doi}`);
                        return result;
                    }

                } catch (error) {
                    console.warn(`[DOIResolver] ${source} failed:`, error.message);
                    continue;
                }
            }

            console.log(`[DOIResolver] ✗ No DOI found for: "${title.substring(0, 60)}..."`);
            return null;
        }

        /**
         * 批量解析（漏斗形）
         * @param {Array} references - 文献列表
         * @param {Function} progressCallback - 进度回调
         * @returns {Promise<Array>} 解析结果
         */
        async batchResolve(references, progressCallback = null) {
            if (!references || references.length === 0) {
                return [];
            }

            console.log(`[DOIResolver] Batch resolving ${references.length} references using funnel strategy`);

            // 初始化所有文献为待解析状态
            const results = references.map(ref => ({
                original: ref,
                resolved: null,
                success: false
            }));

            let completed = 0;

            // 漏斗形查询：按源顺序逐个尝试，只查询失败的文献
            for (let sourceIndex = 0; sourceIndex < this.queryOrder.length; sourceIndex++) {
                const source = this.queryOrder[sourceIndex];

                // 收集还未成功的文献
                const pending = results.filter(r => !r.success);

                if (pending.length === 0) {
                    console.log(`[DOIResolver] All references resolved, skipping remaining sources`);
                    break;
                }

                console.log(`[DOIResolver] Round ${sourceIndex + 1}/${this.queryOrder.length}: ${source} - querying ${pending.length} pending references`);

                try {
                    const resolver = this._getResolver(source);
                    if (!resolver || !resolver.batchQuery) {
                        console.warn(`[DOIResolver] ${source} resolver not available or missing batchQuery`);
                        continue;
                    }

                    // 批量查询当前源
                    const sourceResults = await resolver.batchQuery(pending.map(r => r.original));

                    // 更新成功的结果
                    sourceResults.forEach(sourceResult => {
                        if (sourceResult.success) {
                            const index = results.findIndex(r => r.original === sourceResult.original);
                            if (index !== -1) {
                                results[index] = sourceResult;
                                completed++;

                                if (progressCallback) {
                                    progressCallback({
                                        completed,
                                        total: references.length,
                                        current: sourceResult.original.title,
                                        phase: 'primary'
                                    });
                                }

                                console.log(`[DOIResolver] ✓ Resolved via ${source}: "${sourceResult.original.title.substring(0, 60)}..."`);
                            }
                        }
                    });

                    const successCount = results.filter(r => r.success).length;
                    console.log(`[DOIResolver] ${source} round complete: ${successCount}/${references.length} total resolved`);

                    // 源之间延迟，避免快速切换
                    if (sourceIndex < this.queryOrder.length - 1 && pending.length > 0) {
                        await new Promise(resolve => setTimeout(resolve, 1000));
                    }

                } catch (error) {
                    console.warn(`[DOIResolver] ${source} batch query failed:`, error.message);
                    continue;
                }
            }

            let successCount = results.filter(r => r.success).length;
            console.log(`[DOIResolver] Primary phase complete: ${successCount}/${references.length} resolved`);

            // 第二阶段：使用Semantic Scholar托底查询失败的文献
            if (this.enableSemanticScholarFallback) {
                const failed = results.filter(r => !r.success);

                if (failed.length > 0) {
                    console.log(`[DOIResolver] Fallback phase: using Semantic Scholar for ${failed.length} failed references`);

                    if (progressCallback) {
                        progressCallback({
                            completed: completed,
                            total: references.length,
                            current: 'Semantic Scholar托底查询',
                            phase: 'fallback'
                        });
                    }

                    const fallbackResults = await this.semanticscholar.batchQuery(
                        failed.map(r => r.original)
                    );

                    // 更新失败的结果
                    fallbackResults.forEach(fallbackResult => {
                        if (fallbackResult.success) {
                            const index = results.findIndex(r =>
                                r.original === fallbackResult.original
                            );
                            if (index !== -1) {
                                results[index] = fallbackResult;
                                console.log(`[DOIResolver] ✓ Resolved via S2 fallback: "${fallbackResult.original.title.substring(0, 60)}..."`);
                            }
                        }
                    });

                    successCount = results.filter(r => r.success).length;
                    console.log(`[DOIResolver] Fallback complete: ${successCount}/${references.length} total resolved`);
                }
            }

            // 输出失败的文献，并为它们生成 Google 搜索链接
            const finalFailed = results.filter(r => !r.success);
            if (finalFailed.length > 0) {
                console.log(`[DOIResolver] Failed to resolve ${finalFailed.length} references, generating Google search links:`);
                finalFailed.forEach(f => {
                    console.log(`  ✗ "${f.original.title.substring(0, 60)}..."`);

                    // 为失败的文献生成 Google 搜索链接作为兜底
                    const normalizedTitle = normalizeTitle(f.original.title);
                    const searchQuery = encodeURIComponent(normalizedTitle);
                    f.resolved = {
                        doi: null,
                        title: f.original.title,
                        url: `https://www.google.com/search?q=${searchQuery}`,
                        fallback: true,
                        source: 'google-search',
                        message: '未找到DOI，请手动搜索'
                    };
                    f.success = true; // 标记为"成功"以便返回结果
                });
            }

            console.log(`[DOIResolver] Batch complete: ${results.filter(r => r.resolved && !r.resolved.fallback).length}/${references.length} resolved, ${finalFailed.length} with fallback search`);

            return results;
        }

        /**
         * 获取解析器实例
         */
        _getResolver(source) {
            const resolvers = {
                'crossref': this.crossref,
                'openalex': this.openalex,
                'pubmed': this.pubmed,
                'arxiv': this.arxiv,
                'semanticscholar': this.semanticscholar
            };
            return resolvers[source] || null;
        }

        /**
         * 设置邮箱（用于API礼貌池）
         */
        setEmail(email) {
            this.crossref.mailto = email;
            this.openalex.email = email;
        }
    }

    // 导出API
    global.DOIResolver = {
        MultiSourceDOIResolver,
        CrossRefResolver,
        OpenAlexResolver,
        PubMedResolver,
        ArXivResolver,
        SemanticScholarResolver,

        // 便捷方法
        create: (options) => new MultiSourceDOIResolver(options),

        version: '1.2.0'
    };

    console.log('[DOIResolver] Multi-source DOI resolver loaded (CrossRef + OpenAlex + arXiv + PubMed + Semantic Scholar).');

})(window);
