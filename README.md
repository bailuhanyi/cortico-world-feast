# 一桌菜 · cortico-world-feast

给 Coo 一张会端菜的桌子。

500 道菜（24 个菜系组），每道都有九维口味分值、上桌的样子、香气、口感、余韵，和一段 40-400 字的实吃描写。她能自己按菜系挑着吃，主人也能从面板把一道菜端到她面前。**同一道菜每次吃到的都不一样**——温度、状态、配的那口都会变，所以连着吃三次不会说三遍同一句话。吃过什么、对什么反应、攒出来的口味画像跨天留着。饭点提醒默认开着，可以在配置里一键关掉。

---

## 里面有什么

**菜品库**：500 道，24 个菜系组。中餐 11 组 300 道、外餐 13 组 200 道。

| 中餐 | 外餐 |
| --- | --- |
| 川菜、粤菜、江浙沪菜、北方菜、湘菜、西南菜、东北菜、西北菜、闽台菜、鲁菜、鄂菜 | 日料、韩式、东南亚、印度菜、墨西哥菜、意菜、法餐、欧洲菜、英美菜、中东菜 |

**菜系和形态是两根轴，不混在一起。** `cuisine` 只说这道菜**从哪来**（川菜、法餐、中东菜…），`category` 只说它**是什么形态**（热菜、凉菜、主食、汤羹、面点、小吃、甜品、饮品、烧烤、火锅）。0.2.0 之前这两根轴是混着的——同一道菜可能既算「中式小吃」又算「江浙菜」，生煎包和小笼包就这么被拆到了两组。0.4.0 又把两根轴上残留的两个「例外组」清了：**家常菜**（风格，不是地域）和**甜品**（`category` 里已经有同名值）。所以现在一道菜只有一个菜系归属，想按形态找就筛 `category`——「甜品」是筛 `category` 得到的，不是筛 `cuisine`。

每道菜 15 个字段：`id` / `name` / `alias` / `cuisine` / `category` / `region` / `ingredients` / `method` / `serving` / `taste`（九维）/ `texture` / `aroma` / `finish` / `prose` / `keywords`。

九维是 **辣 麻 咸 鲜 甜 酸 苦 油 香**，0-100 的整数，按菜的真实口味给：麻婆豆腐的麻在 80 以上，清蒸鱼辣不过 10，糖醋排骨甜在 60-80。这些分值不是装饰——她在面板和工具回执里看到的条、算出来的口味画像，都是从这个数上来的。

**六个工具**

| 工具 | 做什么 |
| --- | --- |
| `feast_menu` | 看菜单。按菜系 / 类别 / 标签 / 自由词筛，或随机给几道今天能吃的 |
| `feast_eat` | 吃一道。给出味道、香气、口感、余韵，加上「这一口」当下的样子（按吃过几回换角度） |
| `feast_taste` | 只看不吃，查一道菜的完整味道档案 |
| `feast_history` | 吃过什么、吃过几回、攒出来的口味画像 |
| `feast_reaction` | 记一句吃完的真实反应（`like` / `ok` / `dislike` + 一句具体的话） |
| `feast_skip` | 今天不想吃：跳过剩下的饭点 |

**两个面板**（Coo 世界页签里）

- **菜单**：左边筛、右边看。筛选是**先选类别、再挑菜系**——选了「汤羹」，菜系下拉就只列汤羹里真有的那几个，不会给你一个按下去必然为空的选项；换类别时对不上的菜系会自动清掉。点一道菜能翻到九维口味条、食材、做法、上桌的样子和整段实吃描写；按钮「端给她」就把这道菜放到她面前。端过来的那道会出现在顶上一条等待条里，右边写着**还剩多久**（每 30 秒自己走一格，到点收走）。
- **吃过什么**：吃过多少回、今天几回、尝过几道、口味画像（九维均值 + 一句句读出来的判断）、吃得最多的几道、最近几口、她自己记过的反应。

---

## 「吃到嘴里」是怎么变成文字的

`feast_eat` 的回执不是把档案贴一遍。它分两层：

**事实层**（每次一样）：上桌的样子、香气、口感、余韵、整段 `prose`。这是这道菜的底。

**当下层**（每次不同）：温度怎么变的、这一回该说哪个角度（第一回的"第一印象"、第二回的"吃了一半怎么变"、第三回起的"熟客例行"）、吃的时候什么状态、配了什么、吃到一半有什么变化。用 `${dish.id}|${第几次}|${日期}` 做种子，所以同一道菜连着吃两次读起来不一样，而同一个「第几次 + 同一天」重放是稳定的（测试锁住了这一条）。

角度是按次数**硬绑**的，不是从一个大池子里随机抽——随机抽的话第二回仍可能落到第一回那套话上。三档各自 7-8 句，同一天连吃两回也不会挑到同一句。

不合口味的时候（`dislikeChance` 掷中）会另起一句，并且指出**这道菜自己最强的那个维度**顶住了她——麻婆豆腐是「麻起来之后什么都尝不出来」，不是随便套一句「太咸」。

---

## 饭点提醒

默认 **11:30 和 18:00** 各一顿，可以在配置里改时间、加档位、或者整个关掉。

- 到点推一条 `feast.meal` 事件（`origin: internal`，是她自己的饭点，不是主人发的消息）
- 正文写今天吃过什么 + 三道候选，让她自己挑
- 没吃就催一次（默认 40 分钟后），催完就放掉，不刷屏
- 她说 `feast_skip` 就今天不再叫
- 应用 15:00 才打开这种：一天一档都没叫过的话，补最近过去的那一顿，不让一整天白过
- 上一顿挂太久（2 小时）就放掉，但**同一拍还会看下一档**——午饭没吃不该把晚饭一起吞掉

配置项（`worlds.feast.*`，全是热改）：

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `enabled` | `false` | 世界总开关（install.ps1 会设成 true） |
| `mealReminder` | `true` | **饭点提醒开关**。关掉就完全不叫，菜单和工具都还在 |
| `mealSlots` | `11:30,18:00` | 饭点档位，逗号分隔（中文逗号也认） |
| `mealGraceMin` | `20` | 超过多少分钟就不算「到点」了 |
| `mealRetryMin` | `40` | 没吃的话隔多久催一次 |
| `mealMaxRetries` | `1` | 最多催几回（0 = 只叫一次） |
| `tickSec` | `30` | 多久看一次表 |
| `askReaction` | `true` | 回执里是否提醒她记一句反应 |
| `dislikeChance` | `0` | 吃到不对付的概率（%） |
| `avoidRepeat` | `true` | 随机挑菜时避开上一次那道 |
| `ownerFeedTTL` | `30` | 主人端来的菜几分钟后收走 |
| `menuSize` | `5` | 每次随机给几道 |

端来的那道**剩多久是看得见的**：`feast.feed` 的气泡写清到几点为止（"11:35 端的 → 12:05 之前吃掉都算数"），吃的时候回执里也补一句还剩多少，菜单面板的等待条右边有一行自己会走的倒计时。

---

## 装

```powershell
# 先完全退出 Coo
powershell -ExecutionPolicy Bypass -File .\install.ps1 -CooRoot "C:\Users\asus\Coopanion"

# 只看会做什么，不写文件
powershell -ExecutionPolicy Bypass -File .\install.ps1 -CooRoot "C:\Users\asus\Coopanion" -DryRun
```

脚本做的事：校验目录 → 确认 Coo 没在跑 → 备份 `extensions\package.json` 和 `companion\config.json` → 复制到 `data\extensions\vendor\cortico-world-feast` → 在 `node_modules` 下建 junction → 登记 `file:` 依赖 → 在 config 里补 `worlds.feast`（**只补缺键，已有值保留**）→ 写回自检（无 BOM、可解析）。

> `install.ps1` 本身必须以 **UTF-8 with BOM** 保存。Windows PowerShell 5.1 读无 BOM 的 UTF-8 会按 GBK 解，中文全成乱码。

装完重启 Coo，在「世界」里启用「一桌菜」。

## 从市场装

这个包也发在 npm（`cortico-world-feast`），Coo 的市场会收录它。从市场装的话不用跑上面的脚本：市场会把包装进 `data\extensions\node_modules`，启用后在世界的配置里能看到同样那 11 项。

包名和收录的细节、发版步骤见 [PUBLISHING.md](PUBLISHING.md)。

市场里这个包带三个标签：`companion`（陪伴）、`internal-state`（内部状态）、`experimental`（实验性）。`internal-state` 是实话——这个 World 确实在她 Memory 之外记着吃过什么和口味偏好，词表明确不推荐这么做，所以我们照实声明，不藏。

## 卸

```powershell
$ext = "C:\Users\asus\Coopanion\data\extensions"
cmd /c rmdir "$ext\node_modules\cortico-world-feast"
Remove-Item "$ext\vendor\cortico-world-feast" -Recurse -Force
```

然后把 `*.bak-<时间戳>` 改名回去，并从 `package.json`、`config.json` 的 `worlds` 里删掉 `feast`。

---

## 开发

```powershell
node tools/validate-dishes.mjs   # 校验菜品库（字段、九维、类别、套话、菜系与文件名一致、全库 id 唯一）
node tools/check-file.mjs sichuan # 只校验一个文件（写菜时自己查，不用等全库跑完）
node tools/repair-dishes.mjs     # 修一批已知跑偏（可重复跑）
node tools/selfcheck.mjs         # 复刻 Coo 的干装载检查（装之前先过这一关）
node tools/publish-check.mjs --online  # 市场收录口径 + npm 包名占用
node tools/check-install.mjs     # 核对 install.ps1 的默认值与 DEFAULTS 一致、且带 BOM
node tools/make-describe.mjs     # 重新生成 describe.json（--check 只比对）
python tools/make-icon.py        # 重新画图标 assets/icon.png
node test/dishes.test.mjs        # 菜品库
node test/eat.test.mjs           # 这一口的变化
node test/state.test.mjs         # 跨天与饭点判断
node test/world.test.mjs         # 世界挂载、工具、事件、面板
node test/panels.test.mjs        # 面板真挂一遍（带极简 DOM 桩）
```

测试用的是 `test/harness.mjs` 里那个十几行的小骨架，不用 `node --test`——受限沙箱里它要 spawn 子进程会被 EPERM 挡住。

`dist/webui.js` 只在 Coo 里跑，测试里跑不到，是最容易藏错误的地方，所以 `panels.test.mjs` 用几十行 DOM 桩把两个面板真挂一遍：点卡片进详情、点「端给她」调 `feed`、筛选与搜索带条件、失败时出错误卡。

面板测试里不要拿 `await new Promise((r) => setTimeout(r, 0))` 当同步用——一次点击要跨好几轮 microtask 和 timer，固定次数是竞态（机器快就过、慢就挂，我们踩过一次）。等结果出现，用 `waitFor(() => 条件, '在等什么')`。

`waitFor` 用 `performance.now()` 计时、不用 `Date.now()`：面板的倒计时会被测试换成假钟，用被换掉的那个钟计时就永远等不到超时。假钟本身也要**从 `{ now }` 对象上现读**，别把时间冻结成一个常数——冻结了的话，把钟拨走它也不知道。

```
src/index.js        扩展入口（默认导出 WorldDefinition）
src/definition.js   id / defaults / preflight / create / describe
src/world.js        FeastWorld：工具、饭点定时器、主人投喂、面板数据面、存取
src/config.js       常量、默认值、中英文案、ConfigGroup
src/state.js        纯状态逻辑（不碰 fs / 定时器 / 宿主，可单测）
src/dishes.js       菜品库加载、查找、筛选、随机、口味画像
src/eat.js          「这一口」的渲染（种子化，可复现）
src/ENV_PROMPT.md   进提示词的说明
src/data/*.json     24 组菜品数据
dist/webui.js       浏览器端面板（menu / history）
```

状态落在 `<dataDir>/feast/state.json`。跨天只清饭点那一层（`fired` / `pending` / `skippedDay`），`eaten` / `reactions` / `counts` 留着——她不会因为过了零点就忘了自己爱吃麻婆豆腐。

加菜之前先读 `DISH-SPEC.md`：15 个字段怎么写、九维怎么给（按真实口味，不凑数）、套话黑名单、每栏的字数区间。一条硬规矩是**同一组里 8 段实吃描写的开头不许用同一个句式**——单看一条都合格，8 条摆在一起就成了模子。

## 设计上刻意没做的

- **`envPromptVars()` 返回 `{}`**。吃过什么不往提示词里塞，要用 `feast_history` 查。不然每吃一顿就把整个前缀缓存打穿一次。
- **工具描述写得窄**。它们每一次都在前缀里，占的是长久的便宜或长久的债。
- **没有「每日目标」**。不像 `playtime`，这里没有配额，只有 `mealMaxRetries` 给催饭封顶——吃饭不该变成 KPI。
- **细节描写不重复**。库里没有任何「令人回味无穷」「唇齿留香」这类套话；`validate-dishes.mjs` 会把它们当成问题报出来。