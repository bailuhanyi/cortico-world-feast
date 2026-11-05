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
| `check-plan.mjs` | 0.5.0 按组对账 | **可以留着用**，但它写死了 0.5.0 的配额表 |

**要再扩库，别改这些脚本，新写一个。** 现有的常驻工具是：

- `tools/validate-dishes.mjs` —— 契约（字段、字数、类别白名单、套话黑名单）
- `tools/audit-dishes.mjs` —— 结构之外的体检（重名、起手句撞车、分值矛盾、region 空话）
- `tools/check-file.mjs` —— 单文件自查，分批写菜时用

新菜先写成 `组名__批次.json` 放进一个临时目录，用 `audit-dishes` 体检、`check-plan` 对账，
再并进 `src/data`——但**并发写盘时文件名必须由编排方一次算准**（0.5.0 就吃过亏：
两个 agent 写了同一个文件，前一批被静默覆盖，少了 10 道却零报错）。
