/**
 * 表格渲染模块
 * 负责将异动分析结果渲染到页面表格中
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

    /**
     * 显示加载状态
     * @param {string} text - 加载提示文字
     */
    function showLoading(text = '正在加载数据...') {
        elements.loading.style.display = 'flex';
        elements.loadingText.textContent = text;
        elements.error.style.display = 'none';
        elements.tableSection.style.display = 'none';
    }

    /**
     * 更新加载进度
     * @param {number} completed - 已完成数
     * @param {number} total - 总数
     */
    function updateProgress(completed, total) {
        elements.loadingText.textContent = `正在获取K线数据... (${completed}/${total})`;
    }

    /**
     * 隐藏加载状态
     */
    function hideLoading() {
        elements.loading.style.display = 'none';
    }

    /**
     * 显示错误信息
     * @param {string} message - 错误信息
     */
    function showError(message) {
        elements.loading.style.display = 'none';
        elements.tableSection.style.display = 'none';
        elements.error.style.display = 'flex';
        elements.errorText.textContent = message;
    }

    /**
     * 隐藏错误信息
     */
    function hideError() {
        elements.error.style.display = 'none';
    }

    /**
     * 格式化涨跌幅显示
     * @param {number} value - 涨跌幅值
     * @returns {string} 格式化后的字符串
     */
    function formatChange(value) {
        if (value === null || value === undefined) return '--';
        const fixed = value.toFixed(2);
        return value > 0 ? '+' + fixed + '%' : fixed + '%';
    }

    /**
     * 格式化触发值显示
     * @param {number|null} value - 触发值
     * @returns {string}
     */
    function formatTrigger(value) {
        if (value === null) return '--';
        if (value === 0) return '0%';
        return value.toFixed(2) + '%';
    }

    /**
     * 获取涨跌幅CSS类名
     * @param {number} value - 涨跌幅值
     * @returns {string} CSS类名
     */
    function getChangeClass(value) {
        if (value > 0) return 'change-up';
        if (value < 0) return 'change-down';
        return 'change-zero';
    }

    /**
     * 获取触发值CSS类名
     * @param {number|null} value - 触发值
     * @returns {string} CSS类名
     */
    function getTriggerClass(value) {
        if (value === null) return 'trigger-normal';
        if (value === 0) return 'trigger-triggered';
        if (value < 5) return 'trigger-danger';
        if (value < 10) return 'trigger-warning';
        return 'trigger-normal';
    }

    /**
     * 格式化日期（只取月-日）
     * @param {string} dateStr - 日期字符串 (YYYY-MM-DD)
     * @returns {string}
     */
    function formatDate(dateStr) {
        if (!dateStr) return '--';
        const parts = dateStr.split('-');
        if (parts.length === 3) {
            return parts[1] + '-' + parts[2];
        }
        return dateStr;
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

        // 更新统计概览
        let count100 = 0;
        let count200 = 0;

        analysisResults.forEach(result => {
            result.rules.forEach(rule => {
                if (rule.triggers[0] !== null && rule.triggers[0] <= 30) {
                    if (rule.ruleName === '100异动') count100++;
                    if (rule.ruleName === '200异动') count200++;
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

            // 排名
            const tdRank = document.createElement('td');
            tdRank.className = 'col-rank';
            tdRank.textContent = index + 1;
            tr.appendChild(tdRank);

            // 名称
            const tdName = document.createElement('td');
            tdName.className = 'col-name';
            tdName.textContent = result.name;
            tr.appendChild(tdName);

            // 代码
            const tdCode = document.createElement('td');
            tdCode.className = 'col-code';
            tdCode.textContent = result.code;
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

            // 异动类型标签 + 各规则触发值
            const tdTag = document.createElement('td');
            tdTag.className = 'col-tag';

            // 为每条规则生成标签和触发值列
            result.rules.forEach(rule => {
                // 标签
                const badge = document.createElement('span');
                badge.className = 'tag-badge ' + rule.tagClass;
                badge.textContent = rule.ruleName;
                tdTag.appendChild(badge);
            });
            tr.appendChild(tdTag);

            // T+0 到 T+(forwardDays-1) 触发值
            // 取各规则中最紧急的触发值显示
            for (let day = 0; day < forwardDays; day++) {
                const td = document.createElement('td');
                td.className = 'col-trigger';

                // 收集所有规则在该天的触发值
                const dayTriggers = result.rules
                    .map(r => r.triggers[day])
                    .filter(v => v !== null);

                if (dayTriggers.length === 0) {
                    td.textContent = '--';
                    td.classList.add('trigger-normal');
                } else {
                    // 取最小值（最紧急的）
                    const minVal = Math.min(...dayTriggers);
                    td.textContent = formatTrigger(minVal);
                    td.classList.add(getTriggerClass(minVal));
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
        td.colSpan = 11;
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
