/**
 * 表格渲染模块
 * 负责将异动分析结果渲染到页面表格中
 *
 * 展示逻辑：
 * - 每只股票显示最紧急的异动规则（100异动或200异动）
 * - 新增"偏离值"列：当前窗口内累计涨幅（与同花顺对齐）
 * - 新增"是否触发"列：标记是否已触发异动
 * - 新增"异动限制"列：显示该股票所属板块的涨停幅度
 * - 板块颜色区分：创业板/科创板/北证用不同颜色标识
 * - 股票代码超链接到东方财富详情页
 * - T+N触发值：不可触发的标记为灰色（超过涨停限制）
 */
const Renderer = (function () {

    // DOM元素缓存
    const elements = {};

    /**
     * 初始化DOM元素引用
     */
    function init() {
        elements.tableBody = document.getElementById('stockTableBody');
        elements.loading = document.getElementById('loading');
        elements.loadingText = document.getElementById('loadingText');
        elements.error = document.getElementById('error');
        elements.errorText = document.getElementById('errorText');
        elements.dataDate = document.getElementById('dataDate');
        elements.count100 = document.getElementById('count100');
        elements.count200 = document.getElementById('count200');
        elements.countTotal = document.getElementById('countTotal');
        elements.tableSection = document.getElementById('tableSection');
    }

    /** 显示加载状态 */
    function showLoading(text = '正在加载数据...') {
        elements.loading.style.display = 'flex';
        elements.loadingText.textContent = text;
        elements.error.style.display = 'none';
        elements.tableSection.style.display = 'none';
    }

    /** 更新加载进度 */
    function updateProgress(completed, total) {
        elements.loadingText.textContent = `正在获取K线数据... (${completed}/${total})`;
    }

    /** 隐藏加载状态 */
    function hideLoading() {
        elements.loading.style.display = 'none';
    }

    /** 显示错误信息 */
    function showError(message) {
        elements.loading.style.display = 'none';
        elements.tableSection.style.display = 'none';
        elements.error.style.display = 'flex';
        elements.errorText.textContent = message;
    }

    /** 隐藏错误信息 */
    function hideError() {
        elements.error.style.display = 'none';
    }

    /** 格式化涨跌幅显示 */
    function formatChange(value) {
        if (value === null || value === undefined) return '--';
        const fixed = value.toFixed(2);
        return value > 0 ? '+' + fixed + '%' : fixed + '%';
    }

    /** 格式化触发值显示 */
    function formatTrigger(value) {
        if (value === null) return '--';
        if (value === 0) return '已触发';
        return value.toFixed(2) + '%';
    }

    /** 格式化偏离值显示（同花顺格式：N日偏离值:XX.XX%）
     *  currentGain现在是偏离值（个股涨幅-指数涨幅）
     */
    function formatDeviation(currentGain, trendDays) {
        if (currentGain === null || currentGain === undefined) return '--';
        const days = trendDays || 0;
        const pct = (currentGain * 100).toFixed(2);
        return days + '日偏离值:' + pct + '%';
    }

    /** 获取涨跌幅CSS类名 */
    function getChangeClass(value) {
        if (value > 0) return 'change-up';
        if (value < 0) return 'change-down';
        return 'change-zero';
    }

    /**
     * 获取触发值CSS类名
     * @param {number|null} value - 触发值
     * @param {boolean} achievable - 是否可触发
     */
    function getTriggerClass(value, achievable) {
        if (value === null) return 'trigger-normal';
        if (value === 0) return 'trigger-triggered';
        if (!achievable) return 'trigger-impossible';
        if (value < 5) return 'trigger-danger';
        if (value < 10) return 'trigger-warning';
        return 'trigger-normal';
    }

    /**
     * 根据股票代码获取板块类型
     * @param {string} code - 股票代码
     * @returns {string} 板块类型: 'cy'(创业板), 'kc'(科创板), 'bz'(北证), 'default'(主板)
     */
    function getBoardType(code) {
        if (!code) return 'default';
        const prefix = String(code).substring(0, 2);
        if (prefix === '30') return 'cy';   // 创业板
        if (prefix === '68') return 'kc';   // 科创板
        if (prefix === '8' || prefix === '4') return 'bz';  // 北证
        return 'default';
    }

    /**
     * 获取板块对应的CSS类名（用于名称颜色区分）
     * @param {string} boardType - 板块类型
     * @returns {string} CSS类名
     */
    function getBoardClass(boardType) {
        const map = {
            'cy': 'board-cy',   // 创业板 - 紫色
            'kc': 'board-kc',   // 科创板 - 天蓝色
            'bz': 'board-bz'    // 北证 - 橙色
        };
        return map[boardType] || '';
    }

    /**
     * 获取板块涨停幅度显示文本
     * @param {number} limitUpRate - 涨停幅度（如0.10）
     * @returns {string} 显示文本，如 "±10%"
     */
    function formatLimitUp(limitUpRate) {
        if (limitUpRate === undefined || limitUpRate === null) return '--';
        return '±' + (limitUpRate * 100).toFixed(0) + '%';
    }

    /**
     * 生成东方财富股票详情页链接
     * @param {string} code - 股票代码
     * @returns {string} 完整URL
     */
    function getEastmoneyUrl(code) {
        // 东方财富股票详情页格式：https://quote.eastmoney.com/{market}{code}.html
        const boardType = getBoardType(code);
        let marketPrefix = 'sh';  // 默认沪市主板
        if (boardType === 'cy' || code.substring(0, 1) === '0' || code.substring(0, 1) === '3') {
            marketPrefix = 'sz';  // 深市（含创业板）
        } else if (boardType === 'kc' || code.substring(0, 1) === '6') {
            marketPrefix = 'sh';  // 沪市（含科创板）
        } else if (boardType === 'bz') {
            marketPrefix = 'bj';  // 北证
        }
        return `https://quote.eastmoney.com/${marketPrefix}${code}.html`;
    }
    function formatDate(dateStr) {
        if (!dateStr) return '--';
        const parts = dateStr.split('-');
        if (parts.length === 3) {
            return parts[1] + '-' + parts[2];
        }
        return dateStr;
    }

    /**
     * 更新表头的T+N列为实际交易日日期
     * @param {string} baseDate - 基准日期（K线最新日期）YYYY-MM-DD
     * @param {number} forwardDays - 提前天数
     */
    function updateTableHeaders(baseDate, forwardDays) {
        for (let day = 0; day < forwardDays; day++) {
            const th = document.querySelector('th[data-sort="trigger' + day + '"]');
            if (!th) continue;

            // 计算T+N对应的交易日日期
            const dateLabel = getTradeDateLabel(baseDate, day);
            // 确保始终有文本显示（防止dateLabel返回空字符串）
            th.textContent = (dateLabel && dateLabel.trim()) ? dateLabel : ('T+' + day);
        }
    }

    /**
     * 获取T+N对应的交易日日期标签
     * @param {string} baseDate - 基准日期 YYYY-MM-DD
     * @param {number} dayOffset - 天数偏移
     * @returns {string} 日期标签，如 "6/15"
     */
    function getTradeDateLabel(baseDate, dayOffset) {
        if (!baseDate || !TradingCalendar) return null;

        try {
            const base = new Date(baseDate + 'T00:00:00');

            // T+0 = baseDate的下一交易日（触发值对应"明天"需要涨多少）
            // T+N = baseDate后的第(N+1)个交易日
            let current = new Date(base);
            let count = 0;
            const targetCount = dayOffset + 1; // T+0找第1个，T+1找第2个...

            while (count < targetCount && current.getFullYear() < 2100) {
                current.setDate(current.getDate() + 1);
                if (TradingCalendar.isTradingDay(current)) {
                    count++;
                    if (count === targetCount) {
                        const m = current.getMonth() + 1;
                        const d = current.getDate();
                        return m + '/' + d;
                    }
                }
            }
        } catch (e) {
            // 忽略错误
        }
        return null;
    }

    /**
     * 渲染异动分析结果到表格
     * @param {Array} analysisResults - 异动分析结果数组
     * @param {number} forwardDays - 提前天数
     */
    function renderTable(analysisResults, forwardDays = 5) {
        elements.tableSection.style.display = 'block';
        elements.loading.style.display = 'none';
        elements.error.style.display = 'none';

        // 更新表头日期
        if (analysisResults.length > 0 && analysisResults[0].date) {
            updateTableHeaders(analysisResults[0].date, forwardDays);
        }

        // 更新统计概览
        let count100 = 0;
        let count200 = 0;

        analysisResults.forEach(result => {
            result.rules.forEach(rule => {
                const trigger0 = rule.triggers[0];
                const limitUpRate = result.limitUpRate;
                // 只统计当日可触发的风险
                if (UnusualCalculator.isTriggerAchievable(trigger0, limitUpRate, 0)) {
                    if (rule.ruleName === '100异动' && trigger0 !== null && trigger0 > 0) {
                        count100++;
                    }
                    if (rule.ruleName === '200异动' && trigger0 !== null && trigger0 > 0) {
                        count200++;
                    }
                }
            });
        });

        elements.count100.textContent = count100;
        elements.count200.textContent = count200;
        elements.countTotal.textContent = analysisResults.length;

        // 设置日期
        if (analysisResults.length > 0) {
            elements.dataDate.textContent = '数据日期: ' + analysisResults[0].date;
        }

        // 构建表格行
        const fragment = document.createDocumentFragment();

        analysisResults.forEach((result, index) => {
            const tr = document.createElement('tr');

            // 找最紧急的规则
            const dominantRule = result.rules.find(r => r.ruleName === result.dominantRule);
            if (!dominantRule) return;

            // 获取板块信息（用于颜色区分）
            const boardType = getBoardType(result.code);
            const boardClass = getBoardClass(boardType);

            // 排名
            const tdRank = document.createElement('td');
            tdRank.className = 'col-rank';
            tdRank.textContent = index + 1;
            tr.appendChild(tdRank);

            // 名称（带板块颜色）
            const tdName = document.createElement('td');
            tdName.className = 'col-name' + (boardClass ? ' ' + boardClass : '');
            tdName.textContent = result.name;
            tr.appendChild(tdName);

            // 代码（带东方财富超链接）
            const tdCode = document.createElement('td');
            tdCode.className = 'col-code';
            const codeLink = document.createElement('a');
            codeLink.href = getEastmoneyUrl(result.code);
            codeLink.target = '_blank';
            codeLink.rel = 'noopener noreferrer';
            codeLink.title = '查看东方财富详情';
            codeLink.className = 'code-link';
            codeLink.textContent = result.code;
            tdCode.appendChild(codeLink);
            tr.appendChild(tdCode);

            // 日期
            const tdDate = document.createElement('td');
            tdDate.className = 'col-date';
            tdDate.textContent = formatDate(result.date);
            tr.appendChild(tdDate);

            // 当前幅度
            const tdChange = document.createElement('td');
            tdChange.className = 'col-change ' + getChangeClass(result.changePercent);
            tdChange.textContent = formatChange(result.changePercent);
            tr.appendChild(tdChange);

            // 异动类型标签
            const tdTag = document.createElement('td');
            tdTag.className = 'col-tag';
            const badge = document.createElement('span');
            badge.className = 'tag-badge ' + dominantRule.tagClass;
            badge.textContent = dominantRule.ruleName;
            tdTag.appendChild(badge);
            tr.appendChild(tdTag);

            // 偏离值（同花顺格式：N日偏离值:XX.XX%）
            const tdDeviation = document.createElement('td');
            tdDeviation.className = 'col-deviation';
            tdDeviation.textContent = formatDeviation(dominantRule.currentGain, dominantRule.trendDays);
            tr.appendChild(tdDeviation);

            // 是否触发
            const tdTriggered = document.createElement('td');
            tdTriggered.className = 'col-triggered';
            if (dominantRule.triggered) {
                tdTriggered.innerHTML = '<span class="tag-triggered-yes">已触发</span>';
            } else {
                tdTriggered.innerHTML = '<span class="tag-triggered-no">未触发</span>';
            }
            tr.appendChild(tdTriggered);

            // T+0 到 T+(forwardDays-1) 触发值
            for (let day = 0; day < forwardDays; day++) {
                const td = document.createElement('td');
                td.className = 'col-trigger';

                const dayTrigger = dominantRule.triggers[day];
                const achievable = UnusualCalculator.isTriggerAchievable(dayTrigger, result.limitUpRate, day);

                if (dayTrigger !== null && dayTrigger !== undefined) {
                    td.textContent = formatTrigger(dayTrigger);
                    td.classList.add(getTriggerClass(dayTrigger, achievable));
                    // 不可触发的加title提示
                    if (!achievable && dayTrigger > 0) {
                        td.title = '超过' + (day + 1) + '天涨停限制，不可能触发';
                    }
                } else {
                    td.textContent = '--';
                    td.classList.add('trigger-normal');
                }

                tr.appendChild(td);
            }

            fragment.appendChild(tr);
        });

        // 清空并填充表格
        elements.tableBody.innerHTML = '';
        elements.tableBody.appendChild(fragment);
    }

    /**
     * 渲染空状态
     * @param {string} message - 提示信息
     */
    function renderEmpty(message = '暂无数据') {
        elements.tableSection.style.display = 'block';
        elements.loading.style.display = 'none';
        elements.error.style.display = 'none';

        elements.tableBody.innerHTML = '';
        const tr = document.createElement('tr');
        const td = document.createElement('td');
        td.colSpan = 12; // 12列: #|名称|代码|日期(6.12)|当前幅度|异动类型|偏离值|是否触发|T+0|T+1|T+2|T+3
        td.style.textAlign = 'center';
        td.style.padding = '40px';
        td.style.color = '#64748b';
        td.textContent = message;
        tr.appendChild(td);
        elements.tableBody.appendChild(tr);
    }

    // 公开接口
    return {
        init,
        showLoading,
        updateProgress,
        hideLoading,
        showError,
        hideError,
        renderTable,
        renderEmpty
    };
})();
