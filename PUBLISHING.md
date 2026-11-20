# 发布到 Coo 扩展市场

## 当前补丁版本：0.12.1

本版合并两个界面修复：

- 将「明天」标题放在明天计划状态之前，折叠时间线时仍显示标题，展开后不重复。
- 实际记录使用 18px 原生复选框，修复宿主与插件样式叠加后勾号和选中色不可见的问题。

计划生成时刻、日程与实际记录的数据格式、纪念卡限选 1–2 条等规则保持原样。线上版本、发布状态及校验结果记在 [HANDOFF-RELEASE.md](HANDOFF-RELEASE.md)；历史功能见 [CHANGELOG.md](CHANGELOG.md)。

## 发布前检查

版本已在 [package.json](package.json) 和更新日志中同步为 0.12.1。正式发布前仍须查询 npm 官方 registry；已存在的版本不能覆盖，网络错误也不能当作版本空缺。

```powershell
Set-Location 'E:\deep seek\feed-world'
node tools/verify-spec.mjs
node tools/make-describe.mjs --check
node --check dist/webui.js
npm.cmd run prepublishOnly --cache=.tmp/npm-release-cache
git diff --check
```

每步成功后再继续。`prepublishOnly` 包含菜品、自检、在线发布检查、全部业务与面板测试及声明同步。项目没有额外的面板构建步骤，运行时客户端就是 `dist/webui.js`。

真实 Coo 界面的明暗主题、窄屏、键盘操作与下载效果须单独验收；Node DOM 测试通过不等于真实浏览器截图验收。保留 experimental 标签。

## 打包核对

```powershell
New-Item -ItemType Directory -Force '.tmp/release' | Out-Null
npm.cmd pack --json --pack-destination .tmp/release --cache=.tmp/npm-release-cache
```

应包含运行源码、面板、图标、用户文档、自描述和 28 份菜品数据。不应包含测试、工具、运行记录、备份、凭据或 `.tmp`。按实际包清单及 integrity 核对，不复用旧版本归档。

## 账号与发布

先用当前维护者自己的终端确认登录，只有未登录时才执行登录：

```powershell
npm.cmd whoami --registry=https://registry.npmjs.org
# 仅未登录时运行，并在自己的浏览器中完成认证：
# npm.cmd login --auth-type=web --registry=https://registry.npmjs.org
```

不要把密码、token、OTP 或恢复码写入代码、文档或聊天。认证、版本冲突或发布失败时先保留错误，不能自动改版本重发。

```powershell
node tools/publish-check.mjs --online
npm.cmd publish --access public --tag latest --registry=https://registry.npmjs.org --cache=.tmp/npm-release-cache
```

从项目目录发布，正常运行 `prepublishOnly`，不使用 `--ignore-scripts`。本地临时安装版本 `0.12.0+checkbox.1` 仅用于前一轮热修复，不能作为正式发布版本。

## 发布后核对

```powershell
npm.cmd view cortico-world-feast@0.12.1 version dist.integrity --json --registry=https://registry.npmjs.org
npm.cmd view cortico-world-feast dist-tags --json --registry=https://registry.npmjs.org
```

核对实际发布版本、`latest` 和归档 integrity。正常提交并推送相关 Git 改动，不强制覆盖远端；npm 发布核对成功后才创建和推送 `v0.12.1` 标签。npm 发布成功不代表 Coo 市场索引已更新。

在 Coo 中更新后完全退出再重新打开，使进程加载新面板资源。确认「明天」状态归属清楚、复选框可见且可取消、最多选择两条和保存纪念卡正常；不要改动已有用户数据。
