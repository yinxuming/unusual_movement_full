/**
 * CSV解析测试用例（自选股导入功能）
 *
 * 测试对象：js/watchlist.js 中的纯函数
 *   - normalizeCodeField：代码字段规范化（SZ000017/000017/000017.SZ等格式）
 *   - parseCSVText：CSV文本解析（表头跳过/去重/失败行统计）
 *   - decodeCSVBuffer：GBK/UTF-8编码自动识别解码
 *   - addStock/removeStock：自选CRUD（Mock localStorage）
 *
 * 运行方式：node test_case/test_csv_parse.js
 * 真实数据：doc/导入导出/导入自选数据.csv（GBK编码，12只股票）
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// ===== 测试结果统计 =====
let passCount = 0;
let failCount = 0;

/**
 * 断言辅助
 * @param {string} name - 用例名
 * @param {boolean} condition - 断言条件
 * @param {string} detail - 失败详情
 */
function assert(name, condition, detail = '') {
    if (condition) {
        passCount++;
        console.log(`[PASS] ${name}`);
    } else {
        failCount++;
        console.log(`[FAIL] ${name} ${detail}`);
    }
}

/** 深度比较断言 */
function assertEqual(name, actual, expected) {
    const cond = JSON.stringify(actual) === JSON.stringify(expected);
    assert(name, cond, cond ? '' : `(期望: ${JSON.stringify(expected)}, 实际: ${JSON.stringify(actual)})`);
}

// ===== Mock浏览器环境 =====

/** Mock localStorage（内存实现） */
function createMockStorage() {
    const store = {};
    return {
        getItem: (k) => (k in store ? store[k] : null),
        setItem: (k, v) => { store[k] = String(v); },
        removeItem: (k) => { delete store[k]; },
        clear: () => { for (const k in store) delete store[k]; },
        get length() { return Object.keys(store).length; },
        key: (i) => Object.keys(store)[i] || null
    };
}

// 加载watchlist.js（模块加载期不触碰DOM，仅需函数声明环境）
const watchlistCode = fs.readFileSync(path.join(__dirname, '..', 'js', 'watchlist.js'), 'utf-8');
const sandbox = {
    console: console,
    TextDecoder: TextDecoder,
    localStorage: createMockStorage(),
    alert: () => { },
    prompt: () => null,
    confirm: () => true,
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    // DOM Mock（模块加载期不需要，防函数误调用时报错）
    document: {
        getElementById: () => null,
        querySelector: () => null,
        querySelectorAll: () => [],
        createElement: () => ({ style: {}, classList: { add: () => { } }, appendChild: () => { } }),
        addEventListener: () => { }
    }
};
vm.createContext(sandbox);
vm.runInContext(watchlistCode + '\nthis.__Watchlist = Watchlist;', sandbox);
const Watchlist = sandbox.__Watchlist;

// 加载calculator.js（验证北证920代码段的涨停幅度判定）
const calcSandbox = { console: console };
vm.createContext(calcSandbox);
vm.runInContext(
    fs.readFileSync(path.join(__dirname, '..', 'js', 'calculator.js'), 'utf-8') + '\nthis.__Calc = UnusualCalculator;',
    calcSandbox
);
const Calc = calcSandbox.__Calc;

console.log('===== 1. normalizeCodeField 代码字段规范化 =====\n');

assertEqual('前缀格式 SZ000017', Watchlist.normalizeCodeField('SZ000017'), { code: '000017', market: 0 });
assertEqual('前缀格式 SH600371', Watchlist.normalizeCodeField('SH600371'), { code: '600371', market: 1 });
assertEqual('前缀格式 BJ832566（北证）', Watchlist.normalizeCodeField('BJ832566'), { code: '832566', market: 0 });
assertEqual('后缀格式 000017.SZ', Watchlist.normalizeCodeField('000017.SZ'), { code: '000017', market: 0 });
assertEqual('后缀格式 600371.SH', Watchlist.normalizeCodeField('600371.SH'), { code: '600371', market: 1 });
assertEqual('纯代码 000017（推断深市）', Watchlist.normalizeCodeField('000017'), { code: '000017', market: 0 });
assertEqual('纯代码 600371（推断沪市）', Watchlist.normalizeCodeField('600371'), { code: '600371', market: 1 });
assertEqual('带引号 "SZ000017"', Watchlist.normalizeCodeField('"SZ000017"'), { code: '000017', market: 0 });
assertEqual('带空格 " 000017 "', Watchlist.normalizeCodeField(' 000017 '), { code: '000017', market: 0 });
assertEqual('无效代码 abc', Watchlist.normalizeCodeField('abc'), null);
assertEqual('无效代码 12345（位数不足）', Watchlist.normalizeCodeField('12345'), null);
assertEqual('空值 null', Watchlist.normalizeCodeField(null), null);

console.log('\n===== 2. parseCSVText CSV文本解析 =====\n');

// 基础解析：表头 + 数据行
const utf8Csv = '名称,代码\r\n深中华A,SZ000017\r\n好当家,SH600371\r\n';
const r1 = Watchlist.parseCSVText(utf8Csv);
assertEqual('基础解析（表头跳过）', r1.stocks, [
    { name: '深中华A', code: '000017', market: 0 },
    { name: '好当家', code: '600371', market: 1 }
]);
assertEqual('基础解析无失败行', r1.failed, []);

// 去重
const dupCsv = '名称,代码\r\n深中华A,SZ000017\r\n深中华A重复,000017\r\n';
const r2 = Watchlist.parseCSVText(dupCsv);
assert('重复代码去重', r2.stocks.length === 1);
assertEqual('去重保留首个名称', r2.stocks[0] && r2.stocks[0].name, '深中华A');

// 格式无效行统计
const badCsv = '名称,代码\r\n深中华A,SZ000017\r\n无效行\r\n坏数据,XYZ\r\n';
const r3 = Watchlist.parseCSVText(badCsv);
assert('无效行计入failed', r3.failed.length === 2, `(实际: ${JSON.stringify(r3.failed)})`);
assert('有效行正常解析', r3.stocks.length === 1);

// 无表头（首行即数据）
const noHeaderCsv = '深中华A,SZ000017\r\n好当家,SH600371\r\n';
const r4 = Watchlist.parseCSVText(noHeaderCsv);
assert('无表头解析', r4.stocks.length === 2);

console.log('\n===== 2.1 表头列识别（列位置不固定，列头名称固定） =====\n');

// 新格式：代码列在前，名称列在后（导入自选数据2.csv格式）
const codeFirstCsv = '代码,    名称\r\nSZ002081,金 螳 螂\r\nSZ002172,澳洋健康\r\nBZ920083,金戈新材\r\n';
const r5 = Watchlist.parseCSVText(codeFirstCsv);
assertEqual('代码在前格式解析（表头带空格）', r5.stocks, [
    { name: '金 螳 螂', code: '002081', market: 0 },
    { name: '澳洋健康', code: '002172', market: 0 },
    { name: '金戈新材', code: '920083', market: 0 }
]);
assertEqual('代码在前格式无失败行', r5.failed, []);

// 名称列在前（旧格式），验证表头识别同样生效
const nameFirstCsv = '名称,代码\r\n深中华A,SZ000017\r\n';
const r6 = Watchlist.parseCSVText(nameFirstCsv);
assertEqual('名称在前格式（表头识别）', r6.stocks, [{ name: '深中华A', code: '000017', market: 0 }]);

// 表头列反转：名称在前但数据列对应正确（非相邻/其他列序）
const mixedCsv = '名称,其他,代码\r\n深中华A,备注X,SZ000017\r\n';
const r7 = Watchlist.parseCSVText(mixedCsv);
assertEqual('代码列在第3位（隔列）解析', r7.stocks, [{ name: '深中华A', code: '000017', market: 0 }]);

// 表头识别"证券代码/证券简称"别名
const aliasCsv = '证券代码,证券简称\r\nSZ000017,深中华A\r\n';
const r8 = Watchlist.parseCSVText(aliasCsv);
assertEqual('表头别名（证券代码/证券简称）解析', r8.stocks, [{ name: '深中华A', code: '000017', market: 0 }]);

// 真实新格式GBK文件（doc/导入导出/导入自选数据2.csv：代码在前，含北证920代码段）
// 注意：该文件为用户维护的样本文件，股票数量可能变化，按首行+抽样校验而非固定总数
const realCsv2Path = path.join(__dirname, '..', 'doc', '导入导出', '导入自选数据2.csv');
const realBuffer2 = fs.readFileSync(realCsv2Path);
const realText2 = Watchlist.decodeCSVBuffer(new Uint8Array(realBuffer2));
const realResult2 = Watchlist.parseCSVText(realText2);
// 预期总数 = 文件总行数 - 表头1行（当前样本19只，若用户增删股票自动适配）
const realLineCount = realText2.split(/\r?\n/).filter(l => l.trim()).length;
assertEqual('真实新格式文件解析数量=数据行数', realResult2.stocks.length, realLineCount - 1);
assertEqual('真实新格式文件无失败行', realResult2.failed, []);
assertEqual('真实新格式文件首只（代码在前）', realResult2.stocks[0], { name: '金 螳 螂', code: '002081', market: 0 });
// 抽样：北证920代码段股票
const bzStock = realResult2.stocks.find(s => s.code === '920083');
assertEqual('真实新格式文件北证920股票', bzStock, { name: '金戈新材', code: '920083', market: 0 });

console.log('\n===== 3. decodeCSVBuffer 编码识别解码 =====\n');

// UTF-8文本编码识别
const utf8Buffer = Buffer.from('名称,代码\r\n深中华A,SZ000017\r\n', 'utf-8');
const utf8Text = Watchlist.decodeCSVBuffer(new Uint8Array(utf8Buffer));
assert('UTF-8文本解码', utf8Text.includes('深中华A') && utf8Text.includes('SZ000017'));

// 真实GBK文件解码（doc/导入导出/导入自选数据.csv）
const realCsvPath = path.join(__dirname, '..', 'doc', '导入导出', '导入自选数据.csv');
const realBuffer = fs.readFileSync(realCsvPath);
const realText = Watchlist.decodeCSVBuffer(new Uint8Array(realBuffer));
assert('真实GBK文件解码成功', realText.includes('名称') && realText.includes('SZ000017'),
    `(解码前80字符: ${realText.substring(0, 80)})`);

// 真实GBK文件完整解析
const realResult = Watchlist.parseCSVText(realText);
assertEqual('真实GBK文件解析数量', realResult.stocks.length, 12);
assertEqual('真实GBK文件首只股票', realResult.stocks[0], { name: '深中华A', code: '000017', market: 0 });
assertEqual('真实GBK文件解析无失败行', realResult.failed, []);
// 抽样校验第2只（海鸥住工 SZ002084）与第3只（万向德农 SH600371）
assertEqual('真实GBK文件第2只股票', realResult.stocks[1], { name: '海鸥住工', code: '002084', market: 0 });
assertEqual('真实GBK文件第3只股票', realResult.stocks[2], { name: '万向德农', code: '600371', market: 1 });

console.log('\n===== 4. addStock/removeStock 自选CRUD（Mock localStorage） =====\n');

assert('初始自选为空', Watchlist.getList().length === 0);
assert('添加股票成功', Watchlist.addStock('000017', '深中华A', 0) === true);
assert('重复添加返回false', Watchlist.addStock('000017', '深中华A', 0) === false);
assert('添加第二只', Watchlist.addStock('600371', '好当家', 1) === true);
assertEqual('自选数量为2', Watchlist.getList().length, 2);
Watchlist.updateNote('000017', '测试备注');
assertEqual('备注更新成功', Watchlist.getList().find(s => s.code === '000017').note, '测试备注');
assert('移除股票成功', Watchlist.removeStock('000017') === true);
assert('移除不存在返回false', Watchlist.removeStock('000017') === false);
assertEqual('移除后自选数量为1', Watchlist.getList().length, 1);

console.log('\n===== 5. 北证920代码段判定（calculator/renderer/api一致性） =====\n');

// calculator.getLimitUpRate：920开头应为北证30%涨停幅度
assertEqual('920083涨停幅度为30%', Calc.getLimitUpRate('920083'), 0.30);
assertEqual('832566涨停幅度为30%', Calc.getLimitUpRate('832566'), 0.30);
assertEqual('600371涨停幅度为10%', Calc.getLimitUpRate('600371'), 0.10);
assertEqual('300189涨停幅度为20%', Calc.getLimitUpRate('300189'), 0.20);

// ===== 汇总 =====
console.log('\n===== 测试汇总 =====');
console.log(`通过: ${passCount}  失败: ${failCount}`);
if (failCount > 0) {
    console.log('存在失败用例！');
    process.exit(1);
} else {
    console.log('全部通过');
}
