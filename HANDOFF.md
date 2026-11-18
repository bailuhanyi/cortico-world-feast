# 鱼的每一天插件交接文档

更新时间：2026-11-18（Asia/Shanghai）
当前版本：`0.10.1`（工作区，**待发布**；npm `latest` 仍是 0.10.0）
插件包：`cortico-world-feast`
工具总数：18 个 · 事件 7 个 · 配置项 42 个（`defaults()` 43 个键，含 `enabled`）· 面板 4 个

## 1. 当前状态

0.10.0 已包含：生活首页、安全存储与恢复、跨天小事、默认低打扰优化，以及「今天上不上班」开关和「饭点档位由她自己定」。0.10.1 在其上补充工作开关的保守识别、关闭前预览确认、一次撤销快照与冲突保护，以及旧 `work:false` 冲突的显式清理入口（详见 2.0.1 节）。

**发布与安装状态（用户已确认）**：`0.10.0` 已发布到 npm 并已安装到 Coo；安装完成不等于真实宿主、GUI 视觉与交互验收完成。`0.10.1` 是本次为工作区改动新定的版本号，**尚未发布、尚未安装**；registry 上 `0.10.1` 尚未占用（`publish-check --online` 与实时查询均确认）。

**本轮（0.10.1）状态**：改动已全部实现并通过全套本地验证，已整理为一次提交，待用户在自己的 PowerShell 里 `git push` 与 `npm publish`。真实 Coo GUI 交互验收仍待安装完成后进行。

本轮验证结果（均已实跑）：

- `npm test`（15 个测试文件，452 条全过）
- `node tools/validate-dishes.mjs`（824 道 / 28 菜系组全过）
- `node tools/selfcheck.mjs`（12 项通过，0 警告，0 失败）
- `node tools/verify-spec.mjs`
- `node tools/make-describe.mjs --check`（18 工具 / 7 事件一致）
- `node tools/publish-check.mjs --online`（18 项通过，3 条既有警告：工具数/token yellow、没截图、解包 2.1MB）
- `git diff --check`（CRLF 提示是行尾警告，不是失败）

各文件测试数：存储 6、跨天小事 9、菜品 30、味觉 15、状态 35、套餐 42、一起吃饭 13、生活内核 57、生图联动 20、生活世界 76、天气 10、娱乐联动 14、小地图 20、World 55、面板 53。

## 2. 已完成的功能

### 2.0.1 工作开关的保守识别、预览确认、撤销与冲突清理（0.10.1，待发）

- 关闭工作时只把**明确的工作事件**改成自由安排；「公司附近吃饭」「下班后看电影」「工作室画画」等只是发生在工作相关时间/地点的生活安排，不再被误清。
- 面板关闭工作前先给出受影响的时段预览，由主人确认后才执行；并发改动会让确认失效，避免按旧画面覆盖新内容。
- 关闭时保存一次 `workUndo` 快照；关闭后若工作字段或时段又被改动，拒绝撤销以免覆盖后续编辑；只改饭点仍可撤销并保留修改后的饭点。
- 旧 `work:false` 日程中残留的工作冲突只提示、不在读取或规范化时静默改盘；面板提供主动清理入口。
- `feast_life_day` 的 `work:false` 与面板 `today.work` 共用同一套规则，日程仍不凭空生成。

### 2.0 今天上不上班 + 饭点由她自己定（0.10.0）

0.10.0 的原始行为是只改一个标记或一组饭点档位，不重写日程正文。本轮正在补充关闭工作时对工作相关时段的处理；以下须区分已发布行为与正在实现的目标，不能据此认定本轮已通过验收。

日程文件（`feast/life/YYYY-MM-DD.json`）新增两个字段：

- `work`：这一天是否上班（布尔）。缺字段时按日型推（`workday` / `overtime` / `slacking` = 上班），老文件照常能读。
- `mealSlots`：她给这一天定的饭点（`HH:MM` 字符串数组，最多 4 档）。空数组 = 没定，用配置兜底。

工具 `feast_life_day`（新增）：

```json
{ "date": "today|tomorrow|YYYY-MM-DD", "work": true, "mealSlots": ["12:10", "19:00"] }
```

- `work` / `mealSlots` 二选一或都写；0.10.0 原始行为不改日程正文，本轮关闭工作时的处理目标见下文。
- 那天还没有日程时**拒绝**，不凭空造一份空日程（面板上会看起来像她已经想过了）。
- 两件都没写时明确拒绝，且不落盘。

配置 `mealSlotsByHer`（新增，默认 `true`）：

- 开着：她定的 `mealSlots` 优先，配置里的 `mealSlots` 只作兜底；她没定过的日子、以及她还没写日程时，仍用配置档位。
- 关掉：她定过也不采用，一律按配置档位叫。她写的值仍会落盘，只是不生效（回执里会说明）。

`feast_life_plan` 扩展：多接 `work` / `mealSlots` 两个可选参数，写日程时顺手定，省一次往返。饭点写歪了整份拒掉并说清格式，**不静默退回默认档位**（否则她不会知道那天其实按默认叫的）。

日型挑选 `pickDayType(types, date, forcedId, rand, work)`：

- 新增第 5 个参数 `work`。给了就在对应的那一类日型里挑（上班类 / 不上班类）。
- **明确指定时不受星期分流限制**：周四是工作日，说不上班也照样能挑到休息日。
- 某一类被她关光了，退回该类内置的第一个，**不会悄悄给回上班日**。

`cleanDay` 原有的一致性规则以 `work` 标记调整日型；调整日型本身不能保证时段正文中的工作内容已清理。本轮要求旧 `work:false` 日程中的工作冲突只显示提示，不在读取或规范化时静默改盘；用户可通过面板主动清理。

面板「今天」新增一块「今天上不上班」（`dist/webui.js` 的 `workSection()`）：

- 上班 / 不上班两个按钮（当前那个禁用，避免点了没反应像坏了）。
- 下面一行说明这组饭点是她定的还是配置的。
- 这一天还没有日程时给一句说明，不给点了没用的键。
- 面板方法 `today.work`：`{ date, work }`，走的是和 `feast_life_day` 同一个实现。

**0.10.1 的工作开关行为（已实现并本地验证，待发布）**：

- 工作关键词识别更保守，保留「公司附近吃饭」「下班后看电影」「工作室画画」等生活安排，避免仅因包含工作相关字眼就清理。
- 面板关闭工作前，先预览受影响的时段，再由用户确认执行。
- 关闭工作时在日程中保存一次撤销快照。关闭后若日程的工作相关字段或时段发生改动，则拒绝撤销，避免覆盖后续编辑；只修改饭点允许撤销，并保留修改后的饭点。
- 旧 `work:false` 日程中的工作冲突只显示，不静默改盘；面板提供用户主动清理的入口。

已验证：生活内核 57/57、生活 World 集成 76/76、面板 53/53（含预览确认和撤销）通过；全套 452 项、`verify-spec`、`selfcheck`（12 项）、`publish-check --online`、`git diff --check` 均通过。尚未在真实 Coo GUI 验证本轮改动；`0.10.0` 已安装不能作为新行为验收通过的依据。

### 2.1 安全存储与恢复

统一存储逻辑位于 `src/storage.js`：

- 缺失文件才按新记录处理；损坏或不可读文件会抛错。
- 写入采用临时文件和原子替换。
- 覆盖有效旧记录前保存 `<file>.bak`。
- 损坏记录不会被空数据静默覆盖。
- 恢复前会把当前主文件另存为唯一的 `.corrupt-<timestamp>-<uuid>` 文件。
- 首页使用安全逻辑键恢复，不接受前端传入任意文件路径。

涉及的记录包括：

- `feast/state.json`
- `feast/combos.json`
- `feast/life/YYYY-MM-DD.json`
- `feast/life/play-YYYY-MM-DD.json`
- `feast/threads.json`

主状态损坏时，World 仍可启动并显示生活首页恢复入口；吃饭相关写入会暂停，避免用内存空状态覆盖磁盘原档。

### 2.2 生活首页

`today` 面板是 `webUi().panels` 的第一项，位于 `src/world.js` 和 `dist/webui.js`。

首页分别展示：

- 此刻的安排
- 今天实际留下的活动和饮食记录
- 接下来的一项安排
- 今天上不上班 + 这组饭点的来源（0.10.0 新增）
- 跨天小事
- 存储异常、重新读取和备份恢复入口
- 明天计划的等待状态和手动重发入口
- 原有时间线、临时改主意和往期日期

计划和事实严格分开：日程只表示安排，只有 `feast_life_play` 和吃过记录才表示实际发生。

### 2.3 跨天小事

实现文件：`src/life/threads.js`。工具：`feast_life_thread`。

支持动作：

- `list`：默认只返回进行中的小事；传 `history: true` 才返回历史。
- `add`：明确留下文字，要求有来源和日期。
- `done`：按 id 明确标记完成。
- `drop`：按 id 明确放下。

约束：最多 8 件 active、最多保留 32 件历史、文本 1-120 字、id 唯一、source 只能是 `coo` 或 `owner`、不从日程自动推断、不自动标记完成、不主动催促。

线程提示只作为可选参考，明确表达「可继续也可不选」，不会把主人想法或日程当成她已选择或已完成。

### 2.4 生活和口味逻辑

- 睡前、回笼觉、否定睡觉、工作室地点等文本不再误判为睡眠或忙碌。
- 日程规范化始终覆盖 `00:00–24:00`。
- 超过段数限制时拒绝输入，不截断尾部。
- 吃过的口味均值 `avg` 与明确偏好 `preferenceAvg` 分开。
- 同一菜最新有效反馈覆盖旧反馈。
- 明确讨厌的菜不会进入套餐推荐。
- 默认日常 `feast_eat` 使用简版味觉回执，保留菜名、主味、口感、香气、余韵和当下变化。
- 完整档案仍通过 `feast_taste` 获取；`renderBite()` 不传 `compact` 时仍保持完整模式，兼容已有调用者。

## 3. 当前低打扰默认配置

以下默认值已在 `src/config.js` 调整：

```json
{
  "mealMaxRetries": 0,
  "lifeMomentEvents": false,
  "lifeFreeSlots": "21:00",
  "lifeUpcoming": 1,
  "lifeFreeAskReport": false
}
```

含义：

- 饭点默认只提醒一次，不自动催饭。
- 默认不因时段切换主动推事件。
- 自由时间默认每天 21:00 提醒一次。
- 查询当前生活时只列下一项。
- 默认不额外提醒她向主人汇报。

重要兼容规则：安装或启动时只补宿主配置中缺失的键；用户已经在 `config.json` 里明确设置的值不会被这些新默认值覆盖。0.10.0 新增的 `mealSlotsByHer` 同样走这条规则——新装用户默认拿到 `true`，老用户没这个键也会被补上 `true`。

恢复旧频率可以显式设置：

```json
{
  "mealMaxRetries": 1,
  "lifeMomentEvents": true,
  "lifeFreeSlots": "10:00,14:00,21:00",
  "lifeUpcoming": 3,
  "lifeFreeAskReport": true
}
```

## 4. Token 与上下文基线

项目内使用估算方法：中文字符按 0.6、其他字符按 0.3 估算；这不是具体模型 tokenizer 的精确账单。

当前测量结果（0.10.0）：

- `ENV_PROMPT.md`：1048 字符，约 471 token（比 0.9.x 的 960 字符多了一句 `feast_life_day` 说明）。
- 固定模板部分：约 410 token。
- 生活背景示例：约 335 token。
- 工具定义合计约 2577 token（18 个工具，是主要固定开销）。
- 示例菜品完整回执约 238 token，简版约 135 token。

本轮优化重点是减少模型唤醒次数和事件历史增长，不是删除菜品库。菜品库、首页刷新、备份和恢复均在本地完成，不会因为本地操作直接调用模型。

加 `feast_life_day` 这一版净增约 40 token 提示词 + 一份工具定义。如果以后还要省，优先研究宿主是否支持按场景动态注册工具，但必须先确认宿主契约和缓存行为。

## 5. 关键文件

### 后端

- `src/world.js`：World、工具处理、定时事件、首页数据、恢复动作、`feast_life_day`。
- `src/storage.js`：安全 JSON 读取、原子写入、备份、检查和恢复。
- `src/state.js`：饭点判定（`planTick` / `nextMealText` / `statusLine`）、`effectiveMealSlots()`。
- `src/life/store.js`：日程和自由时间记录、`cleanDay`（`work` / `mealSlots` 的清洗与一致性）。
- `src/life/schedule.js`：日型表、`pickDayType`、`isWorkDayType`、`cleanMealSlots`、`MAX_OWN_MEAL_SLOTS`。
- `src/life/threads.js`：跨天小事持久化和校验。
- `src/life/index.js`：生活模块导出。
- `src/life/inject.js`：系统提示词中的生活背景和按需查询文本。
- `src/life/voice.js`：生活说话方式提示。
- `src/life/plan.js`：请她写明天的事件正文（含 `mealByHer` 两种说法）。
- `src/life/free.js`：自由时间提醒和记账。
- `src/eat.js`：完整及简版味觉回执。
- `src/config.js`：默认配置和配置界面文案。

### 前端和声明

- `dist/webui.js`：实际面板 bundle，项目当前没有可用的 `scripts/build-webui.mjs`，按现有流程直接维护该文件。
- `describe.json`：由 `node tools/make-describe.mjs` 生成，当前 18 个工具、7 个事件。
- `src/ENV_PROMPT.md`：环境提示词模板。

### 文档

- `README.md`：设计说明和功能总览。
- `GUIDE.md`：主人使用指南和配置说明。
- `CHANGELOG.md`：0.10.0 及之前的版本记录。
- `HANDOFF.md`：本交接文档。

### 新增测试

- `test/storage.test.mjs`
- `test/threads.test.mjs`

其他重点测试：

- `test/eat.test.mjs`
- `test/life.test.mjs`
- `test/life-world.test.mjs`
- `test/world.test.mjs`
- `test/panels.test.mjs`

0.10.0 新增的用例分散在：`state.test.mjs`（有效饭点档位 4 条）、`life.test.mjs`（日型/饭点校验 7 条）、`life-world.test.mjs`（上班开关与饭点来源 12 条）、`panels.test.mjs`（面板上班块 4 条）。

## 6. 继续开发时的推荐顺序

1. 先运行：

   ```powershell
   cd "E:\deep seek\feed-world"
   npm test
   ```

2. 修改工具声明或参数后运行：

   ```powershell
   node tools/make-describe.mjs
   node tools/make-describe.mjs --check
   node tools/verify-spec.mjs
   ```

3. 修改日程、恢复、工具处理后重点运行：

   ```powershell
   node test/life.test.mjs
   node test/life-world.test.mjs
   node test/world.test.mjs
   node test/panels.test.mjs
   ```

4. 修改饭点档位或上班标记后，除上面外再跑：

   ```powershell
   node test/state.test.mjs
   ```

5. 修改味觉或简版回执后运行：

   ```powershell
   node test/eat.test.mjs
   node test/world.test.mjs
   ```

6. 结束前运行：

   ```powershell
   node tools/selfcheck.mjs
   node tools/validate-dishes.mjs
   node tools/publish-check.mjs
   git diff --check
   ```

## 7. 尚未完成的事项

- `0.10.0` 已发布并安装到 Coo（用户确认）；`0.10.1`（工作开关保守识别/预览确认/撤销/冲突清理）已本地验证并整理为一次提交，**待用户 `git push` + `npm publish`**，发布后再安装到 Coo 验收。
- 真实宿主与 GUI 视觉、交互验收仍待完成：恢复按钮、跨天小事、低打扰默认值、「今天上不上班」块、饭点来源提示，以及 0.10.1 的关闭前预览/确认与撤销按钮。
- 当前仍有 18 个工具定义；如果还要进一步省 token，可以研究宿主是否支持按场景动态注册工具，但必须先确认宿主契约和缓存行为。
- `src/storage.js` 当前主要解决单 World 进程内流程；如果未来允许多个进程同时写同一数据目录，需要增加跨进程锁或明确限制单进程使用。
- 旧 `work:false` 冲突只经面板主动清理，不应在读盘时自动重排；后续若再改工作开关行为，沿用 2.0.1 节的保守识别与撤销保护规则。

## 8. 注意事项

- 不要用不存在的 `scripts/build-webui.mjs`。
- 不要把日程安排直接写成「她已经做过」。
- 不要从日程自动创建或完成跨天小事。
- 恢复入口只能使用 `state`、`combos`、`today`、`tomorrow`、`play`、`threads` 等安全逻辑键，不能接受任意路径。
- 遇到损坏记录时不要用空对象或模板覆盖原文件。
- 不要回滚工作区中已有的无关改动。
- **不要用 PowerShell 的 `-replace` + `Set-Content` 改带中文的文件**：本机 `core.autocrlf=true`，那条路会把 UTF-8 写成乱码（本轮已经把 `package.json` 弄坏过一次）。要批量改文案就用 Node 的 `readFileSync` / `writeFileSync` + `utf8`，写之前先验证没有 `\uFFFD`、JSON 还能 parse。
- **`git checkout -- <file>` 会丢掉未提交改动**：操作前重新检查工作区状态，勿用 `git checkout` / `git restore` / `git stash` 覆盖或移走已有改动。要对比文件用 `git show HEAD:<path>` 输出到临时文件，不要对着工作区文件 reset。
- `feast_life_day` 的 `mealSlots` 上限是 4 档（`MAX_OWN_MEAL_SLOTS`）：再多就不是「几点吃」，而是又一个时间表了。改这个上限要同时改 `feast_life_day` 与 `feast_life_plan` 两处声明里的 `maxItems`。
- 她定的饭点和配置档位分属两个来源：`effectiveMealSlots(cfg, own)` 是唯一合并点（`src/state.js`），不要在其他地方各写一份「她定的优先」。
