# GitHub Pages 部署指南

> 适用项目：股票严重异动监控系统 ｜ 站点类型：纯静态（HTML/CSS/原生JS）
> 更新日期：2026-08-31

## 一、为什么可以直接部署

本项目架构对 GitHub Pages 完全友好：

| 依赖项 | 说明 | Pages 兼容性 |
|---|---|---|
| 前端资源 | `index.html` + `css/` + `js/`，无构建步骤 | 直接托管，无需 Node 构建 |
| 行情数据 | 浏览器端 **JSONP 直连**东方财富 API（`https://push2.eastmoney.com` 等） | 全部 HTTPS，无混合内容拦截 |
| K线代理 | 主代理 `https://vercel-proxy-p.vercel.app`（HTTPS） | 兼容 |
| 数据存储 | localStorage（自选股/缓存/配置，存浏览器本地） | 兼容 |
| 交易日历 | 节假日数据内置 + 缓存 | 兼容 |
| server.py | 仅本地开发用（托管静态文件），**部署后不需要** | 部署时无需任何处理 |

## 二、部署方式一：GitHub Actions 自动部署（推荐）

仓库已内置工作流文件 [.github/workflows/deploy.yml](../.github/workflows/deploy.yml)，推送到 `main` 分支即自动发布。

### 步骤

1. **创建 GitHub 仓库**
   - 登录 GitHub → New repository
   - 仓库名建议：`unusual-movement`（任意，非 `用户名.github.io` 时站点会挂在子路径下，见第五节）

2. **推送代码**（在项目根目录执行）
   ```bash
   git init
   git add .
   git commit -m "init: 股票严重异动监控系统"
   git branch -M main
   git remote add origin https://github.com/<你的用户名>/<仓库名>.git
   git push -u origin main
   ```

3. **开启 GitHub Pages（首次配置一次）**
   - 仓库页面 → **Settings** → 左侧 **Pages**
   - Build and deployment → Source 选择 **GitHub Actions**
   - 保存即可

4. **自动部署**
   - 之后每次 `git push` 到 `main`，Actions 自动运行 deploy.yml 并发布
   - 仓库 → **Actions** 标签页可查看部署进度与日志
   - 部署成功后访问：`https://<你的用户名>.github.io/<仓库名>/`

> 注意：`.gitattributes` 已将 `doc/导入导出/*.csv` 标记为 binary，防止 Git 转码破坏 GBK 字节流（导入功能依赖原始字节解码），请勿删除该配置。

## 三、部署方式二：Deploy from branch（免 Actions）

如果不想用 Actions，直接从分支发布：

1. 推送代码到 `main` 分支（同上）
2. Settings → Pages → Source 选择 **Deploy from a branch**
3. Branch 选择 `main` / `(root)` → Save
4. 等待 1~2 分钟，访问 `https://<你的用户名>.github.io/<仓库名>/`

两种方式二选一即可。方式一支持手动触发（Actions → Deploy to GitHub Pages → Run workflow）和部署并发控制；方式二零配置但每次推送全量发布。

## 四、首次部署验证清单

部署完成后打开站点，逐项确认：

| # | 验证项 | 预期 |
|---|---|---|
| 1 | 页面打开 | 左侧菜单栏三项：市场行情/自选/设置 |
| 2 | 市场行情页 | 能加载候选股票并渲染表格（JSONP 直连东财生效） |
| 3 | 自选页 | 搜索框输入代码/名称出现下拉建议（全A股列表加载成功） |
| 4 | 导入CSV | 手动选择本地 GBK/UTF-8 CSV 文件可正常导入 |
| 5 | 导出CSV | 浏览器下载 `自选数据_YYYYMMDD.csv`，Excel 打开无乱码 |
| 6 | 设置页 | 可保存配置，刷新后 tab 记忆保持 |
| 7 | F12 控制台 | 无 JS error（网络代理偶发 502 警告属正常，自动重试切换） |

## 五、子路径部署说明（重要）

若仓库名**不是** `<用户名>.github.io`，站点地址带子路径（如 `https://user.github.io/unusual-movement/`）。当前代码已兼容：

- `index.html` 引用 CSS/JS 均为**相对路径**（`css/style.css`、`js/api.js`），子路径下正常加载
- 页面图标等资源同样为相对路径

唯一注意事项：浏览器**在线 fetch 测试样本** `doc/导入导出/导入自选数据2.csv` 时需用相对路径 `doc/导入导出/...`（不带开头的 `/`）；实际导入功能走**本地文件选择**（`<input type="file">`），不依赖该 URL，不受部署路径影响。

## 六、本地开发 vs 线上部署差异

| 项目 | 本地（server.py） | GitHub Pages |
|---|---|---|
| 访问地址 | `http://localhost:8081` / `http://<局域网IP>:8081`（已支持IP访问） | `https://<用户名>.github.io/<仓库名>/` |
| 静态资源 | Python http.server 托管 | GitHub CDN 全球加速 |
| server.py | 本地启动：`python server.py` | 不参与部署，仅本地用 |
| 缺失资源 | 返回 204（避免控制台报错） | 返回 404（不影响功能） |
| HTTPS | 否（HTTP） | 是（JSONP 全 HTTPS，天然兼容） |
| 数据更新 | 手动改代码刷新 | `git push` 自动发布（方式一） |

## 七、常见问题

**Q1：部署后行情数据加载失败？**
A：检查浏览器控制台。若为代理 502/DNS 失败，属线上代理波动，代码会自动切换备用代理重试；持续失败可在站点"设置"页更换代理地址。JSONP 直连（东财接口）不受代理影响。

**Q2：局域网其他设备如何访问本地版？**
A：`python server.py` 启动后已监听 `0.0.0.0`，同网段设备访问 `http://<本机IP>:8081` 即可（本机 IP 见启动日志或 `ipconfig`）。若无法访问，检查 Windows 防火墙对 8081 端口的入站规则：
```powershell
# 管理员 PowerShell 添加放行规则（仅私有网络）
New-NetFirewallRule -DisplayName "unusual-movement-dev" -Direction Inbound -Port 8081 -Protocol TCP -Action Allow -Profile Private
```

**Q3：导入 CSV 提示未解析到有效数据？**
A：确认 CSV 首行为表头（含"代码"字样列，位置不限），代码列支持 `SZ000017`/`SH600371`/`BJ920083`/`000017`/`000017.SZ` 格式；文件编码 GBK 或 UTF-8 均可。

**Q4：能否绑定自己的域名？**
A：可以。Settings → Pages → Custom domain 填入域名，按提示添加 CNAME 记录；建议勾选 Enforce HTTPS。子路径部署时绑定根域名后站点将位于根路径 `https://你的域名/`。

**Q5：自选股数据会同步到其他设备吗？**
A：不会。自选股存于浏览器 localStorage（设备本地），跨设备同步需自行通过"导出CSV/导入CSV"迁移。

## 八、回滚

- 方式一（Actions）：Actions 页找到历史成功部署 → Re-run；或 `git revert` 后推送，自动重新发布
- 方式二（branch）：`git revert` 推送即可，Pages 自动更新
