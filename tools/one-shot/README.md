# tools/one-shot —— 跑过一次的迁移脚本，**不要再跑**

这里的每个脚本都是一次性迁移：改完数据、写完文件就该停手。它们都是**写盘**的，
而且多数假设"数据还在迁移前那个样子"。数据已经变了，重跑轻则什么都不做，
重则**把新数据改回旧状态**。

| 脚本 | 干了什么 | 现在重跑会怎样 |
| --- | --- | --- |
| `regroup.mjs` | 0.2.0 → 0.3.0：菜系/形态两轴拆开 | 会按 0.3.0 的旧组表重贴 `cuisine`，**把 0.4.0/0.5.0 的分类改回去** |
| `regroup-regions.mjs` | 0.3.0 → 0.4.0：拆掉家常菜/甜品，修 16 处地域错位 | 同上，且引用的组表已过期 |
| `repair-dishes.mjs` | 修首批生成里的 BOM、重复 id、7 样 ingredients | **引用已删除的 `desserts.json`，直接报错**；部分修复已无意义 |
| `add-two.mjs` | 0.4.0 补两道菜（布法罗鸡翅、春川辣炒鸡排） | 这两道已在库里，会因重名/重 id 被拒或写坏 |
| `rename-south-asian.mjs` | `indian.json` → `south-asian.json` | 找不到 `indian.json`，报错退出 |
| `fix-incoming.mjs` | 0.5.0 合并前修重名与起手句撞车 | 依赖 `.incoming/`，那个目录已删，报错退出 |
| `merge-incoming.mjs` | 把 `.incoming/` 并进 `src/data` | 同上，报错退出 |
| `check-plan.mjs` | 按组对账（**可以留着用**） | 默认按当前 0.6.0 表对账；`--v=0.5.0` 看上一版。并发写菜时用它收口 |
| `split-european.mjs` | 0.6.0 把「欧洲菜」按地理拆成南欧菜 + 中欧菜 | **`european.json` 已删，报错退出**（`MOVE` 表里有一道找不到就整批拒绝） |
| `make-plan.mjs` | 0.6.0 把名单切成批次、算准批次文件名 | 它只写 `.incoming/plan.json`，**重跑是安全的**（但那批菜已经合并，plan 已归档） |
| `merge-batches.mjs` | 0.6.0 把 `.incoming/` 并进 `src/data` | 依赖 `.incoming/` 已清空；**重跑会因 id 重复被整批拒绝**（这正是它该有的行为） |
| `bump-copy.mjs` | 0.6.0 升版本号 + 改文案里的道数 | **写死 0.6.0，别再跑**（下个版本要动版本号就手改 `package.json`） |

`roster-0-6-0.json` 不是脚本，是 0.6.0 那 200 道新菜的**名单本身**（id / name / region / category）。
留着的用处：想知道某道新菜当初是按哪个 region 归组的，查它；也用来验证批次有没有漏。

**要再扩库，别改这些脚本，新写一个。** 现有的常驻工具是：

- `tools/validate-dishes.mjs` —— 契约（字段、字数、类别白名单、套话黑名单）+ 全库 id 唯一 + 组文件齐不齐
- `tools/audit-dishes.mjs` —— 结构之外的体检（重名、起手句撞车、分值矛盾、region 空话）
- `tools/check-file.mjs` —— 单文件自查
- `tools/check-batch.mjs` —— **0.6.0 新增**，分批写菜时用：契约 + 逐条对名单 + 全库 id 查重
- `tools/show-openers.mjs` —— **0.6.0 新增**，写之前先看同组旧菜的 `prose` 起手句，别撞

新菜写成 `<组名>__<批次序号>.json` 放进 `.incoming/`，用 `check-batch` 自查、`merge-batches` 收口。
**并发写盘时文件名必须由编排方一次算准**——0.5.0 就吃过亏：`startAt` 偏移算错，
两个 agent 写了同一个文件，前一批被静默覆盖，少了 10 道却零报错。0.6.0 的做法是
`make-plan.mjs` 先生成 `plan.json`（文件名的唯一权威），每个 agent 只准照抄，合并前再按它对账。
