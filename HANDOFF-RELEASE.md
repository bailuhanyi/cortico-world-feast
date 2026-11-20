# 鱼的每一天：开发交接与发布操作单

核对时间：2026-11-20（Asia/Shanghai）。

## 本轮补丁：0.12.1

- 用户已授权将「明天」区块位置与实际记录复选框显示两个修复合并发布。
- 2026-11-20 实时查询 npm 官方 registry，`latest` 已为 **0.12.0**，下方 0.12.0 发布前交接中的版本空缺与登录状态均不代表现状。本轮使用 **0.12.1**。
- 「明天」标题移到状态提示上方并始终可见；折叠、展开和局部刷新都不再把明天状态挂在今天标题下，展开后不重复标题。中英文同步。
- 实际记录复选框恢复原生绘制，固定 18px 并去掉文本输入框内边距，避免宿主 `appearance:none` 与插件 `background` 简写共同盖掉勾号。保留限选 1–2 条及原有保存行为。
- 不修改自动生成时间、数据格式、已有日程或实际记录。
- 新增明天区块的中英文、空白/等待/已生成、折叠/展开及后台刷新行为回归；真实 Coo GUI 验收与自动化 DOM 检查仍分别记录。
- 验证：20 个测试文件合计 **601/601 通过**（其余 19 个文件 513 项通过，面板更新旧标题位置断言后 88/88 通过）；规范、824 道菜、自检 12 项、在线发布检查 18 项、源码与测试语法、声明同步及 diff 空白检查通过。明天区块新回归覆盖中英文与三种计划状态。真实 Coo GUI 验收尚未完成。
- 归档：`.tmp/release/cortico-world-feast-0.12.1.tgz`，66 个文件，823,642 字节，解包 2,388,155 字节。SHA-1 `f1e2ba84fd618929e31702e3a95eb0de23a0d414`；npm pack integrity 为 `sha512-KC5DsSHuaWyBy3VJua8qY9S6/1kjqnhcUWzf1ktFLQt6P2yR5n4WhsDlMl/U1zISRBdsM2yChIjNZNegRxP0IQ==`。
- 与经官方 integrity 核验的线上 0.12.0 比较：66 个发布文件中仅 `dist/webui.js`、`package.json`、`CHANGELOG.md`、`PUBLISHING.md` 四个不同；全部 `src/**` 与 `describe.json` 一致，无新业务逻辑。dist 只有复选框规则、明天标题位置及去除重复标题三个局部差异。
- npm 身份校验返回 **E401 Unauthorized**，需要维护者恢复登录后继续实际发布及 registry 后验收；准备完成与生成 tgz 均不代表已发布。
- 当前发布指令以 [PUBLISHING.md](PUBLISHING.md) 的 **0.12.1** 为准。

---

## 以下为 0.12.0 发布前历史交接（不要执行其中旧版本指令）

## 1. 发布前先看这里

- 项目目录：`E:\deep seek\feed-world`。
- 包名：`cortico-world-feast`；Git 分支：`main`。
- Git 远程：`origin`，仓库为 `bailuhanyi/cortico-world-feast`。
- **npm 官方 registry 的 latest 已是 0.11.1；这个版本不能再用于本轮内容。**
- 已读取并校验线上 0.11.1 归档的 SHA-512 integrity，确认它是之前的 63 文件旧包；其发布说明已用于恢复 [CHANGELOG.md](CHANGELOG.md) 中的历史 0.11.1 节。
- **本轮拟发布 0.12.0**。2026-11-20 查询该版本返回 HTTP 404，正式发布前还要重新检查。
- 写此交接时，[package.json](package.json) 仍为 **0.11.1**。本轮只准备文档与命令，没有替维护者修改包版本、创建提交、推送 Git、打标签或执行 npm 发布。
- [CHANGELOG.md](CHANGELOG.md) 已准备 0.12.0 发布说明。执行下面的升版命令后，版本与说明才会一致。
- 本地 `main` 相对本地跟踪分支 `origin/main` 领先 1 条提交；这是本地状态，不是本次联网 fetch 的结果。普通推送会同时推送尚未同步的父提交。

## 2. 已完成的内容

1. 生活回顾按日期分别展示计划与实际记录，支持独立手动标题。
2. 从 1–2 条真实记录保存文字纪念卡，可下载或复制；快照独立保存，不从计划编造事实。
3. 菜单提供喜欢、未尝过、最近吃过快捷筛选和最多三道的尝鲜推荐。
4. 三套生活提醒预设先预览差量，确认且持久化成功后才应用；过期预览拒绝覆盖。
5. 首页层级、字号、连续时间线、键盘焦点和减少动态效果已整理。
6. 菜单、套餐、历史与回顾保留浏览位置；文字草稿仅会话保留，不写入持久浏览偏好。
7. 日期条和按需迷你月历提供日期定位；标记仅来自可用实际记录和纪念卡，损坏来源显示未知，未来不读事实文件。
8. 历史回顾独立呈现；后台刷新保留内容和编辑节点，忽略迟到响应；写入成功与后续读取失败分别反馈，重试仅重读。

沿用 0.11.1 已发布的持续工作排程与单日预览/清理/撤销规则，不将这些重复当作 0.12.0 首次新增功能。

## 3. 已验证与尚待验收

最近一次完整验证：**20 个测试文件、600/600 通过**。

- 面板行为测试 87 项、月历数据测试 8 项、UI 后端测试 9 项。
- 覆盖四条操作链：菜单返回与跨面板；历史日期和阅读位置；失败/过期时保留草稿；端菜、纪念卡与预设的准确回执。
- 另覆盖乱序响应、卸载后返回、中文 IME 表单节点、月历未知/未来状态及关闭后不轮询。
- 自检 12 项、824 道菜校验、规范检查、声明同步、离线发布检查 17 项、源码语法与 `git diff --check` 通过。
- 仍为 20 个模型工具、7 个事件、42 个配置项（defaults 含 enabled 共 43 键）、4 个面板；最近 UX 轮没有增加模型工具或常驻提示词。

**这些是源码与 Node DOM 行为验证，不是真实 Coo GUI 验收。** 明暗主题、窄屏、宿主滚动、真实键盘焦点和下载体验仍需在 Coo 中检查。保留 experimental 标签。

本次交接调整的是文档与发布说明，没有重新运行 600 项业务测试；`npm publish` 会按当前项目脚本重新执行发布前全套检查。

## 4. 关键实现与数据边界

- [src/world.js](src/world.js)：工具、面板调用、串行写入、只读 UI 上下文与月摘要缓存。
- [dist/webui.js](dist/webui.js)：实际使用的四面板客户端。项目没有可用的 build-webui 脚本，不要另造构建步骤。
- [src/life/journal.js](src/life/journal.js)：实际记录 ID、独立标题、纪念卡快照与严格存储校验。
- [src/life/presets.js](src/life/presets.js)：七项既有设置的预设差量及 revision 校验。
- [src/life/calendar.js](src/life/calendar.js)：按月只读标记，最多 31 天、最多四个日期任务并发。
- [src/dishes.js](src/dishes.js)：快捷筛选与分层尝鲜推荐。
- [test/panels.test.mjs](test/panels.test.mjs)、[test/experience.test.mjs](test/experience.test.mjs)、[test/calendar.test.mjs](test/calendar.test.mjs)、[test/ux-backend.test.mjs](test/ux-backend.test.mjs)：主要操作链与后端回归。

运行数据不进仓库：工作规则位于 `feast/work-policy.json`；回顾位于 `feast/journal/YYYY-MM-DD.json`。清日程不清主动保存的回顾和纪念卡。计划不等于已完成事实；不从日程自动完成跨天小事。

月摘要按需读取，缓存 30 秒，相关保存、恢复、清除后失效；坏源不得假成空数据。浏览偏好按实例隔离，草稿和旧确认/revision 不作持久恢复。

## 5. 推送 Git

在自己的交互式 PowerShell 中分段执行。任何命令报错就停下；不要使用强制推送，不要用 reset/restore 丢弃当前改动。

```powershell
Set-Location 'E:\deep seek\feed-world'

# 已经是 0.12.0 时只跳过这一条，不要反复升版。
npm.cmd version 0.12.0 --no-git-tag-version
if ($LASTEXITCODE -ne 0) { throw '升版失败，先检查 package.json' }

node tools/make-describe.mjs --check
if ($LASTEXITCODE -ne 0) { throw '声明检查失败' }
node tools/publish-check.mjs --online
if ($LASTEXITCODE -ne 0) { throw '发布检查失败' }
git diff --check
if ($LASTEXITCODE -ne 0) { throw '差异格式检查失败' }

git status --short
# 先看清差异，只加入本轮相关文件；.tmp、备份、运行数据不提交。
git add -- src dist test package.json describe.json README.md GUIDE.md CHANGELOG.md HANDOFF.md HANDOFF-RELEASE.md PUBLISHING.md
if ($LASTEXITCODE -ne 0) { throw '暂存失败' }
git diff --cached --stat
```

确认暂存范围正确后再执行：

```powershell
git commit -m "feat: release 0.12.0 daily-life journal and browsing UX"
if ($LASTEXITCODE -ne 0) { throw '提交失败，先处理错误' }
git push origin main
if ($LASTEXITCODE -ne 0) { throw '推送失败，不要强制覆盖远端' }
```

核对时没有根目录受跟踪的 lockfile；如维护者随后引入 lockfile，需一并核对其版本和暂存范围。

## 6. 发布 npm

使用维护者自己的交互式终端，先确认登录账号：

```powershell
Set-Location 'E:\deep seek\feed-world'
npm.cmd whoami --registry=https://registry.npmjs.org
# 未登录时才执行，然后重试 whoami：
# npm.cmd login --registry=https://registry.npmjs.org
```

确认账号有该包的发布权限，并确认本地版本为 0.12.0 后执行：

```powershell
node -e "const p=require('./package.json');if(p.version!=='0.12.0')throw new Error('本地版本不是0.12.0');console.log(p.version);"
if ($LASTEXITCODE -ne 0) { throw '先完成版本修改' }
node tools/publish-check.mjs --online
if ($LASTEXITCODE -ne 0) { throw '版本可能已占用或发布检查失败' }

# 仅 404 表示该版本尚不存在；网络错误或其他状态均停止。
node --input-type=module -e "const r=await fetch('https://registry.npmjs.org/cortico-world-feast/0.12.0',{signal:AbortSignal.timeout(15000)});if(r.status!==404)throw new Error('版本检查未通过，HTTP '+r.status);"
if ($LASTEXITCODE -ne 0) { throw '无法确认 0.12.0 可发布' }

npm.cmd publish --access public --tag latest --registry=https://registry.npmjs.org --cache=.tmp/npm-release-cache
if ($LASTEXITCODE -ne 0) { throw '发布未成功，保留错误输出；不要直接改版本重发' }
```

从项目目录发布；不要发布旧的 0.11.1 tgz，也不要使用 `--ignore-scripts` 跳过 `prepublishOnly`。按 npm 返回的登录/浏览器或二次验证提示完成认证，不把密码、token、OTP 或恢复码写入仓库或聊天。

## 7. 发布成功后验证与标签

```powershell
npm.cmd view cortico-world-feast@0.12.0 version dist.integrity --json --registry=https://registry.npmjs.org
if ($LASTEXITCODE -ne 0) { throw '发布后版本查询失败，先确认 registry 状态' }
npm.cmd view cortico-world-feast dist-tags --json --registry=https://registry.npmjs.org
if ($LASTEXITCODE -ne 0) { throw 'dist-tags 查询失败' }
```

应看到版本 0.12.0 和预期 latest。核对成功后再打对应标签，标签已存在时先核实，不强制覆盖：

```powershell
git tag -a v0.12.0 -m "Release 0.12.0"
if ($LASTEXITCODE -ne 0) { throw '标签未创建，先检查现有标签' }
git push origin v0.12.0
if ($LASTEXITCODE -ne 0) { throw '标签推送失败' }
```

最后记录真实 Git 提交/推送、npm 版本与 integrity，再在 Coo 更新后做 GUI 验收。npm 发布成功不等于市场索引已经更新。
