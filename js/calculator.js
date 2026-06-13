/**
 * 异动计算核心算法模块
 *
 * 异动规则：
 * - 100异动：近10个交易日收盘价涨幅累计达到100%
 * - 200异动：近30个交易日收盘价涨幅累计达到200%
 *
 * 涨幅计算方式：窗口期内最低收盘价作为基准价，
 * 当前价相对基准价的涨幅 = (当前价 - 基准价) / 基准价
 */
const UnusualCalculator = (function () {

    // 异动规则配置
    const RULES = [
        { name: '100异动', windowDays: 10, threshold: 1.0, tagClass: 'tag-badge-100' },
        { name: '200异动', windowDays: 30, threshold: 2.0, tagClass: 'tag-badge-200' }
    ];

    /**
     * 计算单条异动规则下，未来各天的触发涨幅限制
     *
     * 核心逻辑：
     * - 基准价 = 窗口期内最低收盘价
     * - 当前涨幅 = (最新收盘价 - 基准价) / 基准价
     * - 触发限制 = 阈值 - 当前涨幅（还需考虑滑动窗口效应）
     *
     * 滑动窗口效应：
     * - T+N天后，窗口最旧的N天价格会滑出窗口
     * - 如果滑出的价格中有基准价，则基准价会升高（取窗口内新的最低价）
     * - 基准价升高意味着当前涨幅减小，触发限制变大（更宽松）
     *
     * @param {Array} klines - K线数据数组（从旧到新排序），每项需含 close 字段
     * @param {Object} rule - 异动规则 { windowDays, threshold }
     * @param {number} forwardDays - 提前天数（如5表示计算T+0到T+4）
     * @returns {Object} { triggered: boolean, triggers: [T+0触发值, T+1触发值, ...], currentGain: 当前涨幅 }
     */
    function calcRuleTriggers(klines, rule, forwardDays) {
        const prices = klines.map(k => k.close);
        const windowSize = rule.windowDays;
        const threshold = rule.threshold;

        // 需要足够的历史数据
        if (prices.length < windowSize) {
            return {
                triggered: false,
                triggers: new Array(forwardDays).fill(null),
                currentGain: null
            };
        }

        // 取窗口期内的价格（最近windowSize个交易日）
        const windowPrices = prices.slice(-windowSize);
        const currentPrice = windowPrices[windowPrices.length - 1];

        // 当前窗口基准价（窗口内最低价）
        const currentBasePrice = Math.min(...windowPrices);

        // 当前涨幅
        const currentGain = (currentPrice - currentBasePrice) / currentBasePrice;

        // 是否已触发异动
        const triggered = currentGain >= threshold;

        // 计算T+0到T+(forwardDays-1)的触发限制
        const triggers = [];
        for (let dayOffset = 0; dayOffset < forwardDays; dayOffset++) {
            const triggerValue = calcDayTrigger(prices, windowSize, threshold, dayOffset);
            triggers.push(triggerValue);
        }

        return {
            triggered,
            triggers,
            currentGain
        };
    }

    /**
     * 计算未来第N天的异动触发涨幅限制
     *
     * @param {Array} allPrices - 全部历史收盘价（从旧到新）
     * @param {number} windowSize - 窗口天数
     * @param {number} threshold - 异动阈值(1.0或2.0)
     * @param {number} dayOffset - 未来第几天(0=当日)
     * @returns {number|null} 触发涨幅限制百分比，null表示数据不足，0表示已触发
     */
    function calcDayTrigger(allPrices, windowSize, threshold, dayOffset) {
        const len = allPrices.length;
        if (len < windowSize) return null;

        const currentPrice = allPrices[len - 1];

        if (dayOffset === 0) {
            // 当日：直接用当前窗口计算
            const windowPrices = allPrices.slice(-windowSize);
            const basePrice = Math.min(...windowPrices);
            const currentGain = (currentPrice - basePrice) / basePrice;

            if (currentGain >= threshold) return 0;

            // 触发所需涨幅 = (阈值 - 当前涨幅) * 100
            return Math.max(0, (threshold - currentGain) * 100);
        }

        // T+N天：考虑滑动窗口效应
        // N天后，窗口将滑过最旧的N天，加入未来N天
        // 关键：假设未来N天价格 = 当前价（保守估计，即未来价格不变）
        // 则滑动后的窗口 = [原窗口第N个到最后, 当前价重复N次]

        // 滑动后窗口的起始索引
        const slideCount = Math.min(dayOffset, windowSize);
        const newWindowStart = len - windowSize + slideCount;

        // 如果滑动后数据不足，返回null
        if (newWindowStart < 0) return null;

        // 滑动后的窗口价格 = 历史剩余部分 + 当前价(假设未来价格不变)
        const remainingPrices = allPrices.slice(newWindowStart);
        const futurePrices = new Array(dayOffset).fill(currentPrice);
        const slidWindow = [...remainingPrices, ...futurePrices].slice(-windowSize);

        // 滑动后的基准价
        const slidBasePrice = Math.min(...slidWindow);

        // 滑动后的当前涨幅（价格不变，但基准价可能变了）
        const slidGain = (currentPrice - slidBasePrice) / slidBasePrice;

        if (slidGain >= threshold) return 0;

        // 触发所需涨幅
        return Math.max(0, (threshold - slidGain) * 100);
    }

    /**
     * 计算单只股票的完整异动分析结果
     *
     * @param {Object} stock - 股票基本信息 { code, name, changePercent, secid }
     * @param {Array} klines - K线数据
     * @param {number} forwardDays - 提前天数
     * @returns {Object} 异动分析结果
     */
    function analyzeStock(stock, klines, forwardDays = 5) {
        const allRuleResults = [];

        for (const rule of RULES) {
            const calcResult = calcRuleTriggers(klines, rule, forwardDays);
            allRuleResults.push({
                ruleName: rule.name,
                tagClass: rule.tagClass,
                ...calcResult
            });
        }

        // 只保留最接近触发的那种异动（当日触发值最小的规则）
        // 如果某规则已触发(触发值=0)，优先保留未触发的规则
        // 如果都已触发或都未触发，取触发值最小的
        let dominantRule = allRuleResults[0];
        for (let i = 1; i < allRuleResults.length; i++) {
            const curr = allRuleResults[i];
            const domTrigger = dominantRule.triggers[0];
            const currTrigger = curr.triggers[0];

            if (domTrigger === null && currTrigger !== null) {
                dominantRule = curr;
            } else if (domTrigger !== null && currTrigger !== null) {
                // 都有值：优先取未触发的(>0)，再取最小的
                if (domTrigger === 0 && currTrigger > 0) {
                    dominantRule = curr;
                } else if (domTrigger > 0 && currTrigger > 0 && currTrigger < domTrigger) {
                    dominantRule = curr;
                } else if (domTrigger === 0 && currTrigger === 0) {
                    // 都已触发，保留当前
                }
            }
        }

        // 只保留最接近触发的规则
        const results = [dominantRule];

        // 判断是否有风险：当日触发值 <= 30%
        const hasRisk = dominantRule.triggers[0] !== null &&
                        dominantRule.triggers[0] > 0 &&
                        dominantRule.triggers[0] <= 30;

        // 紧急程度
        const urgency = (dominantRule.triggers[0] !== null && dominantRule.triggers[0] > 0)
            ? dominantRule.triggers[0]
            : null;

        // 获取最新日期
        const latestDate = klines.length > 0 ? klines[klines.length - 1].date : '';

        return {
            code: stock.code,
            name: stock.name,
            secid: stock.secid,
            changePercent: stock.changePercent,
            date: latestDate,
            rules: results,
            hasRisk,
            urgency
        };
    }

    /**
     * 批量分析股票异动
     *
     * @param {Array} stocks - 股票基本信息数组
     * @param {Map} klineMap - secid -> klines 映射
     * @param {number} forwardDays - 提前天数
     * @param {boolean} onlyRisk - 是否仅返回有风险的股票
     * @returns {Array} 异动分析结果数组（按紧急程度排序）
     */
    function analyzeAll(stocks, klineMap, forwardDays = 5, onlyRisk = true) {
        const analysisResults = [];

        for (const stock of stocks) {
            const klines = klineMap.get(stock.secid) || [];
            if (klines.length < 10) continue; // 数据不足，跳过

            const result = analyzeStock(stock, klines, forwardDays);

            if (onlyRisk && !result.hasRisk) continue;

            analysisResults.push(result);
        }

        // 排序：按紧急程度升序（urgency越小越紧急）
        analysisResults.sort((a, b) => {
            if (a.urgency === null && b.urgency === null) return 0;
            if (a.urgency === null) return 1;
            if (b.urgency === null) return -1;
            return a.urgency - b.urgency;
        });

        return analysisResults;
    }

    // 公开接口
    return {
        RULES,
        calcRuleTriggers,
        calcDayTrigger,
        analyzeStock,
        analyzeAll
    };
})();
