/**
 * 东方财富API封装模块
 * 统一使用JSONP方式调用东方财富API（浏览器直接请求，不受CORS限制）
 * API不可用时自动降级到模拟数据
 */
const StockAPI = (function () {

    // 东方财富API地址（浏览器端直接调用，JSONP方式）
    const CLIST_BASE = 'https://push2.eastmoney.com/api/qt/clist/get';
    const KLINE_BASE = 'https://push2his.eastmoney.com/api/qt/stock/kline/get';

    // 东方财富API公共参数
    const UT = 'b2884a393a59ad64002292a3e90d46a5';

    // 是否使用模拟数据（API不可用时自动启用）
    let useMock = false;

    /**
     * 通用请求方法：JSONP优先，fetch降级，模拟数据兜底
     * @param {string} url - 完整请求URL
     * @param {number} timeout - 超时时间(ms)
     * @returns {Promise<any>} API响应数据
     */
    async function request(url, timeout = 15000) {
        if (useMock) {
            return mockRequest(url);
        }

        try {
            // 优先使用JSONP（东方财富API支持cb参数，浏览器直接请求不受CORS限制）
            return await jsonp(url, timeout);
        } catch (jsonpError) {
            console.log('JSONP失败，尝试fetch:', jsonpError.message);
            try {
                const resp = await fetchWithTimeout(url, timeout);
                if (!resp.ok) {
                    throw new Error(`API请求失败(HTTP ${resp.status})`);
                }
                return await resp.json();
            } catch (fetchError) {
                // JSONP和fetch都失败，切换到模拟模式
                console.warn('API请求失败，切换到模拟数据模式:', fetchError.message);
                useMock = true;
                return mockRequest(url);
            }
        }
    }

    /**
     * 带超时的fetch请求
     */
    function fetchWithTimeout(url, timeout) {
        return Promise.race([
            fetch(url),
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error('fetch超时')), timeout)
            )
        ]);
    }

    /**
     * JSONP请求封装
     * 东方财富API支持cb参数，回调名需以jQuery开头
     */
    function jsonp(url, timeout = 15000) {
        return new Promise((resolve, reject) => {
            // 东方财富API要求回调名以jQuery开头
            const callbackName = 'jQuery_' + Date.now() + '_' + Math.floor(Math.random() * 10000);
            const script = document.createElement('script');
            const timer = setTimeout(() => {
                cleanup();
                reject(new Error('JSONP请求超时'));
            }, timeout);

            function cleanup() {
                clearTimeout(timer);
                delete window[callbackName];
                if (script.parentNode) {
                    script.parentNode.removeChild(script);
                }
            }

            window[callbackName] = function (data) {
                cleanup();
                resolve(data);
            };

            const separator = url.includes('?') ? '&' : '?';
            script.src = url + separator + 'cb=' + callbackName;
            script.onerror = function () {
                cleanup();
                reject(new Error('JSONP脚本加载失败'));
            };
            document.head.appendChild(script);
        });
    }

    // ===== 模拟数据 =====

    /**
     * 模拟请求（API不可用时使用）
     */
    function mockRequest(url) {
        if (url.includes('clist/get')) {
            return Promise.resolve(generateMockStockList());
        }
        if (url.includes('kline/get')) {
            const secid = extractParam(url, 'secid') || '0.300999';
            return Promise.resolve(generateMockKline(secid));
        }
        return Promise.resolve({});
    }

    /**
     * 从URL中提取参数值
     */
    function extractParam(url, param) {
        const match = url.match(new RegExp(param + '=([^&]+)'));
        return match ? match[1] : null;
    }

    /**
     * 生成模拟涨幅排行数据
     */
    function generateMockStockList() {
        const mockStocks = [
            { code: '301323', name: '新莱福', market: 0 },
            { code: '300377', name: '赢时胜', market: 0 },
            { code: '688163', name: '赛伦生物', market: 1 },
            { code: '301176', name: '逸豪新材', market: 0 },
            { code: '688010', name: '福光股份', market: 1 },
            { code: '000001', name: '平安银行', market: 0 },
            { code: '600519', name: '贵州茅台', market: 1 },
            { code: '300048', name: '金力泰', market: 0 },
            { code: '688088', name: '虹软科技', market: 1 },
            { code: '301269', name: '华大九天', market: 0 },
            { code: '300750', name: '宁德时代', market: 0 },
            { code: '688981', name: '中芯国际', market: 1 },
            { code: '000651', name: '格力电器', market: 0 },
            { code: '600036', name: '招商银行', market: 1 },
            { code: '300760', name: '迈瑞医疗', market: 0 },
        ];

        return {
            data: {
                total: mockStocks.length,
                diff: mockStocks.map((s, i) => ({
                    f12: s.code,
                    f14: s.name,
                    f2: (20 + Math.random() * 80).toFixed(2),
                    f3: (20 - i * 1.2 + Math.random() * 2).toFixed(2),
                    f13: s.market
                }))
            }
        };
    }

    /**
     * 生成模拟K线数据
     * 模拟接近异动线的股票，部分涨幅接近但未达到阈值
     */
    function generateMockKline(secid) {
        const klines = [];
        let price = 10 + Math.random() * 30;

        // 随机决定该股票的上涨力度
        const intensity = Math.random();
        let trend;
        if (intensity < 0.2) {
            trend = 0.06;
        } else if (intensity < 0.4) {
            trend = 0.035;
        } else if (intensity < 0.7) {
            trend = 0.02;
        } else {
            trend = 0.005;
        }

        for (let i = 40; i >= 1; i--) {
            const date = new Date();
            date.setDate(date.getDate() - i);
            if (date.getDay() === 0 || date.getDay() === 6) continue;

            const change = (Math.random() - 0.35) * 0.1 + trend;
            price = price * (1 + change);

            const open = price * (1 + (Math.random() - 0.5) * 0.03);
            const close = price;
            const high = Math.max(open, close) * (1 + Math.random() * 0.02);
            const low = Math.min(open, close) * (1 - Math.random() * 0.02);
            const volume = Math.floor(10000 + Math.random() * 50000);
            const amount = Math.floor(volume * price);
            const amplitude = ((high - low) / low * 100).toFixed(2);
            const changePercent = (change * 100).toFixed(2);
            const changeAmount = (close - open).toFixed(2);
            const turnover = (Math.random() * 5).toFixed(2);

            const dateStr = date.toISOString().split('T')[0];
            klines.push([
                dateStr,
                open.toFixed(2), close.toFixed(2),
                high.toFixed(2), low.toFixed(2),
                volume, amount,
                amplitude, changePercent, changeAmount, turnover
            ].join(','));
        }

        return {
            data: {
                klines: klines
            }
        };
    }

    // ===== 实际API方法 =====

    /**
     * 获取A股涨幅排行榜
     * @param {number} topN - 获取前N只股票
     * @returns {Promise<Array>} 股票列表
     */
    async function getTopGainStocks(topN = 100) {
        const url = CLIST_BASE +
            '?pn=1' +
            '&pz=' + topN +
            '&po=1' +
            '&np=1' +
            '&ut=' + UT +
            '&fltt=2' +
            '&invt=2' +
            '&fid=f3' +
            '&fs=m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23' +
            '&fields=f12,f14,f2,f3,f13' +
            '&_t=' + Date.now();

        let data = await request(url);
        // 数据结构校验失败时，尝试降级到模拟数据
        if (!data || !data.data || !data.data.diff) {
            if (!useMock) {
                console.warn('API返回数据格式异常，切换到模拟数据模式');
                useMock = true;
                data = await mockRequest(url);
            }
            if (!data || !data.data || !data.data.diff) {
                throw new Error('获取涨幅排行数据失败');
            }
        }

        return data.data.diff.map((item, index) => ({
            rank: index + 1,
            code: item.f12,
            name: item.f14,
            price: parseFloat(item.f2),
            changePercent: parseFloat(item.f3),
            market: item.f13,
            secid: item.f13 + '.' + item.f12
        }));
    }

    /**
     * 获取个股日K线数据（前复权）
     * @param {string} secid - 股票ID (格式: 市场编号.股票代码)
     * @param {number} limit - 获取K线数量
     * @returns {Promise<Array>} K线数据数组
     */
    async function getStockKline(secid, limit = 40) {
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

        const data = await request(url);
        if (!data || !data.data || !data.data.klines) {
            return [];
        }

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
     * 批量获取K线数据（带并发控制）
     * @param {Array} secids - 股票ID数组
     * @param {number} concurrency - 最大并发数
     * @param {Function} onProgress - 进度回调 (completed, total)
     * @returns {Promise<Map>} secid -> klines 映射
     */
    async function batchGetKline(secids, concurrency = 6, onProgress = null) {
        const result = new Map();
        let completed = 0;
        const total = secids.length;

        for (let i = 0; i < total; i += concurrency) {
            const batch = secids.slice(i, i + concurrency);
            const promises = batch.map(async (secid) => {
                try {
                    const klines = await getStockKline(secid);
                    result.set(secid, klines);
                } catch (e) {
                    console.warn('获取K线失败:', secid, e.message);
                    result.set(secid, []);
                }
                completed++;
                if (onProgress) {
                    onProgress(completed, total);
                }
            });
            await Promise.all(promises);
        }

        return result;
    }

    /**
     * 检查是否正在使用模拟数据
     * @returns {boolean}
     */
    function isUsingMock() {
        return useMock;
    }

    /**
     * 重置模拟模式，重新尝试使用真实API
     */
    function resetMock() {
        useMock = false;
    }

    return {
        getTopGainStocks,
        getStockKline,
        batchGetKline,
        isUsingMock,
        resetMock
    };
})();
