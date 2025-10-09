// js/processing/reference-doi-resolver.js
// 多源DOI解析器 - CrossRef + OpenAlex + PubMed

(function(global) {
    'use strict';

    /**
     * CrossRef API查询
     * 免费，无需API key，覆盖140M+ DOI
     */
    class CrossRefResolver {
        constructor() {
            this.baseUrl = 'https://api.crossref.org/works';
            this.mailto = 'your-email@example.com'; // 建议设置邮箱以获得更好的API限额
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
                // 构建查询URL
                const params = new URLSearchParams({
                    'query.title': title,
                    rows: 5, // 返回前5个结果
                    mailto: this.mailto
                });

                // 如果有作者信息，添加到查询
                if (metadata.authors && metadata.authors.length > 0) {
                    params.append('query.author', metadata.authors[0]);
                }

                const url = `${this.baseUrl}?${params.toString()}`;
                console.log('[CrossRef] Querying:', title.substring(0, 50));

                const response = await fetch(url, {
                    headers: {
                        'User-Agent': 'PaperBurner/1.0 (mailto:' + this.mailto + ')'
                    }
                });

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
            this.email = 'your-email@example.com';
        }

        async queryByTitle(title, metadata = {}) {
            if (!title || title.length < 10) {
                return null;
            }

            try {
                const params = new URLSearchParams({
                    search: title,
                    mailto: this.email
                });

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
                const params = new URLSearchParams({
                    query: title,
                    limit: 5,
                    fields: 'title,authors,year,venue,externalIds,url,citationCount,abstract'
                });

                const url = `${this.baseUrl}/paper/search?${params.toString()}`;
                console.log('[SemanticScholar] Querying:', title.substring(0, 50));

                const response = await fetch(url);

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

                const results = [];

                // Semantic Scholar批量API有限制，每次最多处理500个
                const batchSize = 100;

                for (let i = 0; i < references.length; i += batchSize) {
                    const batch = references.slice(i, i + batchSize);

                    // 对每个文献进行查询
                    const batchResults = await Promise.all(
                        batch.map(async (ref) => {
                            const result = await this.queryByTitle(ref.title, {
                                authors: ref.authors,
                                year: ref.year
                            });

                            return {
                                original: ref,
                                resolved: result,
                                success: !!result
                            };
                        })
                    );

                    results.push(...batchResults);

                    // 批次间延迟
                    if (i + batchSize < references.length) {
                        await new Promise(resolve => setTimeout(resolve, 1000));
                    }
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
                // Step 1: 搜索获取PMID
                const searchParams = new URLSearchParams({
                    db: 'pubmed',
                    term: title,
                    retmode: 'json',
                    retmax: 5
                });

                console.log('[PubMed] Searching:', title.substring(0, 50));

                const searchResponse = await fetch(`${this.searchUrl}?${searchParams.toString()}`);
                if (!searchResponse.ok) {
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

                const fetchResponse = await fetch(`${this.fetchUrl}?${fetchParams.toString()}`);
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
                // 构建查询
                const params = new URLSearchParams({
                    search_query: `ti:"${title}"`,
                    start: 0,
                    max_results: 5,
                    sortBy: 'relevance',
                    sortOrder: 'descending'
                });

                const url = `${this.baseUrl}?${params.toString()}`;
                console.log('[arXiv] Querying:', title.substring(0, 50));

                const response = await fetch(url);

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

            // 可配置查询顺序（不包括semanticscholar，它用于托底）
            this.queryOrder = options.queryOrder || ['crossref', 'openalex', 'arxiv', 'pubmed'];

            // 超时设置（毫秒）
            this.timeout = options.timeout || 5000;

            // 是否启用Semantic Scholar托底
            this.enableSemanticScholarFallback = options.enableSemanticScholarFallback !== false;
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
         * 批量解析（并发）
         * @param {Array} references - 文献列表
         * @param {Function} progressCallback - 进度回调
         * @returns {Promise<Array>} 解析结果
         */
        async batchResolve(references, progressCallback = null) {
            if (!references || references.length === 0) {
                return [];
            }

            console.log(`[DOIResolver] Batch resolving ${references.length} references`);

            const results = [];
            let completed = 0;

            // 并发限制（避免API限流）
            const concurrency = 10;
            const chunks = [];

            for (let i = 0; i < references.length; i += concurrency) {
                chunks.push(references.slice(i, i + concurrency));
            }

            // 第一阶段：使用CrossRef、OpenAlex、PubMed并发查询
            for (const chunk of chunks) {
                const chunkResults = await Promise.all(
                    chunk.map(async (ref) => {
                        const result = await this.resolve(ref);

                        completed++;
                        if (progressCallback) {
                            progressCallback({
                                completed,
                                total: references.length,
                                current: ref.title,
                                phase: 'primary'
                            });
                        }

                        return {
                            original: ref,
                            resolved: result,
                            success: !!result
                        };
                    })
                );

                results.push(...chunkResults);

                // 每批之间延迟，避免API限流
                if (chunks.indexOf(chunk) < chunks.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 500));
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
                            }
                        }
                    });

                    successCount = results.filter(r => r.success).length;
                    console.log(`[DOIResolver] Fallback complete: ${successCount}/${references.length} total resolved`);
                }
            }

            console.log(`[DOIResolver] Batch complete: ${successCount}/${references.length} resolved`);

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
