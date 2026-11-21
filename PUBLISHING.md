# 发布到 Coo 扩展市场

> **当前发布版本：0.13.0（待发）**。D1（联动配置读取与候选说明）与 D2（新增 `lifeStoryOn`，明确选择娱乐时间为地点和故事来源，默认关闭）已并入工作区；未单独发布的 0.12.1 三项界面修复随本版一起发布。2026-11-21 实时查询 npm 官方 registry：`latest` 为 `0.12.0`，`0.13.0` 未被占用。此前 `.tmp/release/0.12.1-final/` 只含三项界面修复，不含 D1/D2，不能用旧归档或旧校验结果代表当前源码。本机准备阶段只跑离线检查与在线版本占用查询，不含安装或发布；`npm publish` 与 `git push` 由维护者本人执行。

D2 新增 `lifeStoryOn`，默认 `false`；配置卡当前 43 项，默认值含宿主管理的 `enabled` 共 44 键。用户明确选择后还需 `lifeFreeFunOn !== false` 与 `worlds.fun.enabled === true`，只省略自动旧 fun/map 行，保留手写内容、排序与独立开关，关闭后回旧路径；不自动合并两处住所。指定故事由用户在故事面板确认，生活记录另行选择且保存成功才算记账，无 `sourceRef` 幂等保证。

接口和回执约定见 [README 的 D2 开发说明](README.md#d2-故事查询契约开发说明) 及独立 [F3–F5 契约](STORY-QUERY-CONTRACT-F3-F5.md)：最低构建是 `cortico-world-fun@0.3.2-story.2`；另有 `0.3.2` 源码快照，两者都不能证明本次已安装或当前会话有能力。六个只读查询不会开局，普通 `fun_go` 不能指定故事，没有 `fun_story_start`，也不用管理工具 `fun_story` 替代。将来发布前需核对声明、配置计数和新旧路径兼容，并如实记录当次验证；本段没有宣称本轮测试通过。

## 三项界面修复的历史补丁版本：0.12.1（未单独发布，随 0.13.0 发布）

本版合并三项界面调整：

- 将「明天」标题放在明天计划状态之前，折叠时间线时仍显示标题，展开后不重复。
- 实际记录使用 18px 原生复选框，修复宿主与插件样式叠加后勾号和选中色不可见的问题。
- 套餐按钮由「看这一桌」改为「换一桌」，与原有重新搭配的行为对应；用户指南同步更新。

计划生成时刻、日程与实际记录的数据格式、纪念卡限选 1–2 条等规则保持原样。线上版本、发布状态及校验结果记在 [HANDOFF-RELEASE.md](HANDOFF-RELEASE.md)；历史功能见 [CHANGELOG.md](CHANGELOG.md)。

## 发布前检查

版本已在 [package.json](package.json) 和更新日志中同步为 0.13.0。正式发布前仍须查询 npm 官方 registry；已存在的版本不能覆盖，网络错误也不能当作版本空缺。

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
New-Item -ItemType Directory -Force '.tmp/release/0.13.0-final' | Out-Null
npm.cmd pack --json --pack-destination .tmp/release/0.13.0-final --cache=.tmp/npm-release-cache
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
npm.cmd view cortico-world-feast@0.13.0 version dist.integrity --json --registry=https://registry.npmjs.org
npm.cmd view cortico-world-feast dist-tags --json --registry=https://registry.npmjs.org
```

核对实际发布版本、`latest` 和归档 integrity。正常提交并推送相关 Git 改动，不强制覆盖远端；npm 发布核对成功后才创建和推送 `v0.13.0` 标签。npm 发布成功不代表 Coo 市场索引已更新。

在 Coo 中更新后完全退出再重新打开，使进程加载新面板资源。除 0.12.1 的三项界面修复外，重点看 D2：默认 `lifeStoryOn` 关闭时行为与旧版一致；打开后「写明天」和自由时间邀请改用娱乐时间的地点与故事提示，手写的菜单/候选/排序不丢，关闭后回旧路径；故事只能由用户在娱乐时间故事面板开始，生活记录仍需另行确认且成功回执才显示记下。
