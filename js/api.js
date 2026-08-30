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

    // 全A股筛选条件（含北交所，用于自选股搜索的全量列表）
    const FS_ALL_SHARE = 'm:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23,m:0+t:81+s:2048';

    // 涨停池接口（东方财富push2ex）
    const ZTPOOL_BASE = 'https://push2ex.eastmoney.com/getTopicZTPool';

    // 同花顺涨停原因接口
    const THS_ZTPOOL_BASE = 'https://data.10jqka.com.cn/dataapi/limit_up/limit_up_pool';

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
    let requestInterval = 2000; // 每个请求之间的间隔(ms)，默认2000ms，避免东方财富限流
    let lastRequestTime = 0; // 上次请求时间戳
    let proxyBackoffUntil = 0; // 代理退避到何时（全局冷却）

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
     * 代理失败时自动切换备用代理重试，每次重试增加指数退避延迟
     */
    async function request(url, timeout = 15000) {
        const maxAttempts = 1 + PROXY_CONFIG.backupUrls.length;
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            try {
                const data = await proxyRequest(url, timeout);
                PROXY_CONFIG.proxyFailCount = 0;
                return data;
            } catch (proxyError) {
                PROXY_CONFIG.proxyFailCount++;
                console.warn(`代理请求失败(第${attempt + 1}次):`, proxyError.message);

                // 指数退避延迟（第1次失败等2秒，第2次等4秒，第3次等8秒...）
                if (attempt < maxAttempts - 1) {
                    const backoffMs = Math.min(2000 * Math.pow(2, attempt), 10000);
                    console.log(`  退避 ${backoffMs}ms 后切换代理重试...`);
                    await new Promise(r => setTimeout(r, backoffMs));
                }

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
        // 1. 检查是否需要全局退避（代理频繁失败后的冷却）
        const now = Date.now();
        if (proxyBackoffUntil > now) {
            const waitMs = proxyBackoffUntil - now;
            console.log(`代理退避中，等待 ${waitMs}ms...`);
            await new Promise(r => setTimeout(r, waitMs));
        }

        // 2. 强制请求间隔（确保每次请求之间有足够间隔）
        if (lastRequestTime > 0) {
            const elapsed = Date.now() - lastRequestTime;
            // 基础间隔 + 随机抖动（±30%）
            const jitter = Math.floor(requestInterval * 0.3 * (Math.random() - 0.5));
            const minGap = requestInterval + jitter;
            if (elapsed < minGap) {
                const waitMs = minGap - elapsed;
                await new Promise(r => setTimeout(r, waitMs));
            }
        }
        lastRequestTime = Date.now();

        const proxyUrl = getCurrentProxyUrl();
        if (!proxyUrl) throw new Error('无可用代理');

        const base = proxyUrl.replace(/\/+$/, '');
        const fullUrl = base + '/proxy?target=' + encodeURIComponent(targetUrl);

        const headers = { 'Accept': 'application/json' };
        if (PROXY_CONFIG.token) headers['X-Proxy-Token'] = PROXY_CONFIG.token;

        const resp = await fetchWithTimeout(fullUrl, timeout, headers);
        if (!resp.ok) {
            // HTTP 502/503/429：代理端限流或失败，增加全局退避
            if (resp.status === 502 || resp.status === 503 || resp.status === 429) {
                proxyBackoffUntil = Date.now() + 5000; // 全局冷却5秒
            }
            throw new Error(`代理返回HTTP ${resp.status}`);
        }

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
     * 读取当日缓存（跨天自动失效）
     * @param {string} key - 缓存key
     * @returns {*} 缓存数据，过期或不存在返回null
     */
    function getDailyCache(key) {
        try {
            const raw = localStorage.getItem(key);
            if (!raw) return null;
            const cache = JSON.parse(raw);
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
     * 写入当日缓存
     * @param {string} key - 缓存key
     * @param {*} data - 缓存数据（需可JSON序列化）
     */
    function setDailyCache(key, data) {
        try {
            localStorage.setItem(key, JSON.stringify({
                data: data,
                timestamp: Date.now()
            }));
        } catch (e) {
            console.warn('当日缓存写入失败:', key, e.message);
        }
    }

    /**
     * 从localStorage读取K线缓存
     * @param {string} secid - 股票ID
     * @param {number} minLimit - 需要的最小K线数量（缓存不足视为失效）
     * @returns {Array|null} 缓存的K线数据，过期或不存在返回null
     */
    function getKlineCache(secid, minLimit) {
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

            // 缓存条数检查：缓存时的请求limit小于所需limit时视为失效（需重新拉取更多数据）
            // 注意：若实际返回条数少于请求limit（新股/停牌），说明已取到全部可用数据，视为有效
            if (minLimit) {
                const reqLimit = cache.limit || 40; // 旧格式缓存无limit字段，视为40
                if (reqLimit < minLimit && cache.data.length >= reqLimit) {
                    return null;
                }
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
     * @param {number} limit - 请求时的K线数量limit
     */
    function setKlineCache(secid, klines, limit) {
        try {
            const key = KLINE_CACHE_PREFIX + secid;
            const cache = {
                data: klines,
                timestamp: Date.now(),
                limit: limit || 40
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
        // 尝试从缓存读取（缓存条数不足时自动失效重新拉取）
        const cached = getKlineCache(secid, limit);
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
            // 写入缓存（记录请求limit）
            setKlineCache(secid, klines, limit);
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
     * @param {number} limit - 每只股票获取的K线数量（默认40，自选浏览视图需260计算今年来涨幅）
     * @returns {Promise<Map>} secid -> klines 映射
     */
    async function batchGetKline(secids, concurrency = 2, onProgress = null, limit = 40) {
        const result = new Map();
        const total = secids.length;
        let completed = 0;

        for (let i = 0; i < total; i++) {
            try {
                const klines = await getStockKline(secids[i], limit);
                result.set(secids[i], klines);
            } catch (e) {
                console.warn('获取K线失败:', secids[i], e.message);
                result.set(secids[i], []);
            }
            completed++;
            if (onProgress) onProgress(completed, total);
            // 注意：请求间隔已在 proxyRequest 中统一控制
        }

        return result;
    }

    // ===== 自选股相关API =====

    /** 数值安全转换（东财接口停牌/无数据时返回'-'） */
    function toNum(v) {
        const n = parseFloat(v);
        return isNaN(n) ? null : n;
    }

    /**
     * 批量获取实时行情（东方财富ulist.np接口）
     * @param {Array<string>} secids - 股票secid数组（如 ['0.000017', '1.600371']），自动按50个分批
     * @returns {Promise<Map>} code -> 行情对象 映射
     *   行情对象: { code, name, price, changePercent, amount, turnover, volumeRatio,
     *              open, prevClose, totalMV, floatMV, mainNet }
     */
    async function getQuoteBatch(secids) {
        const result = new Map();
        if (!secids || secids.length === 0) return result;

        // 分批请求（每批最多50个，避免URL过长）
        const CHUNK_SIZE = 50;
        for (let i = 0; i < secids.length; i += CHUNK_SIZE) {
            const chunk = secids.slice(i, i + CHUNK_SIZE);
            const url = 'https://push2.eastmoney.com/api/qt/ulist.np/get' +
                '?fltt=2&invt=2' +
                '&fields=f2,f3,f6,f8,f10,f12,f13,f14,f17,f18,f20,f21,f62' +
                '&secids=' + chunk.join(',') +
                '&_t=' + Date.now();

            try {
                const data = await request(url);
                const diff = data && data.data && data.data.diff;
                if (!diff) continue;

                diff.forEach(item => {
                    const code = String(item.f12);
                    result.set(code, {
                        code: code,
                        name: item.f14,
                        price: toNum(item.f2),               // 最新价
                        changePercent: toNum(item.f3),       // 涨跌幅%
                        amount: toNum(item.f6),              // 成交额(元)
                        turnover: toNum(item.f8),            // 换手率%
                        volumeRatio: toNum(item.f10),        // 量比
                        open: toNum(item.f17),               // 今开
                        prevClose: toNum(item.f18),          // 昨收
                        totalMV: toNum(item.f20),            // 总市值(元)
                        floatMV: toNum(item.f21),            // 流通市值(元)
                        mainNet: toNum(item.f62)             // 主力净额(元)
                    });
                });
            } catch (error) {
                console.warn('批量行情请求失败(批次' + (i / CHUNK_SIZE + 1) + '):', error.message);
            }
        }
        return result;
    }

    /**
     * 获取指定日期涨停池（东方财富push2ex接口，当日缓存）
     * @param {string} dateStr - 日期 YYYYMMDD
     * @returns {Promise<Map>} code -> { code, name, fbt, lbt, lbc, zbc, zttj, hybk }
     *   fbt:首次封板时间(HHMMSS数字) lbt:最后封板时间 lbc:连板数 zbc:炸板次数
     *   zttj:{days,ct}涨停统计(几天几板) hybk:所属行业
     */
    async function getZTPool(dateStr) {
        const cacheKey = 'unusual_ztpool_' + dateStr;
        const cached = getDailyCache(cacheKey);
        if (cached) {
            return new Map(cached.map(item => [item.code, item]));
        }

        const url = ZTPOOL_BASE +
            '?ut=7eea3edcaed734bea9cbfc24409ed989' +
            '&dpt=wz.ztzt' +
            '&Pageindex=0&Pagesize=1000' +
            '&sort=fbt%3Aasc' +
            '&date=' + dateStr +
            '&_=' + Date.now();

        const data = await request(url);
        const list = [];
        if (data && data.data && data.data.pool) {
            data.data.pool.forEach(item => {
                list.push({
                    code: String(item.c),
                    name: item.n,
                    fbt: item.fbt,
                    lbt: item.lbt,
                    lbc: item.lbc,
                    zbc: item.zbc,
                    zttj: item.zttj,
                    hybk: item.hybk
                });
            });
        }
        setDailyCache(cacheKey, list);
        return new Map(list.map(item => [item.code, item]));
    }

    /**
     * 获取指定日期涨停原因（同花顺dataapi接口，当日缓存，失败降级返回空Map）
     * 注：东财涨停池无涨停原因字段，此接口走代理访问同花顺，可能因反爬失败
     * @param {string} dateStr - 日期 YYYYMMDD
     * @returns {Promise<Map>} code -> { code, name, reason, firstTime }
     */
    async function getTHSZTReason(dateStr) {
        const cacheKey = 'unusual_ths_zt_' + dateStr;
        const cached = getDailyCache(cacheKey);
        if (cached) {
            return new Map(cached.map(item => [item.code, item]));
        }

        const url = THS_ZTPOOL_BASE +
            '?page=1&limit=300' +
            '&order=turnaround&sort=desc' +
            '&date=' + dateStr +
            '&_=' + Date.now();

        const list = [];
        try {
            const data = await request(url);
            // 同花顺返回格式兼容：{data:{info:[...]}} 或 {data:{list:[...]}}
            const info = data && data.data && (data.data.info || data.data.list);
            if (Array.isArray(info)) {
                info.forEach(item => {
                    list.push({
                        code: String(item.code || ''),
                        name: item.name || '',
                        reason: item.reason_type || item.reason || '',
                        firstTime: item.first_limit_up_time || ''
                    });
                });
            }
            setDailyCache(cacheKey, list);
        } catch (error) {
            // 失败不缓存（避免瞬时故障影响全天），降级返回空
            console.warn('同花顺涨停原因获取失败(降级显示--):', error.message);
        }
        return new Map(list.map(item => [item.code, item]));
    }

    /**
     * 获取全A股列表（用于自选股搜索，含北交所，当日缓存）
     * @param {Function} onProgress - 进度回调 (loadedPages)
     * @returns {Promise<Array>} [{code, market, name}]
     */
    async function getAllStockList(onProgress) {
        const cacheKey = 'unusual_all_stocks';
        const cached = getDailyCache(cacheKey);
        if (cached && cached.length > 0) return cached;

        const result = [];
        const pageSize = 500;
        const maxPages = 20; // 500*20=10000，覆盖全A股足够

        for (let page = 1; page <= maxPages; page++) {
            const url = CLIST_BASE +
                '?pn=' + page + '&pz=' + pageSize + '&po=0&np=1' +
                '&ut=' + UT +
                '&fltt=2&invt=2' +
                '&fid=f12' +
                '&fs=' + encodeURIComponent(FS_ALL_SHARE) +
                '&fields=f12,f13,f14' +
                '&_t=' + Date.now();

            const data = await request(url);
            const diff = data && data.data && data.data.diff;
            if (!diff || diff.length === 0) break;

            diff.forEach(item => {
                if (item.f12 !== undefined && item.f13 !== undefined) {
                    result.push({
                        code: String(item.f12),
                        market: item.f13,
                        name: item.f14 || ''
                    });
                }
            });

            if (onProgress) onProgress(page);
            if (diff.length < pageSize) break; // 最后一页
        }

        if (result.length > 0) {
            setDailyCache(cacheKey, result);
            console.log('全A股列表加载完成:', result.length + '只');
        }
        return result;
    }

    /**
     * 仅清除K线缓存（自选股强制刷新时使用，不影响市场行情结果缓存）
     */
    function clearKlineCache() {
        try {
            const keysToRemove = [];
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key && key.startsWith(KLINE_CACHE_PREFIX)) {
                    keysToRemove.push(key);
                }
            }
            keysToRemove.forEach(key => localStorage.removeItem(key));
            console.log('已清除' + keysToRemove.length + '条K线缓存');
        } catch (e) {
            console.warn('清除K线缓存失败:', e.message);
        }
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
        // 北证：8/4/92开头（92为北证2024年新增代码段，暂用上证A股指数）
        if (code.startsWith('8') || code.startsWith('4') || code.startsWith('92')) return INDEX_MAP['sh_main'];
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
                // 注意：请求间隔已在 proxyRequest 中统一控制
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
        requestInterval = Math.max(500, Math.min(10000, parseInt(ms) || 2000));
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
        clearKlineCache,
        getResultCache,
        setResultCache,
        // ===== 自选股相关 =====
        getQuoteBatch,
        getZTPool,
        getTHSZTReason,
        getAllStockList
    };
})();
