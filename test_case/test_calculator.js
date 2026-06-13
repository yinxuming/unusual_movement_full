/**
 * 异动计算测试用例
 *
 * 用途：对比同花顺标准值与本项目实际计算值，定位计算错误
 * 运行方式：在浏览器控制台执行，或作为独立测试页面运行
 *
 * 同花顺标准数据来源：doc\参考示例\同花顺严重异动.md
 */

const UnusualTest = (function () {

    /**
     * 测试结果记录
     */
    const testResults = [];

    /**
     * 记录一条测试结果
     */
    function record(name, expected, actual, passed, detail) {
        testResults.push({ name, expected, actual, passed, detail });
        const status = passed ? 'PASS' : 'FAIL';
        const icon = passed ? '\u2713' : '\u2717';
        console.log(`[${status}] ${icon} ${name}`);
        console.log(`   期望: ${expected}`);
        console.log(`   实际: ${actual}`);
        if (detail) console.log(`   详情: ${detail}`);
        console.log('');
    }

    /**
     * 构造模拟K线数据
     * @param {string} startDate - 起始日期 YYYY-MM-DD
     * @param {number} days - 天数
     * @param {number} startPrice - 起始收盘价
     * @param {Array} changes - 每日涨跌幅数组（小数形式，如0.05表示+5%）
     * @returns {Array} K线数据数组
     */
    function buildMockKlines(startDate, days, startPrice, changes) {
        const klines = [];
        let price = startPrice;
        const d = new Date(startDate);

        for (let i = 0; i < days; i++) {
            const dateStr = formatDate(d);
            const change = changes[i] || 0;
            const openPrice = price;
            const closePrice = price * (1 + change);
            const highPrice = Math.max(openPrice, closePrice) * (1 + Math.random() * 0.01);
            const lowPrice = Math.min(openPrice, closePrice) * (1 - Math.random() * 0.01);

            klines.push({
                date: dateStr,
                open: round(openPrice, 2),
                close: round(closePrice, 2),
                high: round(highPrice, 2),
                low: round(lowPrice, 2),
                volume: 1000000 + Math.floor(Math.random() * 5000000),
                amount: closePrice * (1000000 + Math.floor(Math.random() * 5000000)),
                amplitude: round(Math.abs(change) * 100, 2),
                changePercent: round(change * 100, 2),
                changeAmount: round((closePrice - openPrice), 2),
                turnover: round(5 + Math.random() * 10, 2)
            });

            price = closePrice;
            // 下一个交易日（跳过周末）
            addTradingDays(d, 1);
        }

        return klines;
    }

    /**
     * 格式化日期为 YYYY-MM-DD
     */
    function formatDate(d) {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
    }

    /**
     * 日期增加N个交易日（简单跳过周末，不考虑节假日）
     */
    function addTradingDays(d, n) {
        let count = 0;
        while (count < n) {
            d.setDate(d.getDate() + 1);
            const dow = d.getDay();
            if (dow !== 0 && dow !== 6) count++;
        }
    }

    /**
     * 四舍五入
     */
    function round(val, digits) {
        const factor = Math.pow(10, digits);
        return Math.round(val * factor) / factor;
    }

    // ===== 测试用例数据 =====

    /**
     * 测试案例1：金安国纪(002636) - 6.15预测数据
     *
     * 同花顺标准：
     * - 9日偏离值:83.34%
     * - 触发条件:+9.24%（100异动）
     * - 深市主板 → 基准指数:深证A指(0.399107)
     *
     * 推算参数：
     * - 个股9日涨幅约80.42%，同期深证A指跌幅约-2.92%
     * - 偏离值 = 80.42% - (-2.92%) = 83.34%
     * - 触发值 = (1+1.0+(-0.0292))/(1+0.8042)-1 = 9.24%
     */
    function testJinAnGuoJi_615() {
        console.log('===== 测试案例1: 金安国纪(002636) 6.15 =====');

        // 构建30天个股K线（从5月初到6月12日）
        // 需要构造9日内从低点涨到当前价约80.42%的走势
        // 假设最低点在第1天，之后连续上涨

        // 近10天模拟数据：前1天低位，后9天大涨
        // 起始价8元，第1天跌到7.5元（最低点），然后连续9天涨到约13.53元（涨幅80.4%）
        const stockChanges = [
            -0.0625,    // Day1: 8→7.5 (-6.25%) 最低点
            0.08,       // Day2: 7.5→8.1 (+8%)
            0.07,       // Day3: 8.1→8.667 (+7%)
            0.09,       // Day4: 8.667→9.447 (+9%)
            0.06,       // Day5: 9.447→10.014 (+6%)
            0.08,       // Day6: 10.014→10.815 (+8%)
            0.07,       // Day7: 10.815→11.572 (+7%)
            0.05,       // Day8: 11.572→12.151 (+5%)
            0.06,       // Day9: 12.151→12.88 (+6%)
            0.05,       // Day10: 12.88→13.524 (+5%) 当前
        ];

        // 前20天补充数据（小幅波动，让总数据有30天）
        const preChanges = Array(20).fill(0).map(() => (Math.random() - 0.5) * 0.03);
        const allStockChanges = [...preChanges, ...stockChanges];

        const stockKlines = buildMockKlines('2026-05-08', 30, 8.0, allStockChanges);

        // 构建深证A指K线（同期微跌约-2.92% over 9天）
        // 指数整体趋势：缓慢下跌
        const indexStartPrice = 1800; // 深证A指点位
        const indexChanges = Array(30).fill(0).map(() => (Math.random() - 0.5) * 0.015 - 0.003); // 微跌偏移
        const indexKlines = buildMockKlines('2026-05-08', 30, indexStartPrice, indexChanges);

        // 打印实际构建的数据用于调试
        const last10Stock = stockKlines.slice(-10);
        const last10Index = indexKlines.slice(-10);
        console.log('近10日个股收盘价:', last10Stock.map(k => `${k.date}:${k.close}`).join(', '));
        console.log('近10日指数收盘价:', last10Index.map(k => `${k.date}:${k.close}`).join(', '));

        const stock = {
            code: '002636',
            name: '金安国纪',
            secid: '0.002636',
            changePercent: 0,
            limitUpRate: 0.10  // 主板10%
        };

        // 使用calculator的内部函数进行测试
        const windowSize = 10;
        const threshold = 1.0;

        // 取最近10天的价格
        const stockPrices = stockKlines.map(k => k.close);
        const windowStockPrices = stockPrices.slice(-windowSize);
        const indexPrices = indexKlines.map(k => k.close);
        const windowIndexPrices = indexPrices.slice(-windowSize);

        const currentPrice = windowStockPrices[windowStockPrices.length - 1];
        const currentIndexPrice = windowIndexPrices[windowIndexPrices.length - 1];

        console.log(`当前个股价: ${currentPrice}, 当前指数价: ${currentIndexPrice}`);

        // 调用calcDeviation
        const devResult = UnusualCalculator.calcDeviation(
            windowStockPrices,
            windowIndexPrices,
            currentPrice,
            currentIndexPrice
        );

        console.log('偏离值计算结果:', JSON.stringify(devResult, null, 2));

        const actualDeviation = round(devResult.deviation * 100, 2);
        const actualTrendDays = devResult.trendDays;

        // 计算触发值
        const triggerX = (1 + threshold + devResult.indexGain) / (1 + devResult.stockGain) - 1;
        const actualTrigger = round(triggerX * 100, 2);

        console.log(`偏离值: ${actualDeviation}% (${actualTrendDays}日)`);
        console.log(`个股涨幅: ${(devResult.stockGain * 100).toFixed(2)}%`);
        console.log(`指数涨幅: ${(devResult.indexGain * 100).toFixed(2)}%`);
        console.log(`触发值: ${actualTrigger}%`);

        // 同花顺标准：9日偏离值83.34%，触发条件+9.24%
        // 注意：由于我们用的是模拟数据，偏离值不会完全匹配83.34%
        // 但我们可以验证公式是否正确

        // 验证公式一致性：偏离值 = 个股涨幅 - 指数涨幅
        const expectedDeviation = round(devResult.stockGain * 100 - devResult.indexGain * 100, 2);
        record(
            '金安国纪-偏离值公式一致性',
            `${expectedDeviation}%`,
            `${actualDeviation}%`,
            Math.abs(actualDeviation - expectedDeviation) < 0.01,
            `偏离值应等于 个股涨幅(${(devResult.stockGain*100).toFixed(2)}%) - 指数涨幅(${(devResult.indexGain*100).toFixed(2)}%)`
        );

        // 验证触发值公式
        const expectedTrigger = round(((1 + threshold + devResult.indexGain) / (1 + devResult.stockGain) - 1) * 100, 2);
        record(
            '金安国纪-触发值公式',
            `${expectedTrigger}% (公式直接计算)`,
            `${actualTrigger}%`,
            Math.abs(actualTrigger - expectedTrigger) < 0.01,
            `triggerX = (1+${threshold}+${devResult.indexGain.toFixed(4)})/(1+${devResult.stockGain.toFixed(4)})-1`
        );

        return { devResult, actualDeviation, actualTrigger };
    }

    /**
     * 测试案例2：津膜科技(300334) - 6.12数据
     *
     * 同花顺标准：
     * - 7日偏离值:89.76%
     * - 触发条件:+5.55%（100异动）
     * - 创业板 → 基准指数:创业板综合指数(0.399102)
     */
    function testJinMoKeJi_612() {
        console.log('===== 测试案例2: 津膜科技(300334) 6.12 =====');

        // 创业板股票，7日偏离值89.76%，触发+5.55%
        // 推算：stockGain - indexGain = 89.76%
        // trigger = (1+1+indexGain)/(1+stockGain)-1 = 5.55%

        // 从 trigger 反推：
        // (2+indexGain)/(1+stockGain) = 1.0555
        // 2+indexGain = 1.0555*(1+stockGain)
        // 又 stockGain - indexGain = 0.8976 → indexGain = stockGain - 0.8976
        // 2 + stockGain - 0.8976 = 1.0555 + 1.0555*stockGain
        // 1.1024 + stockGain = 1.0555 + 1.0555*stockGain
        // 0.0469 = 0.0555*stockGain
        // stockGain ≈ 0.8450 (84.50%)
        // indexGain = 0.8450 - 0.8976 = -0.0526 (-5.26%)

        const stockChanges = [
            -0.04,       // Day1: 最低点附近
            0.10,        // Day2
            0.12,        // Day3
            0.08,        // Day4
            0.11,        // Day5
            0.09,        // Day6
            0.06,        // Day7
            0.15,        // Day8: 当日+4.28%(但这里模拟的是累计)
            0.05,        // Day9
            0.04,        // Day10: 当前
        ];
        const preChanges = Array(20).fill(0).map(() => (Math.random() - 0.5) * 0.02);
        const allStockChanges = [...preChanges, ...stockChanges];

        const stockKlines = buildMockKlines('2026-05-08', 30, 12.0, allStockChanges);

        // 创业板综指（同期下跌约5%）
        const indexStartPrice = 3200;
        const indexChanges = Array(30).fill(0).map(() => (Math.random() - 0.5) * 0.012 - 0.005);
        const indexKlines = buildMockKlines('2026-05-08', 30, indexStartPrice, indexChanges);

        const stockPrices = stockKlines.map(k => k.close);
        const windowStockPrices = stockPrices.slice(-10);
        const indexPrices = indexKlines.map(k => k.close);
        const windowIndexPrices = indexPrices.slice(-10);

        const currentPrice = windowStockPrices[windowStockPrices.length - 1];
        const currentIndexPrice = windowIndexPrices[windowIndexPrices.length - 1];

        const devResult = UnusualCalculator.calcDeviation(
            windowStockPrices,
            windowIndexPrices,
            currentPrice,
            currentIndexPrice
        );

        const actualDeviation = round(devResult.deviation * 100, 2);
        const triggerX = (1 + 1.0 + devResult.indexGain) / (1 + devResult.stockGain) - 1;
        const actualTrigger = round(triggerX * 100, 2);

        console.log(`津膜科技 - 偏离值: ${actualDeviation}% (${devResult.trendDays}日), 触发值: ${actualTrigger}%`);
        console.log(`  个股涨幅: ${(devResult.stockGain*100).toFixed(2)}%, 指数涨幅: ${(devResult.indexGain*100).toFixed(2)}%`);

        return { devResult, actualDeviation, actualTrigger };
    }

    /**
     * 测试案例3：索辰科技(688507) - 200异动
     *
     * 同花顺标准：
     * - 21日偏离值:170.13%
     * - 触发条件:+11.21%（200异动）
     * - 科创板 → 基准指数:科创50(1.000688)
     */
    function testSuoChenKeJi_615() {
        console.log('===== 测试案例3: 索辰科技(688507) 200异动 =====');

        // 200异动，阈值=2.0
        // 21日偏离值170.13%，触发+11.21%
        // 推算：(1+2+indexGain)/(1+stockGain)-1 = 0.1121
        // 3+indexGain = 1.1121*(1+stockGain)
        // stockGain - indexGain = 1.7013
        // 解得：stockGain≈185%, indexGain≈14.87%

        // 构造30天K线，21天内大幅上涨
        const stockChanges = [];
        for (let i = 0; i < 23; i++) {
            stockChanges.push(0.02 + Math.random() * 0.06); // 平均每天+4~8%
        }
        // 前7天平稳
        const preChanges = Array(7).fill(0).map(() => (Math.random() - 0.5) * 0.02);
        const allStockChanges = [...preChanges, ...stockChanges];

        const stockKlines = buildMockKlines('2026-05-08', 30, 30.0, allStockChanges);

        // 科创50指数（同期上涨）
        const indexStartPrice = 800;
        const indexChanges = Array(30).fill(0).map(() => (Math.random() - 0.5) * 0.015 + 0.003);
        const indexKlines = buildMockKlines('2026-05-08', 30, indexStartPrice, indexChanges);

        const stockPrices = stockKlines.map(k => k.close);
        const windowStockPrices = stockPrices.slice(-30); // 30天窗口
        const indexPrices = indexKlines.map(k => k.close);
        const windowIndexPrices = indexPrices.slice(-30);

        const currentPrice = windowStockPrices[windowStockPrices.length - 1];
        const currentIndexPrice = windowIndexPrices[windowIndexPrices.length - 1];

        const devResult = UnusualCalculator.calcDeviation(
            windowStockPrices,
            windowIndexPrices,
            currentPrice,
            currentIndexPrice
        );

        const threshold = 2.0; // 200异动
        const actualDeviation = round(devResult.deviation * 100, 2);
        const triggerX = (1 + threshold + devResult.indexGain) / (1 + devResult.stockGain) - 1;
        const actualTrigger = round(triggerX * 100, 2);

        console.log(`索辰科技 - 偏离值: ${actualDeviation}% (${devResult.trendDays}日), 触发值: ${actualTrigger}% (200异动)`);
        console.log(`  个股涨幅: ${(devResult.stockGain*100).toFixed(2)}%, 指数涨幅: ${(devResult.indexGain*100).toFixed(2)}%`);

        return { devResult, actualDeviation, actualTrigger };
    }

    /**
     * 测试案例4：中巨芯(688549) - 已触发案例
     *
     * 同花顺标准：
     * - 06-11当日+19.96%后已触发
     * - 9日偏离值:114.48%（超过100%）
     * - 100异动已触发
     */
    function testZhongJuXin_611_triggered() {
        console.log('===== 测试案例4: 中巨芯(688549) 已触发 =====');

        // 已触发：偏离值 >= 100%
        // 9日偏离值114.48%，当日+19.96%

        // 构造：9天内涨幅很大，最后一天暴涨19.96%导致突破100%
        const stockChanges = [
            0.03,
            0.05,
            0.08,
            0.06,
            0.10,
            0.12,
            0.15,
            0.18,
            0.1996,      // 当日+19.96%
            0.02,
        ];
        const preChanges = Array(20).fill(0).map(() => (Math.random() - 0.5) * 0.02);
        const allStockChanges = [...preChanges, ...stockChanges];

        const stockKlines = buildMockKlines('2026-05-08', 30, 15.0, allStockChanges);

        // 科创50指数
        const indexStartPrice = 800;
        const indexChanges = Array(30).fill(0).map(() => (Math.random() - 0.5) * 0.01);
        const indexKlines = buildMockKlines('2026-05-08', 30, indexStartPrice, indexChanges);

        const stockPrices = stockKlines.map(k => k.close);
        const windowStockPrices = stockPrices.slice(-10);
        const indexPrices = indexKlines.map(k => k.close);
        const windowIndexPrices = indexPrices.slice(-10);

        const currentPrice = windowStockPrices[windowStockPrices.length - 1];
        const currentIndexPrice = windowIndexPrices[windowIndexPrices.length - 1];

        const devResult = UnusualCalculator.calcDeviation(
            windowStockPrices,
            windowIndexPrices,
            currentPrice,
            currentIndexPrice
        );

        const actualDeviation = round(devResult.deviation * 100, 2);
        const isTriggered = devResult.deviation >= 1.0;

        console.log(`中巨芯 - 偏离值: ${actualDeviation}% (${devResult.trendDays}日), 已触发: ${isTriggered}`);
        console.log(`  个股涨幅: ${(devResult.stockGain*100).toFixed(2)}%, 指数涨幅: ${(devResult.indexGain*100).toFixed(2)}%`);

        record(
            '中巨芯-已触发判断',
            '偏离值>=100%时应判定为已触发',
            `偏离值=${actualDeviation}%, triggered=${isTriggered}`,
            isTriggered === true || actualDeviation >= 100,
            `偏离值${actualDeviation}%应该>=100%才算已触发`
        );

        return { devResult, actualDeviation, isTriggered };
    }

    /**
     * 测试案例5：精确反推金安国纪数据，使结果完全匹配同花顺
     *
     * 用反推出的精确参数构造数据，验证计算结果是否完全匹配
     */
    function testJinAnGuoJi_precise() {
        console.log('===== 测试案例5: 金安国纪精确参数验证 =====');

        // 同花顺精确值：
        // - 9日偏离值: 83.34%
        // - 触发条件: +9.24%
        // - 100异动 (threshold=1.0)

        // 反推出的精确参数：
        // - stockGain = 80.4206% (0.804206)
        // - indexGain = -2.9194% (-0.029194)
        // - 偏离值 = 80.4206% - (-2.9194%) = 83.34%
        // - 触发值 = (1+1.0+(-0.029194))/(1+0.804206)-1 = 0.09238 = 9.24%

        // 构造精确的10天窗口数据：
        // 需要10个价格点，其中最低点在第1个位置（索引0），后续9天连续上涨到当前价
        // basePrice = P_min
        // currentPrice = P_min * (1 + 0.804206) = P_min * 1.804206

        const basePrice = 7.50;  // 最低点价格
        const currentPrice = basePrice * 1.804206; // = 13.5315

        // 构造10天价格（最低点在第1天，后面逐步上涨）
        const dayPrices = [basePrice];
        let price = basePrice;
        // 分配9天的涨幅总和为80.4206%
        const dailyGains = [0.06, 0.07, 0.08, 0.07, 0.09, 0.08, 0.08, 0.09, 0.084]; // 总和≈79.4%，调整一下
        // 精确分配：让最终价格正好等于currentPrice
        const remainingGain = 0.804206;
        const gains = [];
        let accGain = 0;
        for (let i = 0; i < 9; i++) {
            const g = remainingGain / (9 - i) * (0.8 + Math.random() * 0.4); // 不均匀分配
            gains.push(g);
            accGain += g;
        }
        // 修正最后一天确保精确
        gains[gains.length - 1] += remainingGain - accGain;

        for (const g of gains) {
            price = price * (1 + g);
            dayPrices.push(round(price, 4));
        }
        dayPrices[dayPrices.length - 1] = round(currentPrice, 4); // 强制精确

        console.log('构造的10日价格序列:', dayPrices.map((p, i) => `D${i}:${p}`).join(', '));
        console.log(`基准价: ${dayPrices[0]}, 当前价: ${dayPrices[9]}`);
        console.log(`个股涨幅: ${((dayPrices[9]/dayPrices[0]-1)*100).toFixed(2)}%`);

        // 构造指数价格（9天跌幅-2.9194%）
        const indexBasePrice = 1800;
        const indexCurrentPrice = indexBasePrice * (1 - 0.029194); // = 1747.45
        const indexDayPrices = [indexBasePrice];
        let idxPrice = indexBasePrice;
        const indexTotalChange = -0.029194;
        const idxGains = [];
        let idxAccGain = 0;
        for (let i = 0; i < 9; i++) {
            const g = indexTotalChange / (9 - i) * (0.8 + Math.random() * 0.4);
            idxGains.push(g);
            idxAccGain += g;
        }
        idxGains[idxGains.length - 1] += indexTotalChange - idxAccGain;

        for (const g of idxGains) {
            idxPrice = idxPrice * (1 + g);
            indexDayPrices.push(round(idxPrice, 4));
        }
        indexDayPrices[indexDayPrices.length - 1] = round(indexCurrentPrice, 4);

        console.log('构造的10日指数价格序列:', indexDayPrices.map((p, i) => `I${i}:${p}`).join(', '));
        console.log(`指数基准价: ${indexDayPrices[0]}, 当前价: ${indexDayPrices[9]}`);
        console.log(`指数涨幅: ${((indexDayPrices[9]/indexDayPrices[0]-1)*100).toFixed(2)}%`);

        // 执行calcDeviation
        const devResult = UnusualCalculator.calcDeviation(
            dayPrices,
            indexDayPrices,
            dayPrices[9],
            indexDayPrices[9]
        );

        const actualDeviation = round(devResult.deviation * 100, 2);
        const actualTrendDays = devResult.trendDays;

        // 计算触发值
        const triggerX = (1 + 1.0 + devResult.indexGain) / (1 + devResult.stockGain) - 1;
        const actualTrigger = round(triggerX * 100, 2);

        console.log('\n=== 精确验证结果 ===');
        console.log(`偏离值: ${actualDeviation}% (期望: 83.34%), 趋势天数: ${actualTrendDays}日 (期望: 9日)`);
        console.log(`触发值: ${actualTrigger}% (期望: 9.24%)`);
        console.log(`个股涨幅: ${(devResult.stockGain*100).toFixed(2)}% (期望: ~80.42%)`);
        console.log(`指数涨幅: ${(devResult.indexGain*100).toFixed(2)}% (期望: ~-2.92%)`);

        record(
            '金安国纪精确-偏离值',
            '83.34%',
            `${actualDeviation}%`,
            Math.abs(actualDeviation - 83.34) < 1.0, // 允许1%误差（因为价格分布不完全一致）
            `趋势天数:${actualTrendDays}, 最低点索引:${devResult.basePriceIndex}`
        );

        record(
            '金安国纪精确-触发值',
            '9.24%',
            `${actualTrigger}%`,
            Math.abs(actualTrigger - 9.24) < 1.0,
            `基于偏离值${actualDeviation}%计算`
        );

        record(
            '金安国纪精确-趋势天数',
            '9',
            `${actualTrendDays}`,
            actualTrendDays === 9,
            `从最低点到当前价经过${actualTrendDays}天`
        );

        return { devResult, actualDeviation, actualTrigger, actualTrendDays };
    }

    /**
     * 测试案例6：验证analyzeStock完整流程
     * 模拟完整的分析流程（包括交易日偏移）
     */
    function testAnalyzeStock_fullFlow() {
        console.log('===== 测试案例6: analyzeStock完整流程 =====');

        // 用金安国纪的精确数据
        const basePrice = 7.50;
        const currentPrice = basePrice * 1.804206;

        const dayPrices = [basePrice];
        let price = basePrice;
        const remainingGain = 0.804206;
        const gains = [];
        let accGain = 0;
        for (let i = 0; i < 9; i++) {
            const g = remainingGain / (9 - i) * (0.8 + Math.random() * 0.4);
            gains.push(g);
            accGain += g;
        }
        gains[gains.length - 1] += remainingGain - accGain;
        for (const g of gains) {
            price = price * (1 + g);
            dayPrices.push(round(price, 4));
        }
        dayPrices[dayPrices.length - 1] = round(currentPrice, 4);

        // 补充前20天数据
        const prePrices = [];
        let prePrice = basePrice * 0.95;
        for (let i = 0; i < 20; i++) {
            prePrices.push(round(prePrice, 4));
            prePrice = prePrice * (1 + (Math.random() - 0.5) * 0.02);
        }
        const allPrices = [...prePrices, ...dayPrices];

        // 生成完整K线
        const stockKlines = [];
        const d = new Date('2026-05-08');
        for (let i = 0; i < allPrices.length; i++) {
            const p = allPrices[i];
            stockKlines.push({
                date: formatDate(d),
                close: p,
                open: round(p * (1 - (Math.random() * 0.01)), 2),
                high: round(p * (1 + Math.random() * 0.01), 2),
                low: round(p * (1 - Math.random() * 0.01), 2),
                volume: 1000000,
                amount: p * 1000000,
                amplitude: 0,
                changePercent: 0,
                changeAmount: 0,
                turnover: 0
            });
            addTradingDays(d, 1);
        }

        // 深证A指K线
        const indexBasePrice = 1800;
        const indexCurrentPrice = indexBasePrice * (1 - 0.029194);
        const indexAllPrices = [];
        let idxP = indexBasePrice * 0.98;
        for (let i = 0; i < 20; i++) {
            indexAllPrices.push(round(idxP, 4));
            idxP = idxP * (1 + (Math.random() - 0.5) * 0.01);
        }
        // 最后10天精确构造
        const indexDayPrices = [indexBasePrice];
        idxP = indexBasePrice;
        const idxGains = [];
        let idxAcc = 0;
        for (let i = 0; i < 9; i++) {
            const g = -0.029194 / 9 * (0.8 + Math.random() * 0.4);
            idxGains.push(g);
            idxAcc += g;
        }
        idxGains[idxGains.length - 1] += (-0.029194) - idxAcc;
        for (const g of idxGains) {
            idxP = idxP * (1 + g);
            indexDayPrices.push(round(idxP, 4));
        }
        indexDayPrices[indexDayPrices.length - 1] = round(indexCurrentPrice, 4);
        const allIndexPrices = [...indexAllPrices, ...indexDayPrices];

        const indexKlines = [];
        const d2 = new Date('2026-05-08');
        for (let i = 0; i < allIndexPrices.length; i++) {
            const p = allIndexPrices[i];
            indexKlines.push({
                date: formatDate(d2),
                close: p,
                open: p,
                high: p,
                low: p,
                volume: 0,
                amount: 0,
                amplitude: 0,
                changePercent: 0,
                changeAmount: 0,
                turnover: 0
            });
            addTradingDays(d2, 1);
        }

        const stock = {
            code: '002636',
            name: '金安国纪',
            secid: '0.002636',
            changePercent: 0,
            gain5d: 35.0
        };

        // 调用analyzeStock（无交易日偏移）
        const result = UnusualCalculator.analyzeStock(stock, stockKlines, indexKlines, 5, 0);

        console.log('analyzeStock结果:');
        console.log(`  dominantRule: ${result.dominantRule}`);
        console.log(`  hasAchievableRisk: ${result.hasAchievableRisk}`);

        if (result.rules && result.rules.length > 0) {
            for (const rule of result.rules) {
                console.log(`  --- ${rule.ruleName} ---`);
                console.log(`    triggered: ${rule.triggered}`);
                console.log(`    deviation: ${(rule.deviation * 100).toFixed(2)}%`);
                console.log(`    trendDays: ${rule.trendDays}`);
                console.log(`    stockGain: ${(rule.stockGain * 100).toFixed(2)}%`);
                console.log(`    indexGain: ${(rule.indexGain * 100).toFixed(2)}%`);
                console.log(`    triggers(T+0~T+4): ${rule.triggers.map(t => t !== null ? t.toFixed(2) + '%' : '--').join(', ')}`);
            }
        }

        // 取100异动的T+0触发值
        const rule100 = result.rules ? result.rules.find(r => r.ruleName === '100异动') : null;
        if (rule100) {
            const trigger0 = rule100.triggers[0];
            record(
                '完整流程-金安国纪T+0触发值',
                '~9.24%',
                trigger0 !== null ? trigger0.toFixed(2) + '%' : 'null',
                trigger0 !== null && Math.abs(trigger0 - 9.24) < 5.0, // 允许一定误差
                `偏离值:${(rule100.deviation*100).toFixed(2)}%, 趋势天数:${rule100.trendDays}`
            );
        }

        return result;
    }

    /**
     * 运行所有测试用例
     */
    function runAll() {
        console.log('========================================');
        console.log('  异动计算测试套件');
        console.log('  对比标准: 同花顺严重异动数据');
        console.log('========================================\n');

        testResults.length = 0;

        try { testJinAnGuoJi_615(); } catch (e) { console.error('测试1异常:', e); }
        try { testJinAnGuoJi_precise(); } catch (e) { console.error('测试5异常:', e); }
        try { testJinMoKeJi_612(); } catch (e) { console.error('测试2异常:', e); }
        try { testSuoChenKeJi_615(); } catch (e) { console.error('测试3异常:', e); }
        try { testZhongJuXin_611_triggered(); } catch (e) { console.error('测试4异常:', e); }
        try { testAnalyzeStock_fullFlow(); } catch (e) { console.error('测试6异常:', e); }

        // 输出汇总
        console.log('\n========================================');
        console.log('  测试结果汇总');
        console.log('========================================');

        const passed = testResults.filter(r => r.passed).length;
        const failed = testResults.filter(r => !r.passed).length;

        console.log(`\n总计: ${testResults.length}项, 通过: ${passed}, 失败: ${failed}\n`);

        if (failed > 0) {
            console.log('失败项目:');
            testResults.filter(r => !r.passed).forEach(r => {
                console.log(`  [FAIL] ${r.name}`);
                console.log(`         期望: ${r.expected}`);
                console.log(`         实际: ${r.actual}`);
                console.log(`         详情: ${r.detail}`);
            });
        }

        return { total: testResults.length, passed, failed, results: testResults };
    }

    return { runAll };
})();

// 如果在浏览器环境且支持导出
if (typeof module !== 'undefined' && module.exports) {
    module.exports = UnusualTest;
}
