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
                source: 'openalex',
                confidence: 0.85
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

                    return {
                        doi: doi,
                        pmid: pmid,
                        title: articleTitle,
                        authors: authors.length > 0 ? authors : null,
                        year: year,
                        journal: journal,
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
     * 多源DOI解析器 - 统一接口
     */
    class MultiSourceDOIResolver {
        constructor(options = {}) {
            this.crossref = new CrossRefResolver();
            this.openalex = new OpenAlexResolver();
            this.pubmed = new PubMedResolver();

            // 可配置查询顺序
            this.queryOrder = options.queryOrder || ['crossref', 'openalex', 'pubmed'];

            // 超时设置（毫秒）
            this.timeout = options.timeout || 5000;
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
            const concurrency = 3;
            const chunks = [];

            for (let i = 0; i < references.length; i += concurrency) {
                chunks.push(references.slice(i, i + concurrency));
            }

            for (const chunk of chunks) {
                const chunkResults = await Promise.all(
                    chunk.map(async (ref) => {
                        const result = await this.resolve(ref);

                        completed++;
                        if (progressCallback) {
                            progressCallback({
                                completed,
                                total: references.length,
                                current: ref.title
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

            const successCount = results.filter(r => r.success).length;
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
                'pubmed': this.pubmed
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

        // 便捷方法
        create: (options) => new MultiSourceDOIResolver(options),

        version: '1.0.0'
    };

    console.log('[DOIResolver] Multi-source DOI resolver loaded (CrossRef + OpenAlex + PubMed).');

})(window);
