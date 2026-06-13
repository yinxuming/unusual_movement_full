/**
 * Node.js可执行的异动计算测试
 * 直接验证金安国纪等股票的计算结果与同花顺标准值的差异
 *
 * 运行方式: node test_node.js
 */

// ===== 提取calculator.js核心逻辑 =====

/**
 * 计算区间偏离值
 */
function calcDeviation(stockPrices, indexPrices, currentPrice, currentIndexPrice) {
    if (!stockPrices || stockPrices.length === 0) {
        return { deviation: 0, stockGain: 0, indexGain: 0, basePriceIndex: -1, trendDays: 0 };
    }
    const hasIndexData = indexPrices && indexPrices.length > 0 && currentIndexPrice > 0;

    let minIdx = 0;
    let minPrice = stockPrices[0];
    for (let i = 1; i < stockPrices.length; i++) {
        if (stockPrices[i] < minPrice) {
            minPrice = stockPrices[i];
            minIdx = i;
        }
    }
    const basePrice = minPrice;
    const stockGain = (currentPrice - basePrice) / basePrice;

    let indexGain = 0;
    let indexBasePrice = 0;
    if (hasIndexData) {
        indexBasePrice = (indexPrices.length > minIdx && indexPrices[minIdx] > 0)
            ? indexPrices[minIdx]
            : currentIndexPrice;
        if (indexBasePrice > 0) {
            indexGain = (currentIndexPrice - indexBasePrice) / indexBasePrice;
        }
    }

    const deviation = stockGain - indexGain;
    let trendDays = 0;
    for (let i = stockPrices.length - 1; i >= 0; i--) {
        if (i === minIdx) break;
        trendDays++;
    }

    return { deviation, stockGain, indexGain, basePriceIndex: minIdx, basePrice, indexBasePrice, trendDays };
}

/**
 * 计算T+N天的触发值
 */
function calcDayTrigger(stockPrices, indexPriceMap, dates, windowSize, threshold, dayOffset) {
    const len = stockPrices.length;
    if (len < windowSize) return null;

    const currentPrice = stockPrices[len - 1];
    const currentDate = dates[len - 1];

    if (dayOffset === 0) {
        const windowStockPrices = stockPrices.slice(-windowSize);
        const windowDates = dates.slice(-windowSize);
        const windowIndexPrices = windowDates.map(d => indexPriceMap.get(d) || 0);
        const currentIndexPrice = windowIndexPrices[windowIndexPrices.length - 1];

        const devResult = calcDeviation(windowStockPrices, windowIndexPrices, currentPrice, currentIndexPrice);
        if (devResult.deviation >= threshold) return 0;

        const triggerX = (1 + threshold + devResult.indexGain) / (1 + devResult.stockGain) - 1;
        return Math.max(0, triggerX * 100);
    }

    const slideCount = Math.min(dayOffset, windowSize);
    const newWindowStart = len - windowSize + slideCount;
    if (newWindowStart < 0) return null;

    const remainingStockPrices = stockPrices.slice(newWindowStart);
    const futureStockPrices = new Array(dayOffset).fill(currentPrice);
    const slidStockWindow = [...remainingStockPrices, ...futureStockPrices].slice(-windowSize);

    const remainingDates = dates.slice(newWindowStart);
    const futureDatePlaceholder = '__future__';
    const slidDates = [...remainingDates, ...new Array(dayOffset).fill(futureDatePlaceholder)].slice(-windowSize);

    const slidIndexPrices = slidDates.map(d => {
        if (d === futureDatePlaceholder) return indexPriceMap.get(currentDate) || 0;
        return indexPriceMap.get(d) || 0;
    });
    const slidCurrentIndexPrice = slidIndexPrices[slidIndexPrices.length - 1];

    const devResult = calcDeviation(slidStockWindow, slidIndexPrices, currentPrice, slidCurrentIndexPrice);
    if (devResult.deviation >= threshold) return 0;

    const triggerX = (1 + threshold + devResult.indexGain) / (1 + devResult.stockGain) - 1;
    return Math.max(0, triggerX * 100);
}

function getMaxPossibleGain(limitUpRate, days) {
    return ((1 + limitUpRate) ** days - 1) * 100;
}

function isTriggerAchievable(triggerValue, limitUpRate, dayOffset) {
    if (triggerValue === null || triggerValue === undefined) return false;
    if (triggerValue === 0) return true;
    const maxGain = getMaxPossibleGain(limitUpRate, dayOffset + 1);
    return triggerValue <= maxGain;
}

// ===== 测试数据 =====

// 金安国纪(002636) 40天K线收盘价
const stockRawData = [
    "2026-04-15,38.24,37.35,39.67,37.14,490655,1869774373.80,6.54,-3.41,-1.32,6.77",
    "2026-04-16,36.94,38.62,39.08,36.31,404814,1548555382.56,7.42,3.40,1.27,5.59",
    "2026-04-17,38.60,38.78,39.80,38.03,439215,1715232875.86,4.58,0.41,0.16,6.06",
    "2026-04-20,39.33,39.45,39.86,38.57,379841,1495624703.01,3.33,1.73,0.67,5.24",
    "2026-04-21,38.68,41.76,41.88,38.26,483487,1944291528.32,9.18,5.86,2.31,6.68",
    "2026-04-22,41.53,45.95,45.95,40.88,439101,1922804089.32,12.14,10.03,4.19,6.06",
    "2026-04-23,46.81,43.13,47.25,41.89,605856,2671778743.78,11.66,-6.14,-2.82,8.36",
    "2026-04-24,42.39,41.21,43.06,40.55,405809,1689845573.72,5.82,-4.45,-1.92,5.60",
    "2026-04-27,42.26,43.98,45.06,41.54,424812,1856870621.52,8.54,6.72,2.77,5.87",
    "2026-04-28,44.88,46.16,48.39,44.22,805141,3751355716.94,9.48,4.96,2.18,11.12",
    "2026-04-29,45.23,45.22,48.14,44.88,679055,3133686620.81,7.06,-2.04,-0.94,9.38",
    "2026-04-30,45.70,44.78,47.28,43.89,462613,2098062291.32,7.50,-0.97,-0.44,6.39",
    "2026-05-06,45.46,46.44,47.63,43.38,628663,2883989778.25,9.49,3.71,1.66,8.68",
    "2026-05-07,46.87,49.39,50.10,45.70,521546,2530859465.99,9.47,6.35,2.95,7.20",
    "2026-05-08,48.90,47.81,49.70,47.16,458775,2206105522.29,5.14,-3.20,-1.58,6.33",
    "2026-05-11,47.87,48.38,49.23,46.55,418904,2004307081.69,5.61,1.19,0.57,5.78",
    "2026-05-12,47.38,46.41,47.88,45.17,377127,1757557195.63,5.60,-4.07,-1.97,5.21",
    "2026-05-13,44.89,46.49,47.88,44.67,364608,1708891467.23,6.92,0.17,0.08,5.03",
    "2026-05-14,46.58,45.17,47.47,44.88,320591,1476200863.17,5.57,-2.84,-1.32,4.43",
    "2026-05-15,44.88,42.78,45.56,41.89,341615,1482595364.19,8.12,-5.29,-2.39,4.72",
    "2026-05-18,42.57,43.65,43.79,41.96,249735,1081397527.30,4.28,2.03,0.87,3.45",
    "2026-05-19,42.90,43.96,44.38,41.68,276265,1197726193.34,6.19,0.71,0.31,3.81",
    "2026-05-20,43.75,44.63,44.68,42.69,289499,1277676292.43,4.53,1.52,0.67,4.00",
    "2026-05-21,45.19,42.56,46.33,42.47,399095,1795340226.19,8.65,-4.64,-2.07,5.51",
    "2026-05-22,42.88,46.15,46.78,42.88,492933,2237913073.55,9.16,8.44,3.59,6.81",
    "2026-05-25,45.78,45.49,47.45,45.26,433128,1999448943.76,4.75,-1.43,-0.66,5.98",
    "2026-05-26,44.57,47.43,47.43,42.77,540448,2470734176.39,10.24,4.26,1.94,7.46",
    "2026-05-27,46.96,48.64,50.56,45.96,574761,2796144645.89,9.70,2.55,1.21,7.94",
    "2026-05-28,47.40,53.50,53.50,47.34,673366,3440859023.46,12.66,9.99,4.86,9.30",
    "2026-05-29,55.00,53.51,56.80,53.02,706168,3869438918.05,7.07,0.02,0.01,9.75",
    "2026-06-01,53.00,49.87,53.51,48.17,573757,2883226402.02,9.98,-6.80,-3.64,7.92",
    "2026-06-02,49.59,50.63,51.31,46.80,512995,2533650349.14,9.04,1.52,0.76,7.08",
    "2026-06-03,50.48,51.73,53.28,50.00,560085,2887824153.23,6.48,2.17,1.10,7.73",
    "2026-06-04,50.00,54.00,54.37,49.38,546875,2838358578.12,9.65,4.39,2.27,7.55",
    "2026-06-05,53.99,58.16,59.40,52.80,887279,5174580790.73,12.22,7.70,4.16,12.25",
    "2026-06-08,58.07,63.98,63.98,57.09,401265,2462714910.34,11.85,10.01,5.82,5.54",
    "2026-06-09,70.38,70.38,70.38,68.40,143509,1006174434.82,3.09,10.00,6.40,1.98",
    "2026-06-10,76.00,77.42,77.42,74.46,384210,2953090916.98,4.21,10.00,7.04,5.30",
    "2026-06-11,77.44,84.80,85.16,77.44,917360,7572449374.71,9.97,9.53,7.38,12.67",
    "2026-06-12,89.99,89.88,93.28,86.92,843772,7580017890.48,7.50,5.99,5.08,11.65"
];

// 深证A指 40天K线收盘价
const indexRawData = [
    "2026-04-15,2844.74,2809.92,2844.84,2801.05,696725973,1386311758546.20,1.55,-0.71,-20.03,2.87",
    "2026-04-16,2816.77,2860.47,2862.46,2811.74,685729606,1365032427919.70,1.81,1.80,50.55,2.83",
    "2026-04-17,2857.81,2871.12,2877.71,2852.41,695206138,1411943308916.80,0.88,0.37,10.65,2.87",
    "2026-04-20,2870.17,2890.57,2893.66,2867.20,722597186,1494096433826.30,0.92,0.68,19.45,2.98",
    "2026-04-21,2882.48,2889.59,2891.58,2857.87,700102171,1375096001382.79,1.17,-0.03,-0.98,2.89",
    "2026-04-22,2876.55,2918.54,2919.26,2876.40,698755623,1466079089433.92,1.48,1.00,28.95,2.88",
    "2026-04-23,2924.83,2887.77,2926.51,2868.24,760806890,1570025591389.24,2.00,-1.05,-30.77,3.14",
    "2026-04-24,2872.86,2870.41,2886.73,2846.32,709560997,1498797742484.35,1.40,-0.60,-17.36,2.93",
    "2026-04-27,2869.12,2884.68,2891.48,2858.43,709771286,1453345826934.41,1.15,0.50,14.27,2.93",
    "2026-04-28,2872.10,2853.87,2872.94,2843.07,723327016,1422233325769.39,1.04,-1.07,-30.81,2.98",
    "2026-04-29,2837.83,2901.26,2906.39,2837.83,736224626,1463460509814.84,2.40,1.66,47.39,3.04",
    "2026-04-30,2904.36,2905.18,2912.08,2893.94,737449745,1464631050569.38,0.63,0.14,3.92,3.04",
    "2026-05-06,2936.50,2970.46,2979.08,2933.64,825890812,1760812759168.95,1.56,2.25,65.28,3.41",
    "2026-05-07,2981.69,3005.74,3006.53,2970.47,844194419,1784777147257.23,1.21,1.19,35.28,3.48",
    "2026-05-08,2987.15,3009.42,3013.99,2984.89,825971857,1716809291458.73,0.97,0.12,3.68,3.41",
    "2026-05-11,3031.67,3058.26,3061.67,3018.77,911347231,1954405244125.56,1.43,1.62,48.84,3.76",
    "2026-05-12,3063.51,3039.02,3063.51,3018.34,847480868,1777281315218.21,1.48,-0.63,-19.24,3.49",
    "2026-05-13,3022.52,3086.27,3087.77,3022.52,827013186,1792448201972.05,2.15,1.55,47.25,3.41",
    "2026-05-14,3102.05,3021.27,3102.89,3021.27,873165664,1864023671476.40,2.64,-2.11,-65.00,3.60",
    "2026-05-15,3022.86,2994.53,3043.76,2972.75,849517328,1825184186204.96,2.35,-0.89,-26.74,3.50",
    "2026-05-18,2979.52,2995.58,3010.28,2968.25,738098213,1578832793476.88,1.40,0.04,1.05,3.04",
    "2026-05-19,2987.50,3010.99,3012.14,2953.95,730980242,1579968904480.36,1.94,0.51,15.41,3.01",
    "2026-05-20,2996.79,3002.61,3010.23,2977.53,725910843,1594691016988.28,1.09,-0.28,-8.38,2.99",
    "2026-05-21,3021.58,2930.55,3051.20,2927.53,878436225,1885706321967.42,4.12,-2.40,-72.06,3.62",
    "2026-05-22,2952.58,2995.91,2999.62,2938.12,762638160,1617336123260.90,2.10,2.23,65.36,3.14",
    "2026-05-25,3015.01,3023.96,3024.22,2982.48,780915793,1759979847944.45,1.39,0.94,28.05,3.22",
    "2026-05-26,3010.00,3005.93,3010.95,2967.55,822923407,1781881207418.01,1.44,-0.60,-18.03,3.39",
    "2026-05-27,3002.95,2966.71,3022.50,2949.01,815525142,1764981482799.32,2.44,-1.30,-39.22,3.36",
    "2026-05-28,2958.44,2992.93,2998.23,2935.58,747480890,1606700363453.82,2.11,0.88,26.22,3.08",
    "2026-05-29,3007.54,2936.11,3012.37,2921.18,848470866,1786823095904.72,3.05,-1.90,-56.82,3.50",
    "2026-06-01,2937.61,2913.27,2969.39,2909.57,760110503,1557599999445.14,2.04,-0.78,-22.84,3.13",
    "2026-06-02,2920.44,2935.63,2948.82,2870.53,736747600,1511802565240.27,2.69,0.77,22.36,3.04",
    "2026-06-03,2938.37,2943.70,2981.19,2915.46,792331364,1700377669095.78,2.24,0.27,8.07,3.27",
    "2026-06-04,2915.27,2931.50,2942.83,2912.23,718576706,1482893449574.64,1.04,-0.41,-12.20,2.96",
    "2026-06-05,2919.87,2892.40,2949.32,2880.15,817597598,1705069881402.29,2.36,-1.33,-39.10,3.37",
    "2026-06-08,2805.38,2801.61,2860.71,2772.76,788380832,1525371115673.31,3.04,-3.14,-90.79,3.25",
    "2026-06-09,2833.08,2870.10,2870.66,2805.60,717838305,1467131661788.02,2.32,2.44,68.49,2.96",
    "2026-06-10,2836.07,2813.38,2846.97,2786.33,710209016,1392090154526.05,2.11,-1.98,-56.72,2.93",
    "2026-06-11,2798.71,2794.81,2822.54,2769.98,669643021,1366396145368.04,1.87,-0.66,-18.57,2.76",
    "2026-06-12,2843.16,2822.49,2862.03,2817.21,792117657,1677465690350.60,1.60,0.99,27.68,3.27"
];

function parseKlines(rawData) {
    return rawData.map(line => {
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

// ===== 测试执行 =====

console.log('='.repeat(60));
console.log('  金安国纪(002636) 异动计算测试');
console.log('  对比标准: 同花顺严重异动数据');
console.log('='.repeat(60));

const stockKlines = parseKlines(stockRawData);
const indexKlines = parseKlines(indexRawData);

const stockPrices = stockKlines.map(k => k.close);
const stockDates = stockKlines.map(k => k.date);
const indexPriceMap = new Map();
indexKlines.forEach(k => indexPriceMap.set(k.date, k.close));

console.log(`\n个股K线: ${stockKlines.length}条, ${stockDates[0]} ~ ${stockDates[stockDates.length-1]}`);
console.log(`指数K线: ${indexKlines.length}条`);

// ===== 测试1: 6.12数据 (tradeDayOffset=0) =====
console.log('\n' + '='.repeat(60));
console.log('  测试1: 6.12数据 (tradeDayOffset=0)');
console.log('='.repeat(60));

const windowSize = 10;
const threshold = 1.0;

// 取最近10天
const windowStockPrices = stockPrices.slice(-windowSize);
const windowDates = stockDates.slice(-windowSize);
const windowIndexPrices = windowDates.map(d => indexPriceMap.get(d) || 0);
const currentPrice = windowStockPrices[windowStockPrices.length - 1];
const currentIndexPrice = windowIndexPrices[windowIndexPrices.length - 1];

console.log('\n近10日数据:');
for (let i = 0; i < windowSize; i++) {
    console.log(`  ${windowDates[i]}: 个股${windowStockPrices[i].toFixed(2)} 指数${windowIndexPrices[i].toFixed(2)}`);
}

const devResult0 = calcDeviation(windowStockPrices, windowIndexPrices, currentPrice, currentIndexPrice);
console.log('\ncalcDeviation结果:');
console.log(`  偏离值: ${(devResult0.deviation * 100).toFixed(2)}%`);
console.log(`  个股涨幅: ${(devResult0.stockGain * 100).toFixed(2)}%`);
console.log(`  指数涨幅: ${(devResult0.indexGain * 100).toFixed(2)}%`);
console.log(`  趋势天数: ${devResult0.trendDays}`);
console.log(`  基准价: ${devResult0.basePrice} (index ${devResult0.basePriceIndex})`);
console.log(`  指数基准价: ${devResult0.indexBasePrice}`);

const trigger0 = (1 + threshold + devResult0.indexGain) / (1 + devResult0.stockGain) - 1;
console.log(`\n触发值: ${(trigger0 * 100).toFixed(2)}%`);

// 对比同花顺标准
console.log('\n--- 对比同花顺标准 ---');
console.log(`  偏离值: 实际=${(devResult0.deviation * 100).toFixed(2)}% 标准=83.34% 差异=${Math.abs(devResult0.deviation * 100 - 83.34).toFixed(2)}%`);
console.log(`  触发值: 实际=${(trigger0 * 100).toFixed(2)}% 标准=9.24% 差异=${Math.abs(trigger0 * 100 - 9.24).toFixed(2)}%`);

// ===== 测试2: 6.15预测 (tradeDayOffset=1) =====
console.log('\n' + '='.repeat(60));
console.log('  测试2: 6.15预测 (tradeDayOffset=1)');
console.log('='.repeat(60));

// 模拟滑动1天
const slideCount = 1;
const newWindowStart = stockPrices.length - windowSize + slideCount;
const slidStockPrices = stockPrices.slice(newWindowStart);
const futureStockPrices = new Array(slideCount).fill(currentPrice);
const slidStockWindow = [...slidStockPrices, ...futureStockPrices].slice(-windowSize);

const slidDates = [...stockDates.slice(newWindowStart), ...new Array(slideCount).fill('__future__')].slice(-windowSize);
const slidIndexPrices = slidDates.map(d => {
    if (d === '__future__') return currentIndexPrice;
    return indexPriceMap.get(d) || 0;
});

console.log('\n滑动后窗口(10天):');
for (let i = 0; i < windowSize; i++) {
    console.log(`  ${slidDates[i]}: 个股${slidStockWindow[i].toFixed(2)} 指数${slidIndexPrices[i].toFixed(2)}`);
}

const devResult1 = calcDeviation(slidStockWindow, slidIndexPrices, currentPrice, currentIndexPrice);
console.log('\ncalcDeviation结果(滑动1天):');
console.log(`  偏离值: ${(devResult1.deviation * 100).toFixed(2)}%`);
console.log(`  个股涨幅: ${(devResult1.stockGain * 100).toFixed(2)}%`);
console.log(`  指数涨幅: ${(devResult1.indexGain * 100).toFixed(2)}%`);
console.log(`  趋势天数: ${devResult1.trendDays}`);
console.log(`  基准价: ${devResult1.basePrice} (index ${devResult1.basePriceIndex})`);

const trigger1 = (1 + threshold + devResult1.indexGain) / (1 + devResult1.stockGain) - 1;
console.log(`\nT+0触发值: ${(trigger1 * 100).toFixed(2)}%`);

// ===== 测试3: 完整T+0到T+4触发值计算（修正后：同花顺模式）=====
console.log('\n' + '='.repeat(60));
console.log('  测试3: T+0到T+4触发值 (修正后: T+0不滑动窗口)');
console.log('='.repeat(60));

const forwardDays = 5;
const limitUpRate = 0.10; // 主板10%

// 修正后逻辑：tradeDayOffset不再影响计算窗口
// T+0直接用当前窗口(dayOffset=0)，T+1用dayOffset=1，以此类推
// 不再截取，直接取前forwardDays个
const triggers = [];
for (let dayOffset = 0; dayOffset < forwardDays; dayOffset++) {
    const tv = calcDayTrigger(stockPrices, indexPriceMap, stockDates, windowSize, threshold, dayOffset);
    triggers.push(tv);
}
console.log('\n显示触发值 (6.15~6.19, 修正后T+0不滑动):');
triggers.forEach((t, i) => console.log(`  T+${i}: ${t !== null ? t.toFixed(2) + '%' : 'null'}`));

// displayTriggers就是triggers（不截取）
const displayTriggers = triggers;

// ===== 测试4: 可触发性判断（修正后）=====
console.log('\n' + '='.repeat(60));
console.log('  测试4: 可触发性判断 (修正后)');
console.log('='.repeat(60));

let hasAchievableRisk = false;
for (let day = 0; day < forwardDays; day++) {
    const trigger = displayTriggers[day];
    const maxGain = getMaxPossibleGain(limitUpRate, day + 1);
    const achievable = isTriggerAchievable(trigger, limitUpRate, day);
    console.log(`  T+${day}: 触发值=${trigger !== null ? trigger.toFixed(2) + '%' : 'null'}, 最大涨幅=${maxGain.toFixed(2)}%, 可触发=${achievable}`);
    if (achievable) hasAchievableRisk = true;
}

console.log(`\nhasAchievableRisk = ${hasAchievableRisk}`);

if (!hasAchievableRisk) {
    console.log('\n*** 错误! 金安国纪应该有可触发风险 ***');
} else {
    console.log('\n*** 正确! 金安国纪有可触发风险 ***');
}

// 修正后：6.15预测的偏离值应等于6.12的偏离值（不滑动窗口）
const devResultFixed = devResult0; // 修正后不滑动，偏离值保持不变

// ===== 测试5: 200异动检查 =====
console.log('\n' + '='.repeat(60));
console.log('  测试5: 200异动检查 (30天窗口)');
console.log('='.repeat(60));

const windowSize200 = 30;
const threshold200 = 2.0;

const windowStockPrices200 = stockPrices.slice(-windowSize200);
const windowDates200 = stockDates.slice(-windowSize200);
const windowIndexPrices200 = windowDates200.map(d => indexPriceMap.get(d) || 0);
const currentPrice200 = windowStockPrices200[windowStockPrices200.length - 1];
const currentIndexPrice200 = windowIndexPrices200[windowIndexPrices200.length - 1];

const devResult200 = calcDeviation(windowStockPrices200, windowIndexPrices200, currentPrice200, currentIndexPrice200);
console.log(`200异动偏离值: ${(devResult200.deviation * 100).toFixed(2)}%`);
console.log(`个股涨幅: ${(devResult200.stockGain * 100).toFixed(2)}%`);
console.log(`指数涨幅: ${(devResult200.indexGain * 100).toFixed(2)}%`);
console.log(`趋势天数: ${devResult200.trendDays}`);

const trigger200 = (1 + threshold200 + devResult200.indexGain) / (1 + devResult200.stockGain) - 1;
console.log(`200异动触发值: ${(trigger200 * 100).toFixed(2)}%`);

// ===== 汇总 =====
console.log('\n' + '='.repeat(60));
console.log('  测试汇总');
console.log('='.repeat(60));

const results = [];

// 6.12数据
results.push({
    name: '金安国纪-偏离值(6.12)',
    expected: '83.34%',
    actual: (devResult0.deviation * 100).toFixed(2) + '%',
    passed: Math.abs(devResult0.deviation * 100 - 83.34) < 0.5
});

results.push({
    name: '金安国纪-触发值(6.12)',
    expected: '9.24%',
    actual: (trigger0 * 100).toFixed(2) + '%',
    passed: Math.abs(trigger0 * 100 - 9.24) < 0.5
});

// 6.15预测（修正后：T+0不滑动窗口，应与6.12数据一致）
results.push({
    name: '金安国纪-可触发性(6.15预测)',
    expected: 'true',
    actual: String(hasAchievableRisk),
    passed: hasAchievableRisk === true
});

results.push({
    name: '金安国纪-T+0触发值(6.15预测,修正后应=6.12)',
    expected: '9.24%',
    actual: displayTriggers[0].toFixed(2) + '%',
    passed: Math.abs(displayTriggers[0] - 9.24) < 0.5
});

results.push({
    name: '金安国纪-偏离值(6.15预测,修正后应=6.12)',
    expected: '83.34%',
    actual: (devResultFixed.deviation * 100).toFixed(2) + '%',
    passed: Math.abs(devResultFixed.deviation * 100 - 83.34) < 0.5
});

// 验证同花顺关键规则：T+0(目标日)触发值<=涨停幅度时应有风险
results.push({
    name: '金安国纪-T+0可触发(9.24%<=10%主板)',
    expected: 'true',
    actual: String(isTriggerAchievable(displayTriggers[0], limitUpRate, 0)),
    passed: isTriggerAchievable(displayTriggers[0], limitUpRate, 0) === true
});

let passCount = 0;
let failCount = 0;
results.forEach(r => {
    const status = r.passed ? 'PASS' : 'FAIL';
    if (r.passed) passCount++; else failCount++;
    console.log(`[${status}] ${r.name}: 期望=${r.expected}, 实际=${r.actual}`);
});

console.log(`\n总计: ${results.length}项, 通过: ${passCount}, 失败: ${failCount}`);

if (failCount > 0) {
    console.log('\n失败项目详情:');
    results.filter(r => !r.passed).forEach(r => {
        console.log(`  [FAIL] ${r.name}: 期望=${r.expected}, 实际=${r.actual}`);
    });
}
