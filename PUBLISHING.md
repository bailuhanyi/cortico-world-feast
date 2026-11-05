# 发布到 Coo 扩展市场

Coo 的市场不自己收包。它读的是两处：

1. **npm**：包本身。市场 Action 每 30 分钟搜一次 npm 上带 `cortico-world` 关键字的包，解包读 `cortico` 块、`describe.json`、`CHANGELOG.md`、图标与截图，把结果写进索引仓。
2. **GitHub 索引仓** [`Pal-AI-Lab/cortico-extensions`](https://github.com/Pal-AI-Lab/cortico-extensions)：`catalog.json` 与 `packages/` 由 Action 生成，`index.json` 由官方走 PR 维护（标签词表、认证、拉黑、官方覆盖）。

所以「发布到 Coo」= **发一个 npm 包**，剩下的市场自动收。你不需要向谁提交、也不需要等审核（认证是另一件事，见文末）。

---

## 0. 发版前自查（已经全绿，改过东西就重跑）

```powershell
cd 'E:\deep seek\feed-world'

node tools/validate-dishes.mjs      # 菜品库：字段、九维、类别、套话、菜系与文件名一致
node tools/selfcheck.mjs            # 复刻 Coo 的干装载检查
node tools/publish-check.mjs --online  # 市场收录口径 + npm 包名占用
node test/dishes.test.mjs; node test/eat.test.mjs; node test/state.test.mjs; node test/combos.test.mjs; node test/together.test.mjs; node test/world.test.mjs; node test/panels.test.mjs
node tools/make-describe.mjs --check
```

`prepublishOnly` 已经把这些串起来了：`npm publish` 之前会自动跑一遍，有任何一处失败就发不出去。这不是多余的谨慎——`describe.json` 与代码脱节、标签写了词表外的值、图标超 512KB，都会让市场那张卡片缺一块，而发出去之后改不了（只能发新版本）。

当前状态（0.6.2）：**19 项通过、0 失败、1 条警告**（没截 `screenshots`——离线的另外那 1 条警告是因为没查 npm，带 `--online` 就没有了）；190 项测试全绿。

---

## 1. 仓库地址（已补好）

`package.json` 顶层已经有下面三行（2026-11-05 补，指向 `bailuhanyi/cortico-world-feast`）。市场详情页的「源代码仓库」「项目主页」「问题反馈」三个链接就是从这三行来的；认证申请也要求仓库在你自己名下（`official.githubOwners` 之外的第三方包，维护者不能是 `phantivia`）。

```jsonc
"repository": {
  "type": "git",
  "url": "git+https://github.com/bailuhanyi/cortico-world-feast.git"
},
"homepage": "https://github.com/bailuhanyi/cortico-world-feast#readme",
"bugs": {
  "url": "https://github.com/bailuhanyi/cortico-world-feast/issues"
},
```

如果以后仓库换了名字，这三行要一起改，否则详情页链到 404。

`repository` 要写在顶层，**不要**写进 `cortico` 块——Action 是从顶层读的。

建仓并推（仓库要在 GitHub 上先建好，名字 `cortico-world-feast`；这台机器没装 `gh`，只能走网页建空仓，**不要**勾 README/LICENSE/gitignore）：

```powershell
cd 'E:\deep seek\feed-world'
git init
git add -A
git commit -m "一桌菜 0.1.0：80 道菜的 Coo 世界，带九维口味、会变化的这一口与可开关的饭点提醒"
git branch -M main
git remote add origin https://github.com/bailuhanyi/cortico-world-feast.git
git push -u origin main
```

`.gitignore` 已经排掉了 `node_modules/`、`.tmp/`、`*.bak-*`，不会把装机残留推上去。

---

## 2. 登录 npm 并确认身份

```powershell
npm login          # 浏览器授权，或用户名 / 密码 / 一次性验证码
npm whoami         # 确认登上了
npm config get registry   # 应是 https://registry.npmjs.org/
```

如果 `npm whoami` 报 `ENEEDAUTH`，就是没登上。如果报 `EPERM ... npm-cache\_logs`，那是本机 npm 缓存目录的权限问题（不影响发布，只是写不了日志）。

> **本机已知情况（2026-11-05）**：npm 缓存目录 `C:\Users\asus\AppData\Local\npm-cache` 在 DSH 沙箱里写不了，`npm pack` / `npm publish` 会报 `EPERM`。这不是 npm 的问题，是沙箱边界——`npm pack`、`npm publish` 这类要写缓存的命令都要在沙箱外跑（或由你在自己终端里跑）。

### 2FA：npm 现在要求发布必须过二次验证

`npm login` 用网页授权登进来的是普通 token，**发不了包**。`npm publish` 会报：

```
E403  Two-factor authentication or granular access token with bypass 2fa enabled
      is required to publish packages.
```

也就是说账号必须满足下面之一：

- 开启 2FA，发布时带 `--otp <6 位码>`（每次都要，码 30 秒过期）
- 建一个 **granular access token** 并勾上「bypass 2FA」，把它写进 `~/.npmrc`

开启 2FA：<https://www.npmjs.com/settings/YOURNAME/tfa> → 绑定 authenticator → 选 **Authorization and writes**（只勾 writes 不够，改 tag/设置也要验证）。

然后：

```powershell
npm publish --otp 123456
```

> ⚠️ **`npm publish` 必须在交互式终端里跑。** npm 只在**真 TTY** 里才弹验证提示
> （`npm/lib/utils/auth.js` 里 `if (!process.stdin.isTTY || !process.stdout.isTTY) throw err`），
> 所以在 agent 的非 TTY shell 里它直接抛 `EOTP`，日志里的认证链接还会被遮蔽成
> `https://www.npmjs.com/auth/cli/***`（拿不到真链）。**agent 能做的到 `publish-check` 为止**，
> 最后那一下由你在自己的 PowerShell 里敲。
>
> 注意：网页授权登录的会话 token 也走不通这条路。要么 2FA + `--otp`，要么 granular token + bypass 2FA，没有第三种。`--otp` 的码只能人手输，脚本替不了。
>
> **`--otp` 要的是 6 位数字**，从 authenticator 应用里现取（30 秒滚一次）。npm 的**恢复码**（一长串 64 位 hex）只能用于**网页登录**顶替验证——**千万别传给 `npm publish --otp`**：会当场消耗掉一个，并且触发 **72 小时安全封禁**（`temporary 72-hour security hold`），期间不能发布、不能建 token、不能改已有 2FA 方式，**无法提前解除**。
>
> **判断封禁有没有解除，别只看 `EOTP`。** `npm publish` 分两个阶段：第一阶段发 PUT，只报 `401 / EOTP`（要验证码）；**带上验证码或完成网页验证后重试的第二个 PUT 才会暴露 `403 suspended`**。所以只有走完整个验证流程、看到第二个 PUT 的结果，才知道能不能发。
>
> **npm 的 2FA 主推安全密钥（WebAuthn）**，不是 authenticator 的 6 位码。设置页如果只给 Security key 选项，选它即可——Windows 上走 Windows Hello（指纹/PIN），不再需要输码。TOTP（authenticator）是另一个可选项，取决于账号页面提供不提供。

---

## 3. 看一眼要发出去的东西

```powershell
npm pack --dry-run
```

0.6.2 应该是 **46 个文件**（`publish-check` 数出来是 47 个，它把目录条目也算一个），压缩后约 580KB、
解包约 1.7MB：`package.json`、`src/`（含 28 个菜品 json + 9 个 js）、`dist/webui.js`、`describe.json`、
`assets/icon.png`、`README.md`、`CHANGELOG.md`、`PUBLISHING.md`、`GUIDE.md`。

`test/`、`tools/`、`install.ps1`、`COMBO-SPEC.md`、`TOGETHER-SPEC.md`、`DISH-SPEC.md` 都在 `files` 之外，
不会发出去——菜品校验脚本、装机脚本、设计稿是我们的工具，不是用户要的东西。

---

## 4. 发

```powershell
npm publish --otp 123456      # 没开 2FA、或用了带 bypass 2FA 的 granular token，就不用带 --otp
```

这个包不是新包（0.1.1 / 0.2.0 / 0.3.0 / 0.4.0 / 0.5.0 / 0.6.0 / 0.6.1 都发过），所以**不需要** `--access public`（那是作用域包 `@you/xxx` 才要的）。
`latest` 会从 **0.6.1** 走到 **0.6.2**。**0.7.0 这个号从来没有真正发布过**：套餐 + 一起吃饭并进了 0.6.0，
所以版本序列是 0.6.0 → 0.6.1 → 0.6.2，中间没有 0.7.0。

发完立刻验：

```powershell
npm view cortico-world-feast version          # 应回 0.6.2
npm view cortico-world-feast cortico --json   # 应能看到 kind/api/displayName/tags/locales
npm view cortico-world-feast dist-tags        # latest 应是 0.6.2
```

`npm view` 走的是 CDN，刚发出去可能有几十秒到几分钟的滞后，回 `E404` 先等一下再查。

---

## 5. 让它马上进市场（可选，但建议）

Action 平时每 30 分钟扫一次（每小时 17 分、47 分），GitHub 的定时任务经常推迟几小时。想立刻进市场，去索引仓开一个 `[同步]` issue：

```powershell
# 装了 gh 的话
gh issue create --repo Pal-AI-Lab/cortico-extensions `
  --title "[同步] cortico-world-feast" `
  --body "package: cortico-world-feast"
```

`sync.yml` 会马上跑，回帖说明结果（已收录的版本、npm 上找不到、没有扩展关键字、被拉黑、详情文件的问题），然后关掉 issue。

没装 `gh`（这台机器就没有）也可以直接在网页上开：<https://github.com/Pal-AI-Lab/cortico-extensions/issues/new>。

> 0.2.0 那次没开成，等 Action 自己那一趟等了好几天——**发完就开一个**，别省这一步。

之后在 Coo 的「扩展 → 市场」里搜「一桌菜」就能看到。第一次出现时会带**新品**徽标（`newDays: 14`）。

---

## 6. 截图（唯一还缺的东西）

市场详情页现在只有图标和文字。截图要你自己截，脚本替不了：

1. 重启 Coo，世界页开「一桌菜」
2. 「菜单」页签截一张（能同时看到筛选条、卡片、顶部的「一起吃饭」条最好）
3. 「吃过什么」页签截一张（口味画像那张）
4. 存成 `assets/screenshot-1.png`、`assets/screenshot-2.png`（每张 ≤2MB，最多 8 张）
5. 在 `package.json` 的 `cortico` 块里加：

```jsonc
"screenshots": ["assets/screenshot-1.png", "assets/screenshot-2.png"],
```

6. 截图塞进**当前这一版**：现在的版本号已经是 `0.6.2`（还没发），加完直接 `npm publish` 就行；
   要是 0.6.2 已经发出去了，就再升到 `0.6.3` 重发

截图改了就必须发新版本——市场按版本扫包，不发新版本改不了已收录的那一版。

---

## 标签：为什么是这个组合

作者能声明的只有普通、提示、警示三级；官方标注（`coopanion` 等）由官方 `addTags` 给，自己写了也不算。

当前声明：

| 标签 | 级别 | 为什么 |
| --- | --- | --- |
| `companion` | 普通 | 情绪、作息、时间感、主动开口——饭点和「她自己想吃」都是这类 |
| `internal-state` | 提示 | 这个 World 在 Memory 之外自己记着她吃过什么、对什么有反应、口味画像。装上或卸下前后，她对自己的认知会不一致。**词表明确不推荐在 World 里管内部状态**，我们照实声明。 |
| `experimental` | 提示 | 只在少数配置上验过，兼容性未确认 |

`keywords` 里的 `companion` 会自动映射成普通标签（同一级别，不重复算）。

之前写过 `food` 和 `local`，两个都不对：`food` 不在词表里（市场不认，写了等于没写）；`local` 的意思是「在本机跑模型、要算力和显存」，我们一行推理都不跑。已删掉。

**没声明的**：`injection-risk` 不该有——我们推的四条 internal 事件，正文全是固定模板加扩展自己的数值（菜名、菜系、日期、她自己吃过什么），没有一句是别人写的文字。`high-cost` 也不该有——9 个工具合计约 1.4k token，饭点一天最多 3 次。

如果官方后续加了什么标签，`index.json` 的 `overrides` 里会有 `note` 说明原因；想去掉自己声明的那几个，开一个 `[标签]` issue 就行。

---

## 认证（可选，以后再说）

认证（盾牌徽标）要另外申请，要求（全部满足）：

1. 没有错误的标签、缺失的信息这类基本问题
2. 发布的版本表现稳定
3. World 扩展不直接依赖其他 World 扩展
4. **至少有过一次后续更新**

第 4 条意味着至少要发两个版本才能申请。0.1.1 / 0.2.0 / 0.3.0 / 0.4.0 / 0.5.0 / 0.6.0 都发过，**0.6.1 就是那次后续更新**，
所以现在就可以申请（想把截图一并带上再申请也行，那就等 0.6.2 发出去）。

申请方式是开一个 `[认证]` issue：

```powershell
gh issue create --repo Pal-AI-Lab/cortico-extensions `
  --title "[认证] cortico-world-feast" `
  --body "package: cortico-world-feast"
```

Action 会自动核对能机器查的那几条并回帖。

---

## 之后发新版本

```powershell
# 1. 改代码
# 2. 更新 CHANGELOG.md（市场按 ## 标题里的版本号切段，显示在「历史版本」里）
# 3. 升版本号：npm version patch / minor / major（会同步改 package.json 并打 tag）
npm version patch
# 4. 重生成自描述（工具描述或提示词改过才需要）
node tools/make-describe.mjs
# 5. 发
npm publish
# 6. 想马上进市场就开 [同步] issue
```

改过 `src/ENV_PROMPT.md` 或任何工具描述，**一定要重跑 `make-describe.mjs`**——市场展示的是 `describe.json` 里那份，不是运行时那份。`prepublishOnly` 会拦，但拦的时候已经在发布流程里了，早点跑早点发现。

---

## 出问题怎么办

| 症状 | 原因 | 处理 |
| --- | --- | --- |
| 市场搜不到 | npm 上没有 `cortico-world` 关键字 | 检查 `keywords`，改完发新版本 |
| 卡片上能力摘要那行是空的 | 包里没有 `describe.json`，或 `cortico.describe` 没指对 | `node tools/make-describe.mjs` 后发新版本 |
| 详情「环境提示词」栏空着 | `describe.json` 的 `prompts` 空了 | 同上；检查 `src/ENV_PROMPT.md` 存在 |
| 没有更新说明 | `CHANGELOG.md` 缺当前版本的二级标题 | 补 `## 0.1.1`，发新版本 |
| 图标不显示 | 路径不在 `assets/` 下，或超过 512KB | 重跑 `python tools/make-icon.py` |
| 标签没生效 | 写了词表外的标签 | 只写 `index.json` 词表里的；要新标签得提 `[新标签]` issue |
| 安装后世界不出现 | `cortico.api` 与用户那版 Coo 的契约版本不符 | 当前 world 契约是 6；用户版本旧的话要么升级 Coo，要么用兼容的版本 |
| `npm publish` 报 `prepublishOnly` 失败 | 自查没过 | 按报出来的那一条修 |
| `npm publish` 报 403 | 没登录，或包名被别人占了 | `npm whoami`；`node tools/publish-check.mjs --online` |