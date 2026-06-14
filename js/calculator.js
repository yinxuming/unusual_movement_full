/**
 * 异动计算核心算法模块
 *
 * 异动规则（交易所官方规则）：
 * - 100异动：连续10个交易日内日收盘价格涨跌幅偏离值累计达到+100%
 * - 200异动：连续30个交易日内日收盘价格涨跌幅偏离值累计达到+200%
 *
 * 偏离值计算（官方公式）：
 * - 偏离值 = 个股区间涨幅 - 对应基准指数区间涨幅
 * - 区间涨幅 = (区间末收盘价 / 区间初收盘价 - 1)
 * - 正向异动取区间内最低收盘价作为区间初价格（滚动窗口内找最低点）
 *
 * 基准指数映射：
 * - 沪市主板 → 上证A股指数(1.000002)
 * - 深市主板 → 深证A指(0.399107)
 * - 创业板 → 创业板综合指数(0.399102)
 * - 科创板 → 科创50指数(1.000688)
 *
 * 不同板块涨停幅度：
 * - 主板：10%
 * - 创业板/科创板：20%
 * - 北证：30%
 *
 * 可触发性过滤：
 * - T+0日：触发值 <= 当日涨停幅度 才有可能触发
 * - T+N日：触发值 <= (1+涨停幅度)^(N+1) - 1 才有可能触发
 * - 只有至少一天可触发的股票才展示
 */
const UnusualCalculator = (function () {

    // 异动规则配置
    const RULES = [
        { name: '100异动', windowDays: 10, threshold: 1.0, tagClass: 'tag-badge-100' },
        { name: '200异动', windowDays: 30, threshold: 2.0, tagClass: 'tag-badge-200' }
    ];

    // 板块涨停幅度映射（根据股票代码判断）
    const LIMIT_UP_MAP = {
        '30': 0.20,   // 创业板
        '68': 0.20,   // 科创板
        '8': 0.30,    // 北证
        '4': 0.30,    // 北证（老三板转板）
        'default': 0.10  // 主板
    };

    /**
     * 根据股票代码判断涨停幅度
     * @param {string} code - 股票代码
     * @returns {number} 涨停幅度（如0.10表示10%）
     */
    function getLimitUpRate(code) {
        if (!code) return LIMIT_UP_MAP['default'];
        if (code.startsWith('30') || code.startsWith('68')) return LIMIT_UP_MAP['30'];
        if (code.startsWith('8') || code.startsWith('4')) return LIMIT_UP_MAP['8'];
        return LIMIT_UP_MAP['default'];
    }

    /**
     * 计算T+N天的最大可能涨幅（连续涨停）
     * @param {number} limitUpRate - 涨停幅度（如0.10）
     * @param {number} days - 天数（T+0=1天，T+1=2天...）
     * @returns {number} 最大可能涨幅百分比
     */
    function getMaxPossibleGain(limitUpRate, days) {
        // 连续涨停N天的总涨幅 = (1+L)^N - 1
        return ((1 + limitUpRate) ** days - 1) * 100;
    }

    /**
     * 判断触发值在某天是否可触发（是否在涨停限制内）
     * @param {number} triggerValue - 触发值（百分比）
     * @param {number} limitUpRate - 涨停幅度
     * @param {number} dayOffset - 天数偏移（0=当日）
     * @returns {boolean}
     */
    function isTriggerAchievable(triggerValue, limitUpRate, dayOffset) {
        if (triggerValue === null || triggerValue === undefined) return false;
        if (triggerValue === 0) return true; // 已触发
        const maxGain = getMaxPossibleGain(limitUpRate, dayOffset + 1);
        return triggerValue <= maxGain;
    }

    /**
     * 计算区间偏离值（核心公式，与同花顺/交易所一致）
     *
     * 偏离值 = 个股区间涨幅 - 指数区间涨幅
     * 其中：
     * - 个股区间涨幅 = (个股当前价 / 个股区间最低价 - 1)
     * - 指数区间涨幅 = (指数当前价 / 指数对应日期的价格 - 1)
     *
     * 注意：指数的区间初价格取与个股最低价同一交易日的指数收盘价
     *
     * @param {Array} stockPrices - 个股窗口期收盘价数组
     * @param {Array} indexPrices - 指数窗口期收盘价数组（与个股同长度、同日期对齐）
     * @param {number} currentPrice - 个股当前收盘价
     * @param {number} currentIndexPrice - 指数当前收盘价
     * @returns {Object} { deviation, stockGain, indexGain, basePriceIndex, trendDays }
     */
    function calcDeviation(stockPrices, indexPrices, currentPrice, currentIndexPrice) {
        if (!stockPrices || stockPrices.length === 0) {
            return { deviation: 0, stockGain: 0, indexGain: 0, basePriceIndex: -1, trendDays: 0 };
        }

        // 如果没有指数数据，退化为纯个股涨幅计算（兼容旧逻辑）
        const hasIndexData = indexPrices && indexPrices.length > 0 && currentIndexPrice > 0;

        // 找窗口内个股最低收盘价的位置
        let minIdx = 0;
        let minPrice = stockPrices[0];
        for (let i = 1; i < stockPrices.length; i++) {
            if (stockPrices[i] < minPrice) {
                minPrice = stockPrices[i];
                minIdx = i;
            }
        }

        const basePrice = minPrice;

        // 个股区间涨幅
        const stockGain = (currentPrice - basePrice) / basePrice;

        let indexGain = 0;
        let indexBasePrice = 0;

        if (hasIndexData) {
            // 指数对应日期的收盘价（取与个股最低价同一交易日的指数收盘价）
            indexBasePrice = (indexPrices.length > minIdx && indexPrices[minIdx] > 0)
                ? indexPrices[minIdx]
                : currentIndexPrice;

            // 指数区间涨幅
            if (indexBasePrice > 0) {
                indexGain = (currentIndexPrice - indexBasePrice) / indexBasePrice;
            }
        }

        // 偏离值 = 个股涨幅 - 指数涨幅
        const deviation = stockGain - indexGain;

        // 趋势天数：从最低价到当前价经过的交易日数
        let trendDays = 0;
        for (let i = stockPrices.length - 1; i >= 0; i--) {
            if (i === minIdx) break;
            trendDays++;
        }

        return {
            deviation,
            stockGain,
            indexGain,
            basePriceIndex: minIdx,
            basePrice,
            indexBasePrice,
            trendDays
        };
    }

    /**
     * 计算单条异动规则下，未来各天的触发涨幅限制
     *
     * 核心逻辑（与同花顺一致）：
     * - 偏离值 = 个股区间涨幅 - 指数区间涨幅
     * - 触发条件：偏离值 >= 阈值
     * - 触发所需个股涨幅 = 满足偏离值>=阈值时，个股还需涨多少
     *
     * 触发值计算：
     * 设个股还需涨幅x，则：
     *   新个股涨幅 = (1 + stockGain) * (1 + x) - 1
     *   新偏离值 = 新个股涨幅 - indexGain
     *   要求 新偏离值 >= threshold
     *   即 (1 + stockGain) * (1 + x) - 1 - indexGain >= threshold
     *   (1 + x) >= (1 + threshold + indexGain) / (1 + stockGain)
     *   x >= (1 + threshold + indexGain) / (1 + stockGain) - 1
     *
     * 触发值 = x * 100（百分比）
     *
     * 滑动窗口效应：
     * - T+N天后，窗口最旧的N天价格会滑出窗口
     * - 如果滑出的价格中有基准价，则基准价会升高（取窗口内新的最低价）
     * - 基准价升高意味着个股涨幅减小，偏离值减小，触发值变大（更难触发）
     *
     * @param {Array} klines - K线数据数组（从旧到新排序），每项需含 close, date 字段
     * @param {Array} indexKlines - 基准指数K线数据（与个股同日期对齐）
     * @param {Object} rule - 异动规则 { windowDays, threshold }
     * @param {number} forwardDays - 提前天数（如5表示计算T+0到T+4）
     * @returns {Object} { triggered, triggers, currentGain, indexGain, deviation, basePrice, trendDays }
     */
    function calcRuleTriggers(klines, indexKlines, rule, forwardDays) {
        const stockPrices = klines.map(k => k.close);
        const windowSize = rule.windowDays;
        const threshold = rule.threshold;

        // 构建指数价格映射（日期 -> 收盘价）
        const indexPriceMap = new Map();
        if (indexKlines && indexKlines.length > 0) {
            indexKlines.forEach(k => indexPriceMap.set(k.date, k.close));
        }

        // 需要足够的历史数据
        if (stockPrices.length < windowSize) {
            return {
                triggered: false,
                triggers: new Array(forwardDays).fill(null),
                currentGain: null,
                indexGain: null,
                deviation: null,
                basePrice: null,
                trendDays: 0
            };
        }

        // 取窗口期内的价格（最近windowSize个交易日）
        const windowStockPrices = stockPrices.slice(-windowSize);
        const currentPrice = windowStockPrices[windowStockPrices.length - 1];

        // 获取窗口期对应的指数收盘价
        const windowDates = klines.slice(-windowSize).map(k => k.date);
        const windowIndexPrices = windowDates.map(d => indexPriceMap.get(d) || 0);
        const currentIndexPrice = windowIndexPrices[windowIndexPrices.length - 1];

        // 计算当前偏离值
        const deviationResult = calcDeviation(windowStockPrices, windowIndexPrices, currentPrice, currentIndexPrice);

        // 是否已触发异动
        const triggered = deviationResult.deviation >= threshold;

        // 计算T+0到T+(forwardDays-1)的触发限制
        const triggers = [];
        for (let dayOffset = 0; dayOffset < forwardDays; dayOffset++) {
            const triggerValue = calcDayTrigger(
                klines, indexPriceMap, windowSize, threshold, dayOffset
            );
            triggers.push(triggerValue);
        }

        return {
            triggered,
            triggers,
            currentGain: deviationResult.deviation,  // 偏离值作为currentGain
            stockGain: deviationResult.stockGain,     // 个股涨幅
            indexGain: deviationResult.indexGain,     // 指数涨幅
            deviation: deviationResult.deviation,     // 偏离值
            basePrice: deviationResult.basePrice,
            indexBasePrice: deviationResult.indexBasePrice,
            trendDays: deviationResult.trendDays
        };
    }

    /**
     * 计算未来第N天的异动触发涨幅限制
     *
     * 触发值 = 个股还需涨幅百分比
     * 公式：x = (1 + threshold + indexGain) / (1 + stockGain) - 1
     *
     * @param {Array} klines - 全部K线数据（从旧到新）
     * @param {Map} indexPriceMap - 指数日期->收盘价映射
     * @param {number} windowSize - 窗口天数
     * @param {number} threshold - 异动阈值(1.0或2.0)
     * @param {number} dayOffset - 未来第几天(0=当日)
     * @returns {number|null} 触发所需个股涨幅百分比，null表示数据不足，0表示已触发
     */
    function calcDayTrigger(klines, indexPriceMap, windowSize, threshold, dayOffset) {
        const stockPrices = klines.map(k => k.close);
        const len = stockPrices.length;
        if (len < windowSize) return null;

        const currentPrice = stockPrices[len - 1];
        const currentDate = klines[len - 1].date;

        if (dayOffset === 0) {
            // 当日：直接用当前窗口计算
            const windowStockPrices = stockPrices.slice(-windowSize);
            const windowDates = klines.slice(-windowSize).map(k => k.date);
            const windowIndexPrices = windowDates.map(d => indexPriceMap.get(d) || 0);
            const currentIndexPrice = windowIndexPrices[windowIndexPrices.length - 1];

            const deviationResult = calcDeviation(windowStockPrices, windowIndexPrices, currentPrice, currentIndexPrice);

            if (deviationResult.deviation >= threshold) return 0;

            // 触发所需个股涨幅
            // x = (1 + threshold + indexGain) / (1 + stockGain) - 1
            const triggerX = (1 + threshold + deviationResult.indexGain) / (1 + deviationResult.stockGain) - 1;
            return Math.max(0, triggerX * 100);
        }

        // T+N天：考虑滑动窗口效应
        // 假设未来N天个股价格 = 当前价（保守估计）
        const slideCount = Math.min(dayOffset, windowSize);
        const newWindowStart = len - windowSize + slideCount;

        if (newWindowStart < 0) return null;

        // 滑动后的窗口：去掉最旧的slideCount天，加上未来的dayOffset天
        const remainingStockPrices = stockPrices.slice(newWindowStart);
        const futureStockPrices = new Array(dayOffset).fill(currentPrice);
        const slidStockWindow = [...remainingStockPrices, ...futureStockPrices].slice(-windowSize);

        // 滑动后的窗口日期：去掉最旧的slideCount天，加上未来的dayOffset天
        const remainingDates = klines.slice(newWindowStart).map(k => k.date);
        // 未来日期用占位符（指数价格用当前指数价格代替）
        const futureDatePlaceholder = '__future__';
        const slidDates = [...remainingDates, ...new Array(dayOffset).fill(futureDatePlaceholder)].slice(-windowSize);

        // 获取滑动窗口对应的指数价格
        const slidIndexPrices = slidDates.map(d => {
            if (d === futureDatePlaceholder) return indexPriceMap.get(currentDate) || 0;
            return indexPriceMap.get(d) || 0;
        });
        const slidCurrentIndexPrice = slidIndexPrices[slidIndexPrices.length - 1];

        // 计算滑动后的偏离值
        const deviationResult = calcDeviation(slidStockWindow, slidIndexPrices, currentPrice, slidCurrentIndexPrice);

        if (deviationResult.deviation >= threshold) return 0;

        // 触发所需个股涨幅
        const triggerX = (1 + threshold + deviationResult.indexGain) / (1 + deviationResult.stockGain) - 1;
        return Math.max(0, triggerX * 100);
    }

    /**
     * 计算单只股票的完整异动分析结果
     * 同时计算100异动和200异动
     *
     * @param {Object} stock - 股票基本信息 { code, name, changePercent, secid, gain5d }
     * @param {Array} klines - K线数据
     * @param {Array} indexKlines - 基准指数K线数据（与个股同日期对齐）
     * @param {number} forwardDays - 提前天数
     * @param {number} tradeDayOffset - 交易日偏移量（收盘后=1，交易时间=0）
     * @returns {Object} 异动分析结果
     */
    function analyzeStock(stock, klines, indexKlines, forwardDays, tradeDayOffset) {
        forwardDays = forwardDays || 5;
        tradeDayOffset = tradeDayOffset || 0;
        const allRuleResults = [];

        for (const rule of RULES) {
            const calcResult = calcRuleTriggers(klines, indexKlines, rule, forwardDays);
            allRuleResults.push({
                ruleName: rule.name,
                tagClass: rule.tagClass,
                windowDays: rule.windowDays,
                threshold: rule.threshold,
                ...calcResult
            });
        }

        // 获取涨停幅度
        const limitUpRate = getLimitUpRate(stock.code);

        // 同花顺模式：T+N天的触发值=T+0的额外涨幅（不滑动窗口）
        // 同花顺的"收盘涨幅达到X%将触发"始终基于当前窗口计算，
        // 不考虑未来滑动窗口效应。
        //
        // 示例：金安国纪6.12
        // - T+0额外涨幅 = 9.24%（从6.12收盘价还需涨9.24%触发）
        // - 同花顺6.15触发值 = 9.24%（=T+0额外涨幅）
        // - calcDayTrigger(dayOffset=1)滑动窗口后=10.49%（同花顺不用这个值）
        for (const ruleResult of allRuleResults) {
            const trigger0Raw = ruleResult.triggers[0]; // T+0的额外涨幅
            if (trigger0Raw !== null && trigger0Raw > 0) {
                for (let i = 1; i < ruleResult.triggers.length; i++) {
                    ruleResult.triggers[i] = trigger0Raw;
                }
            }
        }

        // 将triggers从"额外涨幅"转换为"当日总涨幅"
        // 同花顺格式："收盘涨幅达到 X% 将触发"
        //
        // triggers[N] = 从当前收盘价还需涨多少（额外涨幅）
        // 同花顺触发值 = 当日总涨幅（相对前一日收盘价）
        //
        // 转换公式：
        //   T+0（6.12当天）：总涨幅 = (1 + 当日涨幅) * (1 + 额外涨幅) - 1
        //     例：金安国纪6.12涨5.99%，额外需涨9.24%→总涨幅15.78%（超10%涨停，不可触发）
        //   T+1（6.15预测日）：总涨幅 = 额外涨幅（因为6.15涨幅从0%开始）
        //     例：金安国纪6.15额外需涨9.24%→总涨幅9.24%
        //
        // 注意：T+N天的"前一日收盘价"就是当前收盘价（假设中间N-1天价格不变），
        // 所以T+1及以后的总涨幅就等于额外涨幅
        const dailyGainRate = (stock.changePercent || 0) / 100;
        for (const ruleResult of allRuleResults) {
            for (let day = 0; day < ruleResult.triggers.length; day++) {
                if (ruleResult.triggers[day] !== null && ruleResult.triggers[day] > 0) {
                    const additionalGainRate = ruleResult.triggers[day] / 100;
                    let totalDailyGain;
                    if (day === 0) {
                        // T+0：当日已有涨幅，需复合计算
                        totalDailyGain = ((1 + dailyGainRate) * (1 + additionalGainRate) - 1) * 100;
                    } else {
                        // T+1及以后：当日涨幅从0%开始，总涨幅=额外涨幅
                        totalDailyGain = ruleResult.triggers[day];
                    }
                    ruleResult.triggers[day] = totalDailyGain;
                }
            }
        }

        // 找最紧急的规则（未触发中触发值最小且可触发的）
        let dominantRule = allRuleResults[0];
        let minAchievableTrigger = Infinity;

        for (const ruleResult of allRuleResults) {
            const trigger0 = ruleResult.triggers[0];

            // 已触发的优先级最低（已发生，不需要预警）
            if (trigger0 === 0) continue;

            // 触发值最小且当日可触发的
            if (trigger0 !== null && trigger0 > 0 && trigger0 < minAchievableTrigger) {
                minAchievableTrigger = trigger0;
                dominantRule = ruleResult;
            }
        }

        // 如果没有未触发的规则，取第一个已触发的
        if (minAchievableTrigger === Infinity) {
            for (const ruleResult of allRuleResults) {
                if (ruleResult.triggered) {
                    dominantRule = ruleResult;
                    break;
                }
            }
        }

        // 判断是否有可触发的风险（加强过滤：只看T+0和T+1）
        // 原因：T+2及以后需要连续多天涨停才能触发，实际可能性极低
        // 例如：主板10%涨停，触发值17.77%需连续2天涨停(21%)才可能，但概率很低
        // 只保留T+0或T+1至少有一天可触发的股票，过滤掉"理论上可能但实际不可能"的情况
        let hasAchievableRisk = false;
        const checkDays = Math.min(2, forwardDays); // 只检查前2天(T+0和T+1)
        for (const ruleResult of allRuleResults) {
            for (let day = 0; day < checkDays; day++) {
                const trigger = ruleResult.triggers[day];
                if (isTriggerAchievable(trigger, limitUpRate, day)) {
                    hasAchievableRisk = true;
                    break;
                }
            }
            if (hasAchievableRisk) break;
        }

        // 紧急程度：取dominantRule的当日触发值
        const urgency = dominantRule.triggers[0];

        // 获取最新日期
        const latestDate = klines.length > 0 ? klines[klines.length - 1].date : '';

        return {
            code: stock.code,
            name: stock.name,
            secid: stock.secid,
            changePercent: stock.changePercent,
            gain5d: stock.gain5d || null,
            limitUpRate: limitUpRate,
            date: latestDate,
            rules: allRuleResults,
            hasAchievableRisk,
            urgency,
            dominantRule: dominantRule.ruleName
        };
    }

    /**
     * 批量分析股票严重异动
     *
     * @param {Array} stocks - 股票基本信息数组
     * @param {Map} klineMap - secid -> klines 映射
     * @param {Map} indexKlineMap - 指数secid -> klines 映射
     * @param {number} forwardDays - 提前天数
     * @param {boolean} onlyAchievable - 是否仅返回有可触发风险的股票
     * @param {number} tradeDayOffset - 交易日偏移量（收盘后=1，交易时间=0）
     * @returns {Array} 异动分析结果数组（按紧急程度排序）
     */
    function analyzeAll(stocks, klineMap, indexKlineMap, forwardDays, onlyAchievable, tradeDayOffset) {
        tradeDayOffset = tradeDayOffset || 0;
        const analysisResults = [];

        for (const stock of stocks) {
            const klines = klineMap.get(stock.secid) || [];
            if (klines.length < 10) continue;

            // 获取该股票对应的基准指数K线
            const indexSecid = StockAPI.getBenchmarkIndexSecid(stock.code);
            const indexKlines = (indexKlineMap && indexKlineMap.get(indexSecid)) || [];

            const result = analyzeStock(stock, klines, indexKlines, forwardDays, tradeDayOffset);

            // 调试日志：输出每只股票的分析结果摘要
            if (result.rules && result.rules.length > 0) {
                const r100 = result.rules.find(r => r.ruleName === '100异动');
                const r200 = result.rules.find(r => r.ruleName === '200异动');
                const dev100 = r100 ? (r100.deviation * 100).toFixed(2) + '%' : '--';
                const dev200 = r200 ? (r200.deviation * 100).toFixed(2) + '%' : '--';
                const trig100 = r100 && r100.triggers[0] !== null ? r100.triggers[0].toFixed(2) + '%' : '--';
                const trig200 = r200 && r200.triggers[0] !== null ? r200.triggers[0].toFixed(2) + '%' : '--';
                console.log(`[分析] ${stock.name}(${stock.code}) 指数:${indexSecid} 指数K线:${indexKlines.length}条 100异动:偏离${dev100}触发${trig100} 200异动:偏离${dev200}触发${trig200} 可触发:${result.hasAchievableRisk}`);
            }

            // 只保留有可触发风险的股票
            if (onlyAchievable && !result.hasAchievableRisk) continue;

            analysisResults.push(result);
        }

        // 排序：按紧急程度升序（urgency越小越紧急，0=已触发排最后）
        analysisResults.sort((a, b) => {
            const aVal = a.urgency === 0 ? Infinity : (a.urgency || Infinity);
            const bVal = b.urgency === 0 ? Infinity : (b.urgency || Infinity);
            return aVal - bVal;
        });

        return analysisResults;
    }

    // 公开接口
    return {
        RULES,
        getLimitUpRate,
        getMaxPossibleGain,
        isTriggerAchievable,
        calcDeviation,
        calcRuleTriggers,
        calcDayTrigger,
        analyzeStock,
        analyzeAll
    };
})();
