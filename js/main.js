/**
 * 主程序入口
 * 协调API、计算器、渲染器各模块，处理用户交互
 */
const App = (function () {

    // 默认配置
    const DEFAULT_CONFIG = {
        topN: 100,              // 监控TOP N只股票
        forwardDays: 5,         // 提前天数
        autoRefresh: 300,       // 自动刷新间隔(秒)，0=关闭
        onlyRisk: true,         // 仅显示有异动风险的股票
        concurrency: 6          // API并发数
    };

    // 运行状态
    let config = { ...DEFAULT_CONFIG };
    let autoRefreshTimer = null;
    let isLoading = false;

    /**
     * 从localStorage加载配置
     */
    function loadConfig() {
        try {
            const saved = localStorage.getItem('unusual_config');
            if (saved) {
                config = { ...DEFAULT_CONFIG, ...JSON.parse(saved) };
            }
        } catch (e) {
            config = { ...DEFAULT_CONFIG };
        }
    }

    /**
     * 保存配置到localStorage
     */
    function saveConfig() {
        try {
            localStorage.setItem('unusual_config', JSON.stringify(config));
        } catch (e) {
            console.warn('保存配置失败:', e);
        }
    }

    /**
     * 初始化设置面板的值
     */
    function initSettingsUI() {
        document.getElementById('settingTopN').value = config.topN;
        document.getElementById('settingForwardDays').value = config.forwardDays;
        document.getElementById('settingAutoRefresh').value = config.autoRefresh;
        document.getElementById('settingOnlyRisk').checked = config.onlyRisk;
    }

    /**
     * 从设置面板读取配置
     */
    function readSettingsUI() {
        config.topN = parseInt(document.getElementById('settingTopN').value) || DEFAULT_CONFIG.topN;
        config.forwardDays = parseInt(document.getElementById('settingForwardDays').value) || DEFAULT_CONFIG.forwardDays;
        config.autoRefresh = parseInt(document.getElementById('settingAutoRefresh').value) || 0;
        config.onlyRisk = document.getElementById('settingOnlyRisk').checked;

        // 校验范围
        config.topN = Math.max(10, Math.min(500, config.topN));
        config.forwardDays = Math.max(1, Math.min(10, config.forwardDays));
        config.autoRefresh = Math.max(0, Math.min(600, config.autoRefresh));
    }

    /**
     * 主流程：获取数据 → 计算异动 → 渲染结果
     */
    async function run() {
        if (isLoading) return;
        isLoading = true;

        const btnRefresh = document.getElementById('btnRefresh');
        btnRefresh.disabled = true;

        try {
            // 第1步：获取涨幅排行
            Renderer.showLoading('正在获取涨幅排行数据...');
            const stocks = await StockAPI.getTopGainStocks(config.topN);

            if (stocks.length === 0) {
                Renderer.renderEmpty('未获取到股票数据，可能非交易时间');
                return;
            }

            // 第2步：批量获取K线数据
            Renderer.showLoading('正在获取K线数据... (0/' + stocks.length + ')');
            const klineMap = await StockAPI.batchGetKline(
                stocks.map(s => s.secid),
                config.concurrency,
                (completed, total) => Renderer.updateProgress(completed, total)
            );

            // 第3步：计算异动分析
            Renderer.showLoading('正在计算异动分析...');
            let results = UnusualCalculator.analyzeAll(
                stocks,
                klineMap,
                config.forwardDays,
                config.onlyRisk
            );

            // 如果仅显示风险股票且结果为空，尝试显示全部（避免用户看到空白页）
            if (results.length === 0 && config.onlyRisk) {
                results = UnusualCalculator.analyzeAll(
                    stocks,
                    klineMap,
                    config.forwardDays,
                    false
                );
            }

            // 第4步：渲染结果
            if (results.length === 0) {
                Renderer.renderEmpty('当前无股票接近异动线');
            } else {
                Renderer.renderTable(results, config.forwardDays);
            }

            // 如果使用模拟数据，在页面显示提示和重试链接
            if (StockAPI.isUsingMock()) {
                const dataDate = document.getElementById('dataDate');
                dataDate.innerHTML = '模拟数据（API不可用）<a href="javascript:void(0)" id="retryRealData" style="color:#3b82f6;margin-left:8px;text-decoration:underline;cursor:pointer">重试真实数据</a>';
                dataDate.style.color = '#f59e0b';
                document.getElementById('retryRealData').addEventListener('click', () => {
                    StockAPI.resetMock();
                    run();
                });
            }

        } catch (error) {
            console.error('运行异常:', error);
            Renderer.showError('数据加载失败: ' + error.message);
        } finally {
            isLoading = false;
            btnRefresh.disabled = false;
        }
    }

    /**
     * 启动自动刷新
     */
    function startAutoRefresh() {
        stopAutoRefresh();
        if (config.autoRefresh > 0) {
            autoRefreshTimer = setInterval(() => {
                run();
            }, config.autoRefresh * 1000);
        }
    }

    /**
     * 停止自动刷新
     */
    function stopAutoRefresh() {
        if (autoRefreshTimer) {
            clearInterval(autoRefreshTimer);
            autoRefreshTimer = null;
        }
    }

    /**
     * 绑定事件
     */
    function bindEvents() {
        // 刷新按钮
        document.getElementById('btnRefresh').addEventListener('click', () => {
            run();
        });

        // 重试按钮
        document.getElementById('btnRetry').addEventListener('click', () => {
            Renderer.hideError();
            run();
        });

        // 设置面板
        document.getElementById('btnSettings').addEventListener('click', () => {
            initSettingsUI();
            document.getElementById('settingsPanel').style.display = 'flex';
        });

        document.getElementById('btnCancelSettings').addEventListener('click', () => {
            document.getElementById('settingsPanel').style.display = 'none';
        });

        document.getElementById('btnSaveSettings').addEventListener('click', () => {
            readSettingsUI();
            saveConfig();
            document.getElementById('settingsPanel').style.display = 'none';
            // 配置变更后重新运行
            startAutoRefresh();
            run();
        });

        // 点击遮罩关闭设置面板
        document.querySelector('.settings-overlay').addEventListener('click', () => {
            document.getElementById('settingsPanel').style.display = 'none';
        });

        // 表头排序
        document.querySelectorAll('.stock-table th[data-sort]').forEach(th => {
            th.addEventListener('click', () => {
                const sortField = th.dataset.sort;
                sortTable(sortField, th);
            });
        });
    }

    /**
     * 表格排序
     * @param {string} field - 排序字段
     * @param {HTMLElement} th - 表头元素
     */
    function sortTable(field, th) {
        const tbody = document.getElementById('stockTableBody');
        const rows = Array.from(tbody.querySelectorAll('tr'));

        if (rows.length === 0) return;

        // 切换排序方向
        const isAsc = th.classList.contains('sort-asc');
        document.querySelectorAll('.stock-table th').forEach(h => {
            h.classList.remove('sort-asc', 'sort-desc');
        });
        th.classList.add(isAsc ? 'sort-desc' : 'sort-asc');

        const direction = isAsc ? -1 : 1;

        rows.sort((a, b) => {
            const cellsA = a.querySelectorAll('td');
            const cellsB = b.querySelectorAll('td');

            let valA, valB;

            switch (field) {
                case 'name':
                    valA = cellsA[1].textContent;
                    valB = cellsB[1].textContent;
                    return direction * valA.localeCompare(valB, 'zh');
                case 'change':
                    valA = parseFloat(cellsA[4].textContent) || 0;
                    valB = parseFloat(cellsB[4].textContent) || 0;
                    break;
                case 'trigger0':
                case 'trigger1':
                case 'trigger2':
                case 'trigger3':
                case 'trigger4':
                    const colIndex = parseInt(field.replace('trigger', '')) + 6;
                    valA = parseFloat(cellsA[colIndex].textContent) || 999;
                    valB = parseFloat(cellsB[colIndex].textContent) || 999;
                    break;
                default:
                    return 0;
            }

            return direction * (valA - valB);
        });

        // 重新插入排序后的行
        rows.forEach(row => tbody.appendChild(row));
    }

    /**
     * 初始化应用
     */
    function init() {
        loadConfig();
        Renderer.init();
        bindEvents();
        startAutoRefresh();
        run();
    }

    // 页面加载完成后初始化
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    return { init, run };
})();
