/**
 * 东方财富API封装模块
 *
 * 数据获取策略：
 * 1. 用clist API获取阶段涨幅排行（5日涨幅TOP50 + 当日涨幅TOP50）
 * 2. 合并去重后，只对少量候选股票请求K线数据
 * 3. 用K线数据精确计算10日/30日涨幅和异动触发值
 *
 * 请求方式：所有请求走代理（主代理 → 备用代理自动切换）
 * 识别结果缓存：当日生效，点击刷新可清空缓存强制刷新
 */
const StockAPI = (function () {

    // ===== 东方财富API地址 =====
    const CLIST_BASE = 'https://push2.eastmoney.com/api/qt/clist/get';
    const KLINE_BASE = 'https://push2his.eastmoney.com/api/qt/stock/kline/get';

    // 东方财富API公共参数
    const UT = 'b2884a393a59ad64002292a3e90d46a5';

    // A股市场筛选条件（沪深京A股，排除ST）
    const FS_A_SHARE = 'm:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23';

    // ===== 代理配置 =====
    const PROXY_CONFIG = {
        primaryUrl: 'https://vercel-proxy-p.vercel.app',
        backupUrls: ['https://1429314495-dxb6k8oy7q.ap-beijing.tencentscf.com'],
        token: '',
        currentProxyIndex: -1,
        proxyFailCount: 0,
        failThreshold: 3
    };

    // ===== 请求频率控制 =====
    let requestInterval = 500; // 每个请求之间的间隔(ms)，默认500ms，避免东方财富限流

    // ===== 缓存配置 =====
    const KLINE_CACHE_PREFIX = 'unusual_kline_';
    const RESULT_CACHE_KEY = 'unusual_result';
    const CACHE_TTL = 4 * 60 * 60 * 1000; // 缓存4小时（覆盖整个交易时段）

    // ===== 代理配置持久化 =====

    /** 从localStorage加载代理配置 */
    function loadProxyConfig() {
        try {
            const saved = localStorage.getItem('unusual_proxy');
            if (saved) {
                const data = JSON.parse(saved);
                if (data.primaryUrl !== undefined) PROXY_CONFIG.primaryUrl = data.primaryUrl;
                if (data.backupUrls !== undefined) PROXY_CONFIG.backupUrls = data.backupUrls;
                if (data.token !== undefined) PROXY_CONFIG.token = data.token;
            }
        } catch (e) {
            console.warn('加载代理配置失败:', e);
        }
    }

    /** 保存代理配置到localStorage */
    function saveProxyConfig() {
        try {
            localStorage.setItem('unusual_proxy', JSON.stringify({
                primaryUrl: PROXY_CONFIG.primaryUrl,
                backupUrls: PROXY_CONFIG.backupUrls,
                token: PROXY_CONFIG.token
            }));
        } catch (e) {
            console.warn('保存代理配置失败:', e);
        }
    }

    /** 获取代理配置 */
    function getProxyConfig() {
        return {
            primaryUrl: PROXY_CONFIG.primaryUrl,
            backupUrls: [...PROXY_CONFIG.backupUrls],
            token: PROXY_CONFIG.token
        };
    }

    /** 更新代理配置 */
    function setProxyConfig(config) {
        if (config.primaryUrl !== undefined) PROXY_CONFIG.primaryUrl = config.primaryUrl;
        if (config.backupUrls !== undefined) PROXY_CONFIG.backupUrls = config.backupUrls;
        if (config.token !== undefined) PROXY_CONFIG.token = config.token;
        PROXY_CONFIG.currentProxyIndex = -1;
        PROXY_CONFIG.proxyFailCount = 0;
        saveProxyConfig();
    }

    // ===== 请求方法（只走代理） =====

    /**
     * 通用请求方法（只走代理）
     * 代理失败时自动切换备用代理重试
     */
    async function request(url, timeout = 15000) {
        // 最多尝试所有代理一轮
        const maxAttempts = 1 + PROXY_CONFIG.backupUrls.length;
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            try {
                const data = await proxyRequest(url, timeout);
                PROXY_CONFIG.proxyFailCount = 0;
                return data;
            } catch (proxyError) {
                PROXY_CONFIG.proxyFailCount++;
                console.warn(`代理请求失败(第${attempt + 1}次):`, proxyError.message);
                if (PROXY_CONFIG.proxyFailCount >= PROXY_CONFIG.failThreshold) {
                    switchToNextProxy();
                }
            }
        }
        throw new Error('所有代理均请求失败');
    }

    /**
     * 通过代理发送请求
     * 代理URL格式：{proxyUrl}/proxy?target={encodedTargetUrl}
     */
    async function proxyRequest(targetUrl, timeout = 15000) {
        const proxyUrl = getCurrentProxyUrl();
        if (!proxyUrl) throw new Error('无可用代理');

        const base = proxyUrl.replace(/\/+$/, '');
        const fullUrl = base + '/proxy?target=' + encodeURIComponent(targetUrl);

        const headers = { 'Accept': 'application/json' };
        if (PROXY_CONFIG.token) headers['X-Proxy-Token'] = PROXY_CONFIG.token;

        const resp = await fetchWithTimeout(fullUrl, timeout, headers);
        if (!resp.ok) throw new Error(`代理返回HTTP ${resp.status}`);

        const data = await resp.json();
        if (data && data.error && (!data.success || data.success === false)) {
            throw new Error('代理错误: ' + (data.message || data.error));
        }
        return data;
    }

    /** 获取当前代理URL */
    function getCurrentProxyUrl() {
        const idx = PROXY_CONFIG.currentProxyIndex;
        if (idx === -1) return PROXY_CONFIG.primaryUrl;
        if (idx < PROXY_CONFIG.backupUrls.length) return PROXY_CONFIG.backupUrls[idx];
        PROXY_CONFIG.currentProxyIndex = -1;
        return PROXY_CONFIG.primaryUrl;
    }

    /** 切换到下一个代理 */
    function switchToNextProxy() {
        PROXY_CONFIG.proxyFailCount = 0;
        const nextIndex = PROXY_CONFIG.currentProxyIndex + 1;
        if (nextIndex < PROXY_CONFIG.backupUrls.length) {
            PROXY_CONFIG.currentProxyIndex = nextIndex;
            console.log(`切换到备用代理${nextIndex + 1}: ${PROXY_CONFIG.backupUrls[nextIndex]}`);
        } else {
            PROXY_CONFIG.currentProxyIndex = -1;
            console.log('所有代理均已尝试，回到主代理');
        }
    }

    /** 带超时的fetch */
    function fetchWithTimeout(url, timeout, headers = {}) {
        return Promise.race([
            fetch(url, { headers }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('请求超时')), timeout))
        ]);
    }

    // ===== 识别结果缓存 =====

    /**
     * 获取缓存的识别结果
     * @returns {Array|null} 缓存的分析结果，过期或不存在返回null
     */
    function getResultCache() {
        try {
            const raw = localStorage.getItem(RESULT_CACHE_KEY);
            if (!raw) return null;

            const cache = JSON.parse(raw);
            const now = Date.now();

            // 检查缓存是否过期
            if (now - cache.timestamp > CACHE_TTL) {
                localStorage.removeItem(RESULT_CACHE_KEY);
                return null;
            }

            // 检查是否同一天（跨天缓存失效）
            const cacheDate = new Date(cache.timestamp).toDateString();
            const today = new Date().toDateString();
            if (cacheDate !== today) {
                localStorage.removeItem(RESULT_CACHE_KEY);
                return null;
            }

            return cache.data;
        } catch (e) {
            return null;
        }
    }

    /**
     * 写入识别结果缓存
     * @param {Array} results - 分析结果数组
     */
    function setResultCache(results) {
        try {
            const cache = {
                data: results,
                timestamp: Date.now()
            };
            localStorage.setItem(RESULT_CACHE_KEY, JSON.stringify(cache));
        } catch (e) {
            console.warn('结果缓存写入失败:', e.message);
        }
    }

    /**
     * 清除所有缓存（K线缓存 + 结果缓存）
     * 点击刷新时调用
     */
    function clearAllCache() {
        try {
            // 清除K线缓存
            const keysToRemove = [];
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key && (key.startsWith(KLINE_CACHE_PREFIX) || key === RESULT_CACHE_KEY)) {
                    keysToRemove.push(key);
                }
            }
            keysToRemove.forEach(key => localStorage.removeItem(key));
            console.log('已清除' + keysToRemove.length + '条缓存');
        } catch (e) {
            console.warn('清除缓存失败:', e.message);
        }
    }

    // ===== K线缓存 =====

    /**
     * 从localStorage读取K线缓存
     * @param {string} secid - 股票ID
     * @returns {Array|null} 缓存的K线数据，过期或不存在返回null
     */
    function getKlineCache(secid) {
        try {
            const key = KLINE_CACHE_PREFIX + secid;
            const raw = localStorage.getItem(key);
            if (!raw) return null;

            const cache = JSON.parse(raw);
            const now = Date.now();

            if (now - cache.timestamp > CACHE_TTL) {
                localStorage.removeItem(key);
                return null;
            }

            // 跨天失效
            const cacheDate = new Date(cache.timestamp).toDateString();
            const today = new Date().toDateString();
            if (cacheDate !== today) {
                localStorage.removeItem(key);
                return null;
            }

            return cache.data;
        } catch (e) {
            return null;
        }
    }

    /**
     * 写入K线缓存到localStorage
     * @param {string} secid - 股票ID
     * @param {Array} klines - K线数据
     */
    function setKlineCache(secid, klines) {
        try {
            const key = KLINE_CACHE_PREFIX + secid;
            const cache = {
                data: klines,
                timestamp: Date.now()
            };
            localStorage.setItem(key, JSON.stringify(cache));
        } catch (e) {
            console.warn('K线缓存写入失败:', e.message);
        }
    }

    // ===== 业务API方法 =====

    /**
     * 获取阶段涨幅候选股票（核心优化：减少K线请求量）
     * 策略：分别获取5日涨幅TOP50和当日涨幅TOP50，合并去重
     * @param {number} topN - 每个榜单获取数量
     * @returns {Promise<Array>} 候选股票列表（含5日涨幅）
     */
    async function getCandidateStocks(topN = 50) {
        try {
            // 1. 获取5日涨幅排行 TOP50
            const gain5dUrl = CLIST_BASE +
                '?pn=1&pz=' + topN + '&po=1&np=1' +
                '&ut=' + UT +
                '&fltt=2&invt=2' +
                '&fid=f127' +  // 按5日涨幅排序
                '&fs=' + FS_A_SHARE +
                '&fields=f12,f14,f2,f3,f13,f127' +
                '&_t=' + Date.now();

            // 2. 获取当日涨幅排行 TOP50
            const todayUrl = CLIST_BASE +
                '?pn=1&pz=' + topN + '&po=1&np=1' +
                '&ut=' + UT +
                '&fltt=2&invt=2' +
                '&fid=f3' +  // 按当日涨幅排序
                '&fs=' + FS_A_SHARE +
                '&fields=f12,f14,f2,f3,f13,f127' +
                '&_t=' + Date.now();

            // 并行请求两个榜单
            const [gain5dData, todayData] = await Promise.all([
                request(gain5dUrl).catch(e => {
                    console.warn('5日涨幅排行请求失败:', e.message);
                    return null;
                }),
                request(todayUrl).catch(e => {
                    console.warn('当日涨幅排行请求失败:', e.message);
                    return null;
                })
            ]);

            // 合并去重
            const stockMap = new Map();

            // 处理5日涨幅排行
            if (gain5dData && gain5dData.data && gain5dData.data.diff) {
                gain5dData.data.diff.forEach((item, index) => {
                    const code = item.f12;
                    const gain5d = parseFloat(item.f127) || 0;
                    // 5日涨幅>15%的进入候选（放宽门槛：部分股票如莱伯泰科等涨幅较低但已接近异动线）
                    if (gain5d >= 15 && !stockMap.has(code)) {
                        stockMap.set(code, {
                            code: code,
                            name: item.f14,
                            price: parseFloat(item.f2) || 0,
                            changePercent: parseFloat(item.f3) || 0,
                            market: item.f13,
                            secid: item.f13 + '.' + code,
                            gain5d: gain5d,
                            source: '5日涨幅榜'
                        });
                    }
                });
            }

            // 处理当日涨幅排行
            if (todayData && todayData.data && todayData.data.diff) {
                todayData.data.diff.forEach((item, index) => {
                    const code = item.f12;
                    const changePct = parseFloat(item.f3) || 0;
                    const gain5d = parseFloat(item.f127) || 0;
                    // 当日涨幅>3%的也加入候选（覆盖低涨幅但已接近异动线的股票如莱伯泰科）
                if (changePct >= 3 && !stockMap.has(code)) {
                        stockMap.set(code, {
                            code: code,
                            name: item.f14,
                            price: parseFloat(item.f2) || 0,
                            changePercent: changePct,
                            market: item.f13,
                            secid: item.f13 + '.' + code,
                            gain5d: gain5d,
                            source: '当日涨幅榜'
                        });
                    }
                });
            }

            if (stockMap.size === 0) {
                console.warn('未获取到候选股票');
                return [];
            }

            const result = Array.from(stockMap.values());
            console.log(`获取候选股票: ${result.length}只（5日涨幅榜+当日涨幅榜合并去重）`);
            return result;

        } catch (error) {
            console.error('获取候选股票失败:', error.message);
            throw error;
        }
    }

    /**
     * 获取个股日K线数据（前复权），带localStorage缓存
     * @param {string} secid - 股票ID (格式: 市场编号.股票代码)
     * @param {number} limit - 获取K线数量
     * @returns {Promise<Array>} K线数据数组
     */
    async function getStockKline(secid, limit = 40) {
        // 尝试从缓存读取
        const cached = getKlineCache(secid);
        if (cached) {
            return cached;
        }

        const url = KLINE_BASE +
            '?secid=' + secid +
            '&ut=' + UT +
            '&fields1=f1,f2,f3,f4,f5,f6' +
            '&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61' +
            '&klt=101' +
            '&fqt=1' +
            '&end=20500101' +
            '&lmt=' + limit +
            '&_t=' + Date.now();

        try {
            const data = await request(url);
            if (!data || !data.data || !data.data.klines) {
                return [];
            }
            const klines = mapKlineData(data);
            // 写入缓存
            setKlineCache(secid, klines);
            return klines;
        } catch (error) {
            console.warn('获取K线失败:', secid, error.message);
            return [];
        }
    }

    /** 映射K线数据为统一格式 */
    function mapKlineData(data) {
        return data.data.klines.map(line => {
            const parts = line.split(',');
            return {
                date: parts[0],
                open: parseFloat(parts[1]),
                close: parseFloat(parts[2]),
                high: parseFloat(parts[3]),
                low: parseFloat(parts[4]),
                volume: parseFloat(parts[5]),
                amount: parseFloat(parts[6]),
                amplitude: parseFloat(parts[7]),
                changePercent: parseFloat(parts[8]),
                changeAmount: parseFloat(parts[9]),
                turnover: parseFloat(parts[10])
            };
        });
    }

    /**
     * 批量获取K线数据（逐个请求+间隔，避免东方财富限流）
     * @param {Array} secids - 股票ID数组
     * @param {number} concurrency - 并发数（实际为1，逐个请求更稳定）
     * @param {Function} onProgress - 进度回调 (completed, total)
     * @returns {Promise<Map>} secid -> klines 映射
     */
    async function batchGetKline(secids, concurrency = 2, onProgress = null) {
        const result = new Map();
        const total = secids.length;
        let completed = 0;

        for (let i = 0; i < total; i++) {
            try {
                const klines = await getStockKline(secids[i]);
                result.set(secids[i], klines);
            } catch (e) {
                console.warn('获取K线失败:', secids[i], e.message);
                result.set(secids[i], []);
            }
            completed++;
            if (onProgress) onProgress(completed, total);

            // 每个请求之间加间隔，避免触发东方财富限流
            if (i < total - 1 && requestInterval > 0) {
                await new Promise(r => setTimeout(r, requestInterval));
            }
        }

        return result;
    }

    // ===== 基准指数配置 =====
    // 不同板块对应的基准指数secid（东方财富格式：市场编号.指数代码）
    const INDEX_MAP = {
        'sh_main': '1.000002',   // 沪市主板 → 上证A股指数
        'sz_main': '0.399107',   // 深市主板 → 深证A指
        'cyb':     '0.399102',   // 创业板 → 创业板综合指数
        'kcb':     '1.000688'    // 科创板 → 科创50指数
    };

    // 指数K线缓存前缀
    const INDEX_CACHE_PREFIX = 'unusual_index_';

    /**
     * 根据股票代码判断对应的基准指数secid
     * @param {string} code - 股票代码
     * @returns {string} 基准指数secid
     */
    function getBenchmarkIndexSecid(code) {
        if (!code) return INDEX_MAP['sz_main'];
        // 创业板：30开头
        if (code.startsWith('30')) return INDEX_MAP['cyb'];
        // 科创板：68开头
        if (code.startsWith('68')) return INDEX_MAP['kcb'];
        // 北证：8/4开头（暂用上证A股指数）
        if (code.startsWith('8') || code.startsWith('4')) return INDEX_MAP['sh_main'];
        // 沪市主板：60开头
        if (code.startsWith('60')) return INDEX_MAP['sh_main'];
        // 深市主板：00开头
        if (code.startsWith('00')) return INDEX_MAP['sz_main'];
        // 默认深证A指
        return INDEX_MAP['sz_main'];
    }

    /**
     * 获取基准指数日K线数据（前复权），带localStorage缓存
     * @param {string} secid - 指数secid (如 '0.399107')
     * @param {number} limit - 获取K线数量
     * @returns {Promise<Array>} K线数据数组
     */
    async function getIndexKline(secid, limit = 40) {
        // 尝试从缓存读取
        const cached = getKlineCache(INDEX_CACHE_PREFIX + secid);
        if (cached) {
            return cached;
        }

        const url = KLINE_BASE +
            '?secid=' + secid +
            '&ut=' + UT +
            '&fields1=f1,f2,f3,f4,f5,f6' +
            '&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61' +
            '&klt=101' +
            '&fqt=1' +
            '&end=20500101' +
            '&lmt=' + limit +
            '&_t=' + Date.now();

        try {
            const data = await request(url);
            if (!data || !data.data || !data.data.klines) {
                return [];
            }
            const klines = mapKlineData(data);
            // 写入缓存（使用指数缓存前缀）
            setKlineCache(INDEX_CACHE_PREFIX + secid, klines);
            return klines;
        } catch (error) {
            console.warn('获取指数K线失败:', secid, error.message);
            return [];
        }
    }

    /**
     * 批量获取所有需要的基准指数K线数据
     * 根据候选股票列表自动识别需要哪些指数
     * @param {Array} stocks - 候选股票列表
     * @param {number} limit - K线数量
     * @returns {Promise<Map>} secid -> klines 映射（指数K线）
     */
    async function getBenchmarkIndices(stocks, limit = 40) {
        // 收集所有需要的指数secid
        const indexSecids = new Set();
        stocks.forEach(stock => {
            indexSecids.add(getBenchmarkIndexSecid(stock.code));
        });

        console.log('需要获取基准指数:', Array.from(indexSecids).join(', '));

        const indexMap = new Map();
        for (const secid of indexSecids) {
            try {
                const klines = await getIndexKline(secid, limit);
                indexMap.set(secid, klines);
                // 请求间隔
                if (requestInterval > 0) {
                    await new Promise(r => setTimeout(r, requestInterval));
                }
            } catch (e) {
                console.warn('获取指数K线失败:', secid, e.message);
                indexMap.set(secid, []);
            }
        }

        return indexMap;
    }

    /** 获取当前请求模式描述 */
    function getRequestMode() {
        const idx = PROXY_CONFIG.currentProxyIndex;
        if (idx === -1) return '代理(主)';
        return `代理(备用${idx + 1})`;
    }

    /** 获取请求间隔(ms) */
    function getRequestInterval() {
        return requestInterval;
    }

    /** 设置请求间隔(ms) */
    function setRequestInterval(ms) {
        requestInterval = Math.max(0, Math.min(5000, parseInt(ms) || 500));
    }

    // 初始化时加载代理配置
    loadProxyConfig();

    return {
        getCandidateStocks,
        getStockKline,
        batchGetKline,
        getIndexKline,
        getBenchmarkIndices,
        getBenchmarkIndexSecid,
        getRequestMode,
        getRequestInterval,
        setRequestInterval,
        getProxyConfig,
        setProxyConfig,
        clearAllCache,
        getResultCache,
        setResultCache
    };
})();
