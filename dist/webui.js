/**
 * 一桌菜面板的浏览器端（Coo WebUI 扩展面板）。
 *
 * 约定（见 build/cortico/src/web/shared/client-panel.ts）：
 *   · 默认导出 `{ panels: { <panelId>: { mount(ctx) } } }`
 *   · 只往 `ctx.root` 里写 DOM，不碰 document.body
 *   · 数据一律走 `ctx.invoke(method, args)`
 *
 * 样式随面板注入 ctx.root：实测只靠 dist/webui.css 的面板在宿主里会吃不到，
 * 而宿主可能是普通 DOM 也可能是 shadow root，注入 <style> 两边都成立。
 * 颜色主要走宿主主题的自定义属性（--surface/--foreground/--border/--accent…），
 * 自定义属性会继承进 shadow root，所以明暗两套主题都不用自己写。
 * 菜单纸皮肤（深浅宿主都生效）：把暖色颜料按固定比例混进宿主题色
 * （color-mix：浅底 → 米纸色，深底 → 暖炭色），菜名走衬线 --fe-serif
 * 与暖调墨 --fe-title，「端给她」等主按钮用固定的印章红 --fe-seal。
 *
 * 四个面板：
 *   menu    —— 翻菜单、看九维口味和实吃描写、点「端给她」
 *   combo   —— 一桌一桌地端：现成套餐，或自己攒一桌
 *   history —— 她吃过什么、攒出来的口味画像
 *   today   —— 她自己写下的这一天：此刻在哪一段、今天/明天的时间线、往期
 */

const CSS = `
.feast{--fe-line:color-mix(in srgb,var(--border,#e3e4e3) 88%,#a08050);--fe-ink:var(--foreground,#1b1a1e);--fe-dim:var(--muted-foreground,#5c5c60);--fe-card:color-mix(in srgb,var(--surface,#fbfbfb) 90%,#c9a26a);--fe-accent:var(--accent,#00a870);--fe-seal:#a32d2d;--fe-title:color-mix(in srgb,var(--foreground,#1b1a1e) 92%,#c9a26a);--fe-serif:var(--font-serif,"Noto Serif SC","Songti SC","SimSun",serif);font:13px/1.6 var(--sans,-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif);color:var(--fe-ink);padding:4px 2px 24px}
.feast *{box-sizing:border-box}
.feast-bar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px}
.feast input,.feast select,.feast button{font:inherit;color:inherit;background:var(--fe-card);border:1px solid var(--fe-line);border-radius:var(--radius-sm,6px);padding:5px 9px;outline:none}
.feast input:focus,.feast select:focus{border-color:var(--fe-accent)}
.feast-search{flex:1;min-width:150px}
.feast button{cursor:pointer;transition:background .12s,border-color .12s}
.feast button:hover{border-color:var(--fe-accent)}
.feast-btn-primary{background:var(--fe-seal);border-color:var(--fe-seal);color:#fcebeb;font-weight:600}
.feast-btn-primary:hover{filter:brightness(1.06)}
.feast-btn-primary[disabled]{opacity:.55;cursor:default;filter:none}
.feast-strip{border:1px solid var(--fe-line);border-left:3px solid var(--fe-accent);border-radius:var(--radius-sm,6px);padding:8px 11px;margin-bottom:12px;background:var(--fe-card);display:flex;gap:10px;align-items:baseline;flex-wrap:wrap}
.feast-strip b{font-weight:600}
.feast-strip .feast-dim{color:var(--fe-dim)}
.feast-strip .feast-left{color:var(--fe-dim);font-size:12px;white-space:nowrap;margin-left:auto;font-variant-numeric:tabular-nums}
.feast-count{color:var(--fe-dim);font-size:12px;margin:2px 0 10px}
.feast-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(232px,1fr));gap:10px}
.feast-card{text-align:left;border:1px solid var(--fe-line);border-radius:var(--radius-md,10px);background:var(--fe-card);padding:10px 12px;cursor:pointer;display:flex;flex-direction:column;gap:4px;transition:border-color .12s,transform .12s}
.feast-card:hover{border-color:var(--fe-accent);transform:translateY(-1px)}
.feast-card-h{display:flex;justify-content:space-between;gap:8px;align-items:baseline}
.feast-card-n{font-family:var(--fe-serif);font-weight:600;font-size:14px;color:var(--fe-title)}
.feast-card-m{color:var(--fe-dim);font-size:11.5px}
.feast-card-s{color:var(--fe-dim);font-size:12px;line-height:1.5;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.feast-tags{display:flex;gap:5px;flex-wrap:wrap;margin-top:2px}
.feast-tag{font-size:11px;padding:1px 6px;border-radius:999px;border:1px solid var(--fe-line);color:var(--fe-dim)}
.feast-once{font-size:11px;color:var(--fe-accent);border:1px solid var(--fe-accent);border-radius:999px;padding:1px 6px;white-space:nowrap}
.feast-detail{display:flex;flex-direction:column;gap:12px;max-width:760px}
.feast-detail-h{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap;border-bottom:3px double var(--fe-line);padding-bottom:10px}
.feast-detail-n{font-family:var(--fe-serif);font-size:19px;font-weight:600;line-height:1.3;color:var(--fe-title)}
.feast-detail-m{color:var(--fe-dim);font-size:12px;margin-top:2px}
.feast-block{border:1px solid var(--fe-line);border-radius:var(--radius-md,10px);background:var(--fe-card);padding:10px 13px}
.feast-block-t{font-size:11px;letter-spacing:.06em;color:var(--fe-dim);margin-bottom:6px;text-transform:uppercase}
.feast-prose{line-height:1.85;white-space:pre-wrap}
.feast-taste{display:grid;grid-template-columns:repeat(auto-fit,minmax(168px,1fr));gap:5px 16px}
.feast-taste-row{display:flex;align-items:center;gap:8px}
.feast-taste-k{width:1.6em;color:var(--fe-dim);font-size:12px;flex:none}
.feast-taste-bar{flex:1;height:6px;border-radius:999px;background:color-mix(in srgb,var(--fe-ink) 10%,transparent);overflow:hidden}
.feast-taste-bar i{display:block;height:100%;border-radius:999px}
.feast-taste-v{width:2.2em;text-align:right;color:var(--fe-dim);font-size:11px;flex:none;font-variant-numeric:tabular-nums}
.feast-ing{display:flex;gap:6px;flex-wrap:wrap}
.feast-ing span{font-size:12px;padding:2px 8px;border-radius:999px;background:color-mix(in srgb,var(--fe-ink) 7%,transparent)}
.feast-line{color:var(--fe-dim)}
.feast-line b{color:var(--fe-ink);font-weight:600}
.feast-stats{display:flex;gap:10px;flex-wrap:wrap}
.feast-stat{flex:1;min-width:96px;border:1px solid var(--fe-line);border-radius:var(--radius-md,10px);background:var(--fe-card);padding:9px 12px}
.feast-stat-v{font-size:20px;font-weight:600;line-height:1.2}
.feast-stat-k{font-size:11.5px;color:var(--fe-dim);margin-top:2px}
.feast-list{display:flex;flex-direction:column;gap:0}
.feast-item{display:flex;gap:10px;align-items:baseline;padding:7px 2px;border-bottom:1px solid var(--fe-line)}
.feast-item:last-child{border-bottom:0}
.feast-item-t{color:var(--fe-dim);font-size:11.5px;flex:none;font-variant-numeric:tabular-nums}
.feast-item-n{flex:1}
.feast-flag{font-size:10.5px;padding:1px 6px;border-radius:999px;border:1px solid var(--fe-line);color:var(--fe-dim);flex:none}
.feast-flag.is-owner{border-color:var(--fe-accent);color:var(--fe-accent)}
.feast-empty{color:var(--fe-dim);padding:18px 4px}
.feast-empty.is-bad{color:var(--danger,#b45950)}
.feast-toast{position:sticky;bottom:0;margin-top:12px;border:1px solid var(--fe-accent);border-radius:var(--radius-sm,6px);background:var(--fe-card);padding:7px 11px;font-size:12.5px}
.feast-toast.is-bad{border-color:var(--danger,#b45950)}
/* --- 套餐面板 --- */
.feast-combo-h{font-size:11px;letter-spacing:.06em;color:var(--fe-dim);text-transform:uppercase;margin:16px 0 8px}
.feast-combo-h:first-of-type{margin-top:4px}
.feast-set{border:1px solid var(--fe-line);border-radius:var(--radius-md,10px);background:var(--fe-card);padding:10px 13px;display:flex;flex-direction:column;gap:7px}
.feast-set-h{display:flex;justify-content:space-between;gap:10px;align-items:baseline;flex-wrap:wrap}
.feast-set-n{font-family:var(--fe-serif);font-weight:600;font-size:14px;color:var(--fe-title)}
.feast-set-m{color:var(--fe-dim);font-size:11.5px}
.feast-set-d{color:var(--fe-dim);font-size:12px;line-height:1.5}
.feast-set-dishes{display:flex;gap:5px;flex-wrap:wrap}
.feast-set-dishes span{font-size:11.5px;padding:2px 8px;border-radius:999px;background:color-mix(in srgb,var(--fe-ink) 7%,transparent)}
.feast-set-acts{display:flex;gap:7px;flex-wrap:wrap;margin-top:2px}
.feast-set.is-cur{border-color:var(--fe-accent)}
.feast-pick{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:6px;max-height:340px;overflow:auto;padding:2px}
.feast-chip{display:flex;gap:6px;align-items:center;border:1px solid var(--fe-line);border-radius:var(--radius-sm,6px);background:var(--fe-card);padding:5px 8px;cursor:pointer;text-align:left;font-size:12px}
.feast-chip:hover{border-color:var(--fe-accent)}
.feast-chip.is-on{border-color:var(--fe-accent);background:color-mix(in srgb,var(--fe-accent) 12%,var(--fe-card))}
.feast-chip-n{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.feast-chip-m{color:var(--fe-dim);font-size:10.5px;flex:none}
.feast-build{display:flex;flex-direction:column;gap:9px;border:1px solid var(--fe-line);border-radius:var(--radius-md,10px);background:var(--fe-card);padding:11px 13px}
.feast-build-bar{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.feast-build-bar .feast-search{min-width:130px}
.feast-miss{color:var(--danger,#b45950);font-size:11.5px}
.feast-strip .feast-left.is-done{color:var(--fe-accent)}
/* --- 一起吃饭（会话条；挂在菜单面板顶部，不新开面板） --- */
.feast-together{display:flex;flex-direction:column;gap:7px;border:1px solid var(--fe-accent);border-radius:var(--radius-md,10px);background:var(--fe-card);padding:9px 12px;margin-top:10px}
.feast-together-h{display:flex;justify-content:space-between;gap:10px;align-items:baseline;flex-wrap:wrap}
.feast-together-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;color:var(--fe-dim);font-size:12px}
.feast-together-bar{display:flex;gap:7px;align-items:center;flex-wrap:wrap}
.feast-together-bar .feast-search{flex:1;min-width:130px}
/* --- 今天（她的一天）面板 --- */
.feast-tl{display:flex;flex-direction:column;gap:0}
.feast-tl-row{display:flex;gap:10px;align-items:baseline;padding:6px 8px;border-bottom:1px solid var(--fe-line);border-left:2px solid transparent}
.feast-tl-row:last-child{border-bottom:0}
.feast-tl-row.is-now{border-left-color:var(--fe-accent);background:color-mix(in srgb,var(--fe-accent) 9%,transparent)}
.feast-tl-row.is-past{opacity:.62}
.feast-tl-t{color:var(--fe-dim);font-size:11.5px;flex:none;width:6.8em;font-variant-numeric:tabular-nums}
.feast-tl-n{flex:1;display:flex;flex-direction:column;gap:1px;min-width:0}
.feast-tl-a{font-weight:600}
.feast-tl-d{color:var(--fe-dim);font-size:11.5px;line-height:1.5}
.feast-tl-row.is-now .feast-tl-a{color:var(--fe-accent)}
.feast-day{display:flex;gap:8px;align-items:baseline;flex-wrap:wrap;margin:16px 0 7px}
.feast-day b{font-weight:600}
.feast-day:first-child{margin-top:0}
.feast-day .feast-dim{color:var(--fe-dim);font-size:12px}
.feast-form{display:flex;gap:7px;flex-wrap:wrap;align-items:center}
.feast-form .feast-time{flex:none;width:5.6em;min-width:0;text-align:center;font-variant-numeric:tabular-nums}
.feast-form .feast-activity{flex:1;min-width:130px}
.feast-act{display:flex;gap:7px;flex-wrap:wrap;margin-top:8px}
.feast-note{color:var(--fe-dim);font-size:12px;line-height:1.55;margin-top:6px}
.feast-item.is-click{cursor:pointer}
.feast-item.is-click:hover .feast-item-n{text-decoration:underline}
/* --- 时间线：可点、饭点标记 --- */
.feast-tl-row.is-click{cursor:pointer}
.feast-tl-row.is-click:hover{background:color-mix(in srgb,var(--fe-accent) 6%,transparent)}
.feast-tl-row.is-click:hover .feast-tl-a{text-decoration:underline}
.feast-meal{font-size:10.5px;padding:1px 6px;border-radius:999px;border:1px dashed var(--fe-line);color:var(--fe-dim);flex:none;white-space:nowrap;font-variant-numeric:tabular-nums}
.feast-meal.is-done{border-style:solid;border-color:var(--fe-accent);color:var(--fe-accent)}
.feast-invite-note{flex:1;min-width:150px}
`;

const TABLE = {
  zh: {
    allCuisines: '全部菜系',
    allCats: '全部类别',
    search: '搜菜名 / 产地 / 食材',
    random: '随机一道',
    serve: '端给她',
    serving: '端过去了…',
    back: '← 回菜单',
    pending: '还在她面前',
    pendingHint: '等她用 feast_eat 尝',
    pendingLeft: (m) => (m > 0 ? `还剩约 ${m} 分钟` : '就快收了'),
    pendingGone: '已经收走了',
    matched: (n, total) => `筛出 ${n} 道 / 共 ${total} 道`,
    all: (n) => `共 ${n} 道菜`,
    eatenTimes: (n) => (n ? `吃过 ${n} 回` : '还没吃过'),
    ingredients: '食材',
    method: '做法',
    servingLabel: '上桌',
    taste: '味道',
    texture: '口感',
    aroma: '香气',
    finish: '余韵',
    prose: '这一道吃下去',
    tags: '标签',
    statTotal: '吃过多少回',
    statToday: '今天',
    statKnown: '尝过的菜',
    profile: '口味画像',
    noProfile: '还没吃过什么，画像还是空的。',
    top: '吃得最多',
    recent: '最近几口',
    reactions: '她记过的反应',
    miss: '那次不太对付',
    owner: '主人端的',
    ownerBite: '主人喂的一口',
    like: '好吃',
    dislike: '不对付',
    ok: '一般',
    empty: '没有符合条件的菜。',
    loading: '翻菜单…',
    failed: (e) => `取不到数据：${e}`,
    served: (n) => `端过去了：${n}`,
    /* --- 通用回执（0.7.2：以前这些是散在各处的硬编码中文，切英文也不变） --- */
    sayOk: '记下了',
    sayNo: '不行',
    sayCancel: '取消',
    retract: '收回',
    retracted: (n) => `收回来了：${n}`,
    retractNone: '现在没有摆在她面前的菜。',
    more: (n) => `再看 ${n} 道`,
    shownOf: (a, b) => `画了 ${a} / ${b} 道`,
    /* --- 套餐面板 --- */
    comboPresets: '现成的套餐',
    comboCustom: '你自己攒的',
    comboNone: '还没攒过。下面勾几道，起个名字存下来。',
    comboBuild: '攒一桌',
    comboNamePh: '给这一桌起个名字',
    comboPicked: (n, max) => `已选 ${n} / ${max} 道`,
    comboPick: '看这一桌',
    comboServe: '端这一桌',
    comboPicking: '配菜中…',
    comboSaving: '存…',
    comboRemove: '删',
    comboConfirmRemove: '再点一次就删掉',
    comboEdit: '改',
    comboEmpty: '这一桌配不出菜来。',
    comboHint: '点菜卡选或取消；选好了存下来，下次直接端。',
    comboTable: '这一桌',
    comboLeft: (n, t) => `还剩 ${n} / ${t} 道`,
    comboMissing: (s) => `少配了：${s}`,
    comboNoDish: '这一桌一道菜都选上',
    /* --- 一起吃饭（菜单面板顶部那条） --- */
    togetherNow: (min) => `正一起吃${min ? ` · ${min} 分钟了` : ''}`,
    togetherStartedByOwner: '起头的是主人',
    togetherStartedByHer: '起头的是她',
    togetherInvite: '🍽 一起吃',
    togetherInvitePh: '想先跟她说一句（可留空）',
    togetherHerAsk: (m) => `🍽 她说想和你一起吃饭（还剩约 ${m} 分钟）`,
    togetherAccept: '好，一起吃',
    togetherDecline: '今天不了',
    togetherEnd: '散桌',
    togetherOwnerAte: '主人也在吃',
    togetherNoDish: '只按你说的这句记',
    togetherBites: (n) => `喂过 ${n} 口`,
    togetherBack: (n) => `她分了你一口 ${n}`,
    togetherBackOk: '接过来',
    togetherBackNo: '下次吧',
    togetherBackYes: '接过去了',
    togetherBackNoDone: '这次没要',
    togetherTakePh: '我在吃…（一句话就行）',
    togetherTake: '记下来',
    togetherTakeThis: '我也吃这道',
    togetherBiteThis: '喂她一口',
    togetherLastEnd: (why) => `刚才那顿：${why}`,
    togetherEndWhyFinished: '她那份吃完了',
    togetherEndWhyOwner: '主人说散了',
    togetherEndWhyTtl: '放太久了，收了',
    togetherEndWhyHer: '她先收了',
    /* --- 今天（她的一天）面板 --- */
    dayNow: '此刻',
    dayNowAt: (hm) => `现在是 ${hm}`,
    daySleeping: '她睡着了',
    dayNothingNow: '这会儿没有安排',
    dayToday: '今天',
    dayTomorrow: '明天',
    dayPast: '往期',
    dayNoDay: '这一天她还没想好怎么过。',
    dayOff: '「她的一天」现在关着。到配置里打开 lifeEnabled 才会开始给她排日子。',
    dayAsk: '请她写明天',
    dayAsking: '已经跟她说了…',
    dayAskAgain: '请她重新想想',
    dayAskAgainHint: '她写好了才会盖掉现在这一版；不想改就留着。',
    dayRewriteConfirm: '明天她已经写好了。要请她重写吗？她想好了才会盖掉现在这一版。',
    dayWaiting: '已经在等她写了，到点没写会用模板兜底。',
    daySourceCoo: '她自己写的',
    daySourceTemplate: '临时顶上的',
    daySourcePending: '等她写',
    daySourceManual: '改过的',
    dayChange: '临时改主意',
    dayChangePh: '做什么（留空 = 不做了）',
    dayChangeGo: '改这一段时间',
    dayChangeHint: '填一段时间和一件事；不想做了就把「做什么」留空，那一段时间会空出来。原来压在这段上的安排会被截断或拆开。已经过去的时间改不了（那是事实）。点时间线上任意一段，会把它填进这里。',
    dayChangePicked: (s, e, a) => `已填入 ${s}–${e} ${a}，改完按「改这一段时间」。`,
    dayChanges: (n) => `临时改过 ${n} 次`,
    dayCount: (n) => `${n} 段`,
    dayClickHint: '点这一段改主意',
    dayNoPast: '还没有往期的那一天。',
    dayBack: '← 收起',
    dayMeal: '饭点',
    /* --- 自由时间 --- */
    freeTitle: '她自己的时间',
    freeOff: '自由时间关着。',
    freeGoal: (n, g) => `今天记了 ${n} 件 · 到 ${g} 件就不再按点叫`,
    freeDone: (n) => `今天记了 ${n} 件`,
    freeEnough: '已到数 · 不再按点叫',
    freePending: (slot) => `在等她记「${slot}」这一档`,
    freeNext: (hm) => `下一档 ${hm}`,
    freeNone: '还没有排档',
    freeSkipped: '今天不按点叫了（她随时能自己动）',
    freeNotYet: '今天还没记过什么（不记也不影响她做事）。',
    freeHint: '到点会叫醒她「现在是你自己的时间」。下面这些只是例子：单子外的事、临时起意的都算，做不做、做几件都由她，想开始随时能开始、不用等叫醒。到她睡觉或上班的时段不会叫。',
    freeSkippedSlot: (doing) => `没叫：她那会儿在${doing}`,
    freeSkipToday: '今天先别叫了',
    freeSkipDone: '好了，今天剩下的档不叫了。',
    freeStart: '现在就想动',
    freeStartDone: '行，这会儿就由她自己安排。',
  },
  en: {
    allCuisines: 'All cuisines',
    allCats: 'All categories',
    search: 'Search name / region / ingredient',
    random: 'Surprise me',
    serve: 'Put it down for her',
    serving: 'Serving…',
    back: '← Back to menu',
    pending: 'waiting in front of her',
    pendingHint: 'until she eats it with feast_eat',
    pendingLeft: (m) => (m > 0 ? `about ${m} min left` : 'almost over'),
    pendingGone: 'already cleared away',
    matched: (n, total) => `${n} of ${total} dishes`,
    all: (n) => `${n} dishes`,
    eatenTimes: (n) => (n ? `eaten ${n}×` : 'never eaten'),
    ingredients: 'Ingredients',
    method: 'Method',
    servingLabel: 'At the table',
    taste: 'Flavour',
    texture: 'Texture',
    aroma: 'Aroma',
    finish: 'Aftertaste',
    prose: 'How it eats',
    tags: 'Tags',
    statTotal: 'Meals eaten',
    statToday: 'Today',
    statKnown: 'Dishes known',
    profile: 'Taste profile',
    noProfile: 'Nothing eaten yet.',
    top: 'Most eaten',
    recent: 'Recent bites',
    reactions: 'Logged reactions',
    miss: 'that one missed',
    owner: 'served',
    ownerBite: 'a bite, fed by you',
    like: 'liked',
    dislike: 'missed',
    ok: 'ok',
    empty: 'Nothing matches.',
    loading: 'Loading…',
    failed: (e) => `Failed to load: ${e}`,
    served: (n) => `Served: ${n}`,
    /* --- shared receipts (0.7.2: these used to be hard-coded Chinese) --- */
    sayOk: 'Noted',
    sayNo: 'Cannot',
    sayCancel: 'Cancel',
    retract: 'Take back',
    retracted: (n) => `Taken back: ${n}`,
    retractNone: 'Nothing is sitting in front of her right now.',
    more: (n) => `Show ${n} more`,
    shownOf: (a, b) => `showing ${a} of ${b}`,
    /* --- combo panel --- */
    comboPresets: 'Ready-made sets',
    comboCustom: 'Your own tables',
    comboNone: 'None yet. Pick a few dishes below and save the table.',
    comboBuild: 'Build a table',
    comboNamePh: 'Name this table',
    comboPicked: (n, max) => `${n} / ${max} picked`,
    comboPick: 'Preview',
    comboServe: 'Serve this table',
    comboPicking: 'Resolving…',
    comboSaving: 'Saving…',
    comboRemove: 'Delete',
    comboConfirmRemove: 'Click again to delete',
    comboEdit: 'Edit',
    comboEmpty: 'Nothing resolves for this table.',
    comboHint: 'Tap cards to pick or unpick; save the table and serve it later.',
    comboTable: 'This table',
    comboLeft: (n, t) => `${n} of ${t} left`,
    comboMissing: (s) => `Missing: ${s}`,
    comboNoDish: 'Pick at least one dish',
    /* --- eating together (the bar at the top of the menu panel) --- */
    togetherNow: (min) => `Eating together${min ? ` · ${min} min in` : ''}`,
    togetherStartedByOwner: 'you started it',
    togetherStartedByHer: 'she started it',
    togetherInvite: '🍽 Eat together',
    togetherInvitePh: 'Say something first (optional)',
    togetherHerAsk: (m) => `🍽 She asked you to eat together (about ${m} min left)`,
    togetherAccept: 'Okay, let’s eat',
    togetherDecline: 'Not today',
    togetherEnd: 'Clear the table',
    togetherOwnerAte: 'you are eating',
    togetherNoDish: 'from your words',
    togetherBites: (n) => `${n} bites fed`,
    togetherBack: (n) => `She offered you a bite of ${n}`,
    togetherBackOk: 'Take it',
    togetherBackNo: 'Next time',
    togetherBackYes: 'taken',
    togetherBackNoDone: 'declined',
    togetherTakePh: 'I am eating… (one line is enough)',
    togetherTake: 'Note it',
    togetherTakeThis: 'I’m having this too',
    togetherBiteThis: 'Feed her a bite',
    togetherLastEnd: (why) => `Last meal: ${why}`,
    togetherEndWhyFinished: 'her share was finished',
    togetherEndWhyOwner: 'you called it',
    togetherEndWhyTtl: 'it sat too long',
    togetherEndWhyHer: 'she closed it',
    /* --- 今天（她的一天）面板 --- */
    dayNow: 'Right now',
    dayNowAt: (hm) => `${hm} now`,
    daySleeping: 'She is asleep',
    dayNothingNow: 'Nothing planned this minute',
    dayToday: 'Today',
    dayTomorrow: 'Tomorrow',
    dayPast: 'Earlier days',
    dayNoDay: 'She has not decided how to spend this day yet.',
    dayOff: 'Her day is switched off. Turn on lifeEnabled in config to start it.',
    dayAsk: 'Ask her to write tomorrow',
    dayAsking: 'Asked her…',
    dayAskAgain: 'Ask her to rethink it',
    dayAskAgainHint: 'Her version is only replaced if she actually writes a new one.',
    dayRewriteConfirm: 'She has already written tomorrow. Ask her to rewrite it? Only a new reply from her replaces the current one.',
    dayWaiting: 'Already waiting on her; a template fills in if she does not reply.',
    daySourceCoo: 'written by her',
    daySourceTemplate: 'stood in',
    daySourcePending: 'waiting for her',
    daySourceManual: 'adjusted',
    dayChange: 'Change of plan',
    dayChangePh: 'what she does (blank = skip it)',
    dayChangeGo: 'Change this block',
    dayChangeHint: 'Give a time range and an activity; leave the activity blank to skip that stretch instead. Whatever was planned there is trimmed or split. Hours that are already over cannot be changed — they are what happened. Clicking any row on the timeline fills it in here.',
    dayChangePicked: (s, e, a) => `Filled in ${s}–${e} ${a} — press “Change this block”.`,
    dayChanges: (n) => `adjusted ${n}×`,
    dayCount: (n) => `${n} blocks`,
    dayClickHint: 'Click to change this stretch',
    dayNoPast: 'Nothing here yet.',
    dayBack: '← Close',
    dayMeal: 'Meal',
    /* --- free time --- */
    freeTitle: 'Her own time',
    freeOff: 'Free time is off.',
    freeGoal: (n, g) => `${n} logged · stops calling at ${g}`,
    freeDone: (n) => `${n} logged today`,
    freeEnough: 'at the number · no more scheduled wake-ups',
    freePending: (slot) => `waiting on her to log the ${slot} slot`,
    freeNext: (hm) => `next ${hm}`,
    freeNone: 'no slots',
    freeSkipped: 'no scheduled wake-ups today (she can still do anything)',
    freeNotYet: 'Nothing logged yet (not logging does not stop her doing things).',
    freeHint: 'She is woken at these slots. The list is only examples — anything at all counts, and she may do as much or as little as she likes, starting whenever she wants without waiting for a wake-up. Never while the schedule says she is asleep or at work.',
    freeSkippedSlot: (doing) => `skipped: she was ${doing}`,
    freeSkipToday: 'No wake-ups today',
    freeSkipDone: 'Done — no more scheduled wake-ups today.',
    freeStart: 'Start something now',
    freeStartDone: 'Fine — she can do whatever she likes right now.',
  },
};

function tableFor(language) {
  return language === 'zh' || language === 'zh-Hant' ? TABLE.zh : TABLE.en;
}

/** 九维口味的条色，按维度固定，扫一眼就能认出这道菜往哪边走。 */
const TASTE_COLOR = {
  辣: '#e0533f',
  麻: '#a06be0',
  咸: '#6b7f99',
  鲜: '#3aa76d',
  甜: '#e07aa8',
  酸: '#d8a92c',
  苦: '#8a6a4f',
  油: '#c98a3c',
  香: '#3fa8a0',
};
const TASTE_ORDER = ['辣', '麻', '咸', '鲜', '甜', '酸', '苦', '油', '香'];

const el = (tag, cls, text) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = String(text);
  return node;
};

/** <option> 也一样用 document 建，别依赖全局 Option。 */
const option = (label, value) => {
  const o = document.createElement('option');
  o.textContent = label;
  o.value = value;
  return o;
};

function tasteRows(taste) {
  const wrap = el('div', 'feast-taste');
  for (const k of TASTE_ORDER) {
    const v = Number(taste?.[k] ?? 0);
    const row = el('div', 'feast-taste-row');
    row.appendChild(el('span', 'feast-taste-k', k));
    const bar = el('span', 'feast-taste-bar');
    const fill = el('i');
    fill.style.width = `${Math.max(0, Math.min(100, v))}%`;
    fill.style.background = TASTE_COLOR[k] ?? 'currentColor';
    bar.appendChild(fill);
    row.appendChild(bar);
    row.appendChild(el('span', 'feast-taste-v', v));
    wrap.appendChild(row);
  }
  return wrap;
}

function block(title, content) {
  const b = el('div', 'feast-block');
  b.appendChild(el('div', 'feast-block-t', title));
  if (typeof content === 'string') b.appendChild(el('div', 'feast-prose', content));
  else if (content) b.appendChild(content);
  return b;
}

function line(label, value) {
  const p = el('div', 'feast-line');
  p.appendChild(el('b', null, `${label}：`));
  p.appendChild(document.createTextNode(String(value ?? '')));
  return p;
}

/** 首屏一次画多少张卡；「再看 N 道」往上加。800 张全画是 8000 多个节点。 */
const MENU_PAGE = 60;

function toast(root, ctx, text, bad = false) {
  const old = root.querySelector('.feast-toast');
  if (old) old.remove();
  const node = el('div', `feast-toast${bad ? ' is-bad' : ''}`, text);
  root.appendChild(node);
  ctx.timeout(() => node.remove(), 4000);
}

// ---------------------------------------------------------------------------
// 菜单面板
// ---------------------------------------------------------------------------

const menuPanel = {
  async mount(ctx) {
    const t = tableFor(ctx.language);
    const root = ctx.root;
    root.classList.add('feast');
    const style = el('style');
    style.textContent = CSS;
    root.appendChild(style);

    const state = { filter: {}, cuisines: [], categories: [], categoryCuisines: {}, detail: null, pending: null, together: null, last: null };
    /** 首屏画到第几张；换筛选/搜索要回到第一页（见 load）。 */
    let shownCount = MENU_PAGE;
    /** 等待条右边那个"还剩多久"的节点，随钟走。 */
    let pendingBox = null;
    /** 会话条里要随钟走的那几个节点。 */
    let togetherBox = null;
    const wrap = el('div');
    root.appendChild(wrap);

    /**
     * 重拉会先摘掉整棵树再重画：正在打字的搜索框（或会话条的记一笔输入框）
     * 会跟着被摘掉，焦点、光标、没提交的草稿全丢。这里把「刚才焦点在哪个位子、
     * 光标在哪」存下来，重画完放回去。位子用节点身份认（searchNode/noteNode），
     * 因为重画后节点是新的，身份对不上。
     */
    let focusSave = null;
    let searchNode = null;
    let noteNode = null;
    /** 会话条「记一笔」没提交的草稿：结构变了整条重画时别把人打了一半的字吞掉。 */
    let noteDraft = '';
    /** 「一起吃」那栏带的这句话的草稿，同理。 */
    let inviteDraft = '';
    const saveFocus = () => {
      const a = document.activeElement;
      // a 得先非空：谁都没聚焦时 a 是 null，而 searchNode 这时也是 null，
      // null === null 会误判成"焦点在搜索框上"。
      if (a && (a === searchNode || a === noteNode)) {
        focusSave = { note: a === noteNode, start: a.selectionStart, end: a.selectionEnd };
      }
    };
    const loadFocus = () => {
      const f = focusSave;
      focusSave = null;
      if (!f) return;
      const node = f.note ? noteNode : searchNode;
      if (!node) return;
      node.focus();
      if (typeof f.start === 'number') {
        try { node.setSelectionRange(f.start, f.end); } catch { /* 光标超界就算了 */ }
      }
    };

    /** 还剩几分钟（向上取整：不到一分钟也算"1 分钟"，别显示 0）。 */
    function remainMin(p) {
      const ttl = Number(p?.ttlMin) || 30;
      const at = Number(p?.at) || 0;
      const leftMs = at + ttl * 60_000 - Date.now();
      return leftMs <= 0 ? 0 : Math.ceil(leftMs / 60_000);
    }

    /** 会话条上的动作都走这里：调服务端 → 报一句 → 重拉一次。 */
    async function act(method, args) {
      try {
        const r = await ctx.invoke(method, args ?? []);
        if (r?.ok === false) toast(root, ctx, r?.message ?? t.sayNo, true);
        else if (r?.message) toast(root, ctx, r.message);
        await load();
      } catch (err) {
        toast(root, ctx, t.failed(err?.message ?? err), true);
      }
    }

    /** 散桌的四种说法。 */
    function endWhy(why) {
      if (why === 'finished') return t.togetherEndWhyFinished;
      if (why === 'ttl') return t.togetherEndWhyTtl;
      if (why === 'her') return t.togetherEndWhyHer;
      return t.togetherEndWhyOwner;
    }

    /**
     * 一起吃饭那条。三种样子：正一起吃 / 她挂着邀请 / 都没有（只有一个小按钮）。
     *
     * 动作做完就整块重拉；但**自走表那一路只拉这一条、只改那几个字**（见 refreshTogether）：
     * 701 张卡每 30 秒重建一次既费，也会把搜索框的焦点和滚动位置弄丢。
     */
    function togetherBar(tg) {
      const box = el('div', 'feast-together');

      if (tg.active) {
        const head = el('div', 'feast-together-h');
        const title = el('b', null, `🍽 ${t.togetherNow(tg.elapsedMin)}`);
        head.appendChild(title);
        head.appendChild(el('span', 'feast-dim',
          tg.starter === 'her' ? t.togetherStartedByHer : t.togetherStartedByOwner));
        const end = el('button', null, t.togetherEnd);
        end.onclick = () => void act('end');
        head.appendChild(end);
        box.appendChild(head);
        togetherBox = { title, tg };

        for (const e of tg.ownerAte ?? []) {
          const what = e.kind === 'dish' ? e.name : e.note;
          box.appendChild(el('div', 'feast-together-row',
            `${t.togetherOwnerAte}：${what}${e.kind === 'note' ? `（${t.togetherNoDish}）` : ''}`));
        }
        if (tg.biteCount) {
          box.appendChild(el('div', 'feast-together-row',
            `${t.togetherBites(tg.biteCount)}：${(tg.bites ?? []).map((b) => b.name || b.id).join('、')}`));
        }

        // 主人自己也吃点什么：库内那道在菜品详情里点「我也吃这道」，这里写自由文本。
        const bar = el('div', 'feast-together-bar');
        const note = el('input', 'feast-search');
        note.placeholder = t.togetherTakePh;
        // 她那边一动（分了一口、先收了这顿）整条会重画：草稿存外面，重画带回来。
        note.value = noteDraft;
        note.oninput = () => { noteDraft = String(note.value ?? ''); };
        noteNode = note;
        bar.appendChild(note);
        const say = el('button', null, t.togetherTake);
        say.onclick = () => {
          const text = String(note.value ?? '').trim();
          noteDraft = ''; // 记下了就清草稿，重画后输入框跟着清空
          void act('take', [{ note: text }]);
        };
        bar.appendChild(say);
        box.appendChild(bar);

        for (const g of tg.back ?? []) {
          const row = el('div', 'feast-together-row');
          row.appendChild(el('span', null, t.togetherBack(g.name || g.id)));
          if (g.ok === null) {
            const yes = el('button', 'feast-btn-primary', t.togetherBackOk);
            yes.onclick = () => void act('reply', [{ ok: true }]);
            const no = el('button', null, t.togetherBackNo);
            no.onclick = () => void act('reply', [{ ok: false }]);
            row.appendChild(yes);
            row.appendChild(no);
          } else {
            row.appendChild(el('span', 'feast-dim', g.ok ? t.togetherBackYes : t.togetherBackNoDone));
          }
          box.appendChild(row);
        }
        return box;
      }

      if (tg.invite) {
        const head = el('div', 'feast-together-h');
        const left = el('b', null, t.togetherHerAsk(tg.invite.leftMin));
        head.appendChild(left);
        box.appendChild(head);
        togetherBox = { invite: left, tg };

        const bar = el('div', 'feast-together-bar');
        const yes = el('button', 'feast-btn-primary', t.togetherAccept);
        yes.onclick = () => void act('accept');
        const no = el('button', null, t.togetherDecline);
        no.onclick = () => void act('decline');
        bar.appendChild(yes);
        bar.appendChild(no);
        box.appendChild(bar);
        return box;
      }

      const bar = el('div', 'feast-together-bar');
      // 服务端 inviteTogether(note) 一直支持带一句话（会原样拼进推给她的事件），
      // 0.7.1 的面板却只调 act('invite')、不传 note——主人想先交代一句「今天有点累」没法说。
      // 用单独的 class（不叫 feast-search）：菜单面板顶上那个才是搜索框。
      const note = el('input', 'feast-invite-note');
      note.placeholder = t.togetherInvitePh;
      note.value = inviteDraft;
      note.oninput = () => { inviteDraft = String(note.value ?? ''); };
      const ask = el('button', null, t.togetherInvite);
      ask.onclick = () => {
        const said = String(note.value ?? '').trim();
        inviteDraft = ''; // 发出去了就清草稿，重画后输入框跟着空
        ask.disabled = true;
        void act('invite', [said ? { note: said } : undefined]);
      };
      bar.appendChild(note);
      bar.appendChild(ask);
      if (tg.lastEnd) {
        bar.appendChild(el('span', 'feast-dim', t.togetherLastEnd(endWhy(tg.lastEnd.why))));
      }
      box.appendChild(bar);
      return box;
    }

    /** 会话条的"结构签名"：只有它变了才值得重画整块；分钟数变了只改那几个字。 */
    function togetherSig(v) {
      if (!v) return '';
      return JSON.stringify({
        active: v.active,
        at: v.at,
        invite: v.invite ? v.invite.at : 0,
        lastEnd: v.lastEnd ? v.lastEnd.at : 0,
        bites: v.biteCount,
        owner: (v.ownerAte ?? []).length,
        back: (v.back ?? []).map((g) => [g.id, g.ok]),
      });
    }

    /**
     * 只拉「一起吃饭」这一条并就地更新。
     *
     * 她那边动了（挂了邀请 / 分了主人一口 / 先收了这顿）只有服务端知道，所以面板得自己走表；
     * 但结构没变时**不重画卡片**，只把分钟数那几个字改掉。
     */
    async function refreshTogether() {
      let next = null;
      try {
        next = (await ctx.invoke('together', []))?.together ?? null;
      } catch {
        return; // 拉不到就算了，下一拍再来
      }
      if (!next || togetherSig(next) !== togetherSig(state.together)) {
        state.together = next;
        await load();
        return;
      }
      state.together = next;
      if (togetherBox?.title) togetherBox.title.textContent = `🍽 ${t.togetherNow(next.elapsedMin)}`;
      if (togetherBox?.invite && next.invite) {
        togetherBox.invite.textContent = t.togetherHerAsk(next.invite.leftMin);
      }
    }

    async function load() {
      saveFocus(); // 摘树之前存：一摘焦点就没了，事后想存也摸不到
      // 换筛选/搜索回到第一页；顺带把滚动位置也带回来（0.7.1 这里不存，一搜就跳回顶部）。
      shownCount = MENU_PAGE;
      const keepScroll = wrap.scrollTop;
      wrap.replaceChildren(el('div', 'feast-empty', t.loading));
      let data;
      try {
        data = await ctx.invoke('list', [{ ...state.filter }]);
      } catch (err) {
        wrap.replaceChildren(el('div', 'feast-empty is-bad', t.failed(err?.message ?? err)));
        return;
      }
      state.cuisines = data.cuisines ?? [];
      state.categories = data.categories ?? [];
      state.categoryCuisines = data.categoryCuisines ?? {};
      // 每次重拉都跟着服务端走：端来的菜可能是在别处端的，也可能已经被吃掉/过期收走。
      state.pending = data.pending ?? null;
      // 一起吃饭同理：她那边挂了邀请、分了主人一口，都只有服务端知道。
      state.together = data.together ?? null;
      // 会话条自己走表时要重画，而重画要的那份数据得留着。
      state.last = data;
      render(data, { scroll: keepScroll });
    }

    function render(data, opts = {}) {
      wrap.replaceChildren();
      pendingBox = null;
      togetherBox = null;
      noteNode = null; // 会话条这一趟没画记一笔的话，别让恢复焦点摸到旧节点

      // 一起吃饭（会话条）放在工具条下面、等待条上面：
      // "我们一起吃" 比 "我端了东西给你" 更贴顶，两者同时存在时也读得通。
      if (state.together) wrap.appendChild(togetherBar(state.together));

      // 工具条
      const bar = el('div', 'feast-bar');
      const search = el('input', 'feast-search');
      search.type = 'search';
      search.placeholder = t.search;
      search.value = state.filter.query ?? '';
      searchNode = search;
      let timer = null;
      const queueSearch = () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          state.filter.query = String(search.value ?? '').trim();
          void load();
        }, 260);
      };
      search.oninput = (e) => {
        // 输入法组词中别重拉：树一摘，组了一半的词当场散掉。
        if (e.isComposing) return;
        queueSearch();
      };
      search.addEventListener('compositionend', queueSearch);
      bar.appendChild(search);

      // 先形态，后菜系。菜系下拉跟着已选类别收窄——选了「汤羹」就不该再列「墨西哥菜」，
      // 那种选项按下去必然是空的。菜系轴上 0.3.0 起只有地域/传统，形态全在这边。
      const cat = el('select');
      cat.appendChild(option(t.allCats, ''));
      for (const c of state.categories) cat.appendChild(option(c, c));
      cat.value = state.filter.category ?? '';
      cat.onchange = () => {
        state.filter.category = cat.value;
        // 换类别后原来选的菜系可能已经不在这一类里了，直接清掉，别让她看到空结果。
        const allowed = state.filter.category
          ? (state.categoryCuisines[state.filter.category] ?? [])
          : state.cuisines;
        if (state.filter.cuisine && !allowed.includes(state.filter.cuisine)) state.filter.cuisine = '';
        void load();
      };
      bar.appendChild(cat);

      const cuisine = el('select');
      cuisine.appendChild(option(t.allCuisines, ''));
      const pool = state.filter.category
        ? (state.categoryCuisines[state.filter.category] ?? [])
        : state.cuisines;
      for (const c of pool) cuisine.appendChild(option(c, c));
      cuisine.value = state.filter.cuisine ?? '';
      cuisine.onchange = () => {
        state.filter.cuisine = cuisine.value;
        void load();
      };
      bar.appendChild(cuisine);

      const dice = el('button', 'feast-btn-primary', t.random);
      dice.onclick = async () => {
        dice.disabled = true;
        try {
          const r = await ctx.invoke('random', [{ ...state.filter }]);
          if (r?.ok && r.dish) openDetail(r.dish.id);
          else toast(root, ctx, r?.message ?? t.empty, true);
        } catch (err) {
          toast(root, ctx, t.failed(err?.message ?? err), true);
        } finally {
          dice.disabled = false;
        }
      };
      bar.appendChild(dice);
      wrap.appendChild(bar);

      // 端过来还没吃的那道：右侧写着还剩多久，自己会走。端错了能就地收回来。
      if (state.pending) {
        const p = state.pending;
        const strip = el('div', 'feast-strip');
        strip.appendChild(el('b', null, `🍽 ${p.name ?? (p.isTable ? t.comboTable : '')}`));
        strip.appendChild(el('span', 'feast-dim', `${t.pending} · ${t.pendingHint}`));
        const left = el('span', 'feast-left', t.pendingLeft(remainMin(p)));
        const back = el('button', null, t.retract);
        back.onclick = async () => {
          back.disabled = true;
          try {
            const r = await ctx.invoke('retract', []);
            // 服务端在真没东西可收时回 ok:false；act() 只管报错，这里要自己重画。
            if (r?.ok) toast(root, ctx, r.message ?? t.retracted(p.name ?? ''));
            else toast(root, ctx, r?.message ?? t.retractNone, true);
          } catch (err) {
            toast(root, ctx, t.failed(err?.message ?? err), true);
          } finally {
            await load();
          }
        };
        strip.appendChild(back);
        strip.appendChild(left);
        pendingBox = { el: left, p };
        wrap.appendChild(strip);
      }

      // 首屏只画前 MENU_PAGE 张：库已经 800 道，全画一次是 8000 多个节点，
      // 而主人一屏最多看十几张。剩下的按「再看 N 道」一批一批加，不重新拉数据。
      const total = data.items.length;
      const shown = Math.min(shownCount, total);
      wrap.appendChild(el('div', 'feast-count', data.matched < data.total
        ? t.matched(data.matched, data.total)
        : t.all(data.total)));

      if (!total) {
        wrap.appendChild(el('div', 'feast-empty', t.empty));
        loadFocus();
        return;
      }

      const grid = el('div', 'feast-grid');
      for (const d of data.items.slice(0, shown)) {
        const card = el('button', 'feast-card');
        const h = el('div', 'feast-card-h');
        h.appendChild(el('span', 'feast-card-n', d.name));
        const meta = el('span', 'feast-card-m', `${d.cuisine}·${d.category}`);
        h.appendChild(meta);
        card.appendChild(h);
        card.appendChild(el('div', 'feast-card-m', [d.region, t.eatenTimes(d.eaten)].filter(Boolean).join(' · ')));
        if (d.serving) card.appendChild(el('div', 'feast-card-s', d.serving));
        const tags = el('div', 'feast-tags');
        for (const k of (d.keywords ?? []).slice(0, 4)) tags.appendChild(el('span', 'feast-tag', k));
        card.appendChild(tags);
        card.onclick = () => openDetail(d.id);
        grid.appendChild(card);
      }
      wrap.appendChild(grid);

      if (shown < total) {
        const moreBox = el('div', 'feast-act');
        const more = el('button', null, t.more(Math.min(MENU_PAGE, total - shown)));
        more.onclick = () => {
          shownCount = Math.min(total, shown + MENU_PAGE);
          render(data, { scroll: wrap.scrollTop });
        };
        moreBox.appendChild(more);
        moreBox.appendChild(el('span', 'feast-count', t.shownOf(shown, total)));
        wrap.appendChild(moreBox);
      }

      loadFocus(); // 重画完把焦点和光标放回搜索框（或会话条输入框）
      if (typeof opts.scroll === 'number') wrap.scrollTop = opts.scroll;
    }

    async function openDetail(id) {
      wrap.replaceChildren(el('div', 'feast-empty', t.loading));
      let data;
      try {
        data = await ctx.invoke('dish', [id]);
      } catch (err) {
        wrap.replaceChildren(el('div', 'feast-empty is-bad', t.failed(err?.message ?? err)));
        return;
      }
      if (!data?.ok) {
        wrap.replaceChildren(el('div', 'feast-empty is-bad', data?.message ?? 'nope'));
        return;
      }
      // 服务端说没了就是没了（吃掉了 / 收走了），不能把旧的等待条留在屏幕上
      state.pending = data.pending ?? null;
      const d = data.dish;

      const box = el('div', 'feast-detail');
      const back = el('button', null, t.back);
      back.onclick = () => void load();
      box.appendChild(back);

      const head = el('div', 'feast-detail-h');
      const left = el('div');
      left.appendChild(el('div', 'feast-detail-n', d.name));
      left.appendChild(el('div', 'feast-detail-m',
        [d.alias, `${d.cuisine} · ${d.category}`, d.region, t.eatenTimes(d.eaten)].filter(Boolean).join(' · ')));
      head.appendChild(left);
      const serve = el('button', 'feast-btn-primary', t.serve);
      serve.onclick = async () => {
        serve.disabled = true;
        serve.textContent = t.serving;
        try {
          const r = await ctx.invoke('feed', [d.id]);
          if (r?.ok) {
            state.pending = r.pending ?? null;
            toast(root, ctx, t.served(r.dish?.name ?? d.name));
            // 端完回到菜单，让她自己看到"还在她面前"那条
            await load();
          } else {
            toast(root, ctx, r?.message ?? t.sayNo, true);
            serve.disabled = false;
            serve.textContent = t.serve;
          }
        } catch (err) {
          toast(root, ctx, t.failed(err?.message ?? err), true);
          serve.disabled = false;
          serve.textContent = t.serve;
        }
      };
      head.appendChild(serve);
      // 正一起吃的时候，才谈得上"喂她一口"和"我也吃这道"——不在席上没这个上下文。
      if (state.together?.active) {
        const bite = el('button', null, t.togetherBiteThis);
        bite.onclick = async () => {
          bite.disabled = true;
          try {
            const r = await ctx.invoke('bite', [d.id]);
            if (r?.ok) {
              state.together = r.together ?? state.together;
              toast(root, ctx, r.message ?? t.sayOk);
              bite.disabled = false;
            } else {
              toast(root, ctx, r?.message ?? t.sayNo, true);
              bite.disabled = false;
            }
          } catch (err) {
            toast(root, ctx, t.failed(err?.message ?? err), true);
            bite.disabled = false;
          }
        };
        head.appendChild(bite);

        const mine = el('button', null, t.togetherTakeThis);
        mine.onclick = async () => {
          mine.disabled = true;
          try {
            const r = await ctx.invoke('take', [{ id: d.id }]);
            if (r?.ok) {
              state.together = r.together ?? state.together;
              toast(root, ctx, r.message ?? t.sayOk);
              mine.disabled = false;
            } else {
              toast(root, ctx, r?.message ?? t.sayNo, true);
              mine.disabled = false;
            }
          } catch (err) {
            toast(root, ctx, t.failed(err?.message ?? err), true);
            mine.disabled = false;
          }
        };
        head.appendChild(mine);
      }
      box.appendChild(head);

      if (d.serving) box.appendChild(block(t.servingLabel, d.serving));
      box.appendChild(block(t.taste, tasteRows(d.taste)));
      if (d.ingredients?.length) {
        const ing = el('div', 'feast-ing');
        for (const i of d.ingredients) ing.appendChild(el('span', null, i));
        box.appendChild(block(t.ingredients, ing));
      }
      if (d.method) box.appendChild(block(t.method, d.method));
      const senses = el('div');
      if (d.texture) senses.appendChild(line(t.texture, d.texture));
      if (d.aroma) senses.appendChild(line(t.aroma, d.aroma));
      if (d.finish) senses.appendChild(line(t.finish, d.finish));
      if (senses.childNodes.length) box.appendChild(block(`${t.texture} / ${t.aroma} / ${t.finish}`, senses));
      if (d.prose) box.appendChild(block(t.prose, d.prose));
      if (d.keywords?.length) {
        const tags = el('div', 'feast-tags');
        for (const k of d.keywords) tags.appendChild(el('span', 'feast-tag', k));
        box.appendChild(block(t.tags, tags));
      }
      wrap.replaceChildren(box);
    }

    await load();

    // 每 30 秒走一次表：等待条只改那一行字，到点了才整块刷新；
    // 「一起吃饭」那条也在这一拍里轮询（她在聊天里答应/收摊只有服务端知道）。
    // ctx.interval 已登记，unmount 会自动停；老宿主没有这个方法就当没有它。
    const ticker = ctx.interval?.(() => {
      if (pendingBox) {
        const left = remainMin(pendingBox.p);
        if (left > 0) pendingBox.el.textContent = t.pendingLeft(left);
        else {
          pendingBox.el.textContent = t.pendingGone;
          void load();
          return;
        }
      }
      void refreshTogether();
    }, 30_000);

    return { dispose() { ticker?.dispose?.(); } };
  },
};

// ---------------------------------------------------------------------------
// 历史面板
// ---------------------------------------------------------------------------

const historyPanel = {
  async mount(ctx) {
    const t = tableFor(ctx.language);
    const root = ctx.root;
    root.classList.add('feast');
    const style = el('style');
    style.textContent = CSS;
    root.appendChild(style);

    let data;
    try {
      data = await ctx.invoke('list', []);
    } catch (err) {
      root.appendChild(el('div', 'feast-empty is-bad', t.failed(err?.message ?? err)));
      return { dispose() {} };
    }

    const stats = el('div', 'feast-stats');
    // 「尝过的菜」取 data.known（服务端算的 Object.keys(counts).length），
    // 不能取 data.top.length —— top 在服务端被 slice(0, 12) 截过，吃 20 道也只显示 12。
    for (const [k, v] of [[t.statTotal, data.total], [t.statToday, data.today], [t.statKnown, data.known ?? 0]]) {
      const s = el('div', 'feast-stat');
      s.appendChild(el('div', 'feast-stat-v', v));
      s.appendChild(el('div', 'feast-stat-k', k));
      stats.appendChild(s);
    }
    root.appendChild(stats);

    const profile = el('div');
    if (data.profile?.avg) {
      profile.appendChild(tasteRows(data.profile.avg));
      for (const l of data.profile.lines ?? []) profile.appendChild(el('div', 'feast-line', l));
    } else {
      profile.appendChild(el('div', 'feast-line', t.noProfile));
    }
    root.appendChild(block(t.profile, profile));

    if (data.top?.length) {
      const list = el('div', 'feast-list');
      for (const item of data.top) {
        const row = el('div', 'feast-item');
        row.appendChild(el('span', 'feast-item-n', item.name));
        row.appendChild(el('span', 'feast-item-t', `×${item.n}`));
        list.appendChild(row);
      }
      root.appendChild(block(t.top, list));
    }

    if (data.recent?.length) {
      const list = el('div', 'feast-list');
      for (const e of data.recent) {
        const row = el('div', 'feast-item');
        const when = new Date(e.at);
        const hh = String(when.getHours()).padStart(2, '0');
        const mm = String(when.getMinutes()).padStart(2, '0');
        row.appendChild(el('span', 'feast-item-t', `${when.getMonth() + 1}/${when.getDate()} ${hh}:${mm}`));
        row.appendChild(el('span', 'feast-item-n', e.name));
        if (e.bite) row.appendChild(el('span', 'feast-flag is-owner', t.ownerBite));
        else if (e.by === 'owner') row.appendChild(el('span', 'feast-flag is-owner', t.owner));
        if (e.miss) row.appendChild(el('span', 'feast-flag', t.miss));
        list.appendChild(row);
      }
      root.appendChild(block(t.recent, list));
    }

    if (data.reactions?.length) {
      const list = el('div', 'feast-list');
      for (const r of data.reactions) {
        const row = el('div', 'feast-item');
        const word = r.liked === true ? t.like : r.liked === false ? t.dislike : t.ok;
        row.appendChild(el('span', 'feast-item-t', word));
        row.appendChild(el('span', 'feast-item-n', `${r.name || r.id}${r.note ? `——${r.note}` : ''}`));
        list.appendChild(row);
      }
      root.appendChild(block(t.reactions, list));
    }

    return { dispose() {} };
  },
};

// ---------------------------------------------------------------------------
// 今天面板（她的一天）
// ---------------------------------------------------------------------------

/**
 * 她自己写下的这一天。
 *
 * 与别的面板不同，这一页是**读**为主：今天/明天的时间线、此刻落在哪一段、
 * 有几天往期。能动手的只有两处——请她写明天、临时改一段。
 *
 * 「此刻」不调 momentLine：那是给模型看的，末尾带着「不用特意跟主人汇报」。
 * 服务端 list 给的是 nowItem（当前那一段）和 nowMinute，这里自己拼句子。
 */
const todayPanel = {
  async mount(ctx) {
    const t = tableFor(ctx.language);
    const root = ctx.root;
    root.classList.add('feast');
    const style = el('style');
    style.textContent = CSS;
    root.appendChild(style);

    const wrap = el('div');
    root.appendChild(wrap);

    /** 面板数据（list 的整份回执）。 */
    let data = null;
    /** 正在看哪一天；null = 就用服务端给的今天。 */
    let viewing = null;
    /** 「请她写明天」正在等回执，按钮别连点。 */
    let asking = false;
    /** 改主意表单里有没有没提交的草稿：有就说明人正在打字，别重画。 */
    let draftNode = null;
    const hasDraft = () => Boolean(draftNode
      && (draftNode.value || draftNode === document.activeElement));

    /** 改主意表单的三个输入框，点时间线时往里填。 */
    let changeInputs = null;

    const sourceLabel = (s) => (s === 'coo' ? t.daySourceCoo
      : s === 'template' ? t.daySourceTemplate
        : s === 'pending' ? t.daySourcePending
          : s === 'manual' ? t.daySourceManual : '');
    // 睡觉判据跟服务端对齐：/睡/ 认不出「回笼觉」「打盹」。
    const isSleep = (it) => /睡|回笼觉|打盹|小憩|眯一会|补觉|午觉|赖床/.test(String(it?.activity ?? ''));

    /** 'HH:MM' → 当天第几分钟；坏值给 null（时间线不该因为一行脏数据整页不画）。 */
    function minuteOf(hm) {
      const m = /^\s*(\d{1,2})\s*[:：]\s*(\d{2})\s*$/.exec(String(hm ?? ''));
      if (!m) return null;
      const h = Number(m[1]);
      const mi = Number(m[2]);
      if (mi > 59 || h > 24 || (h === 24 && mi !== 0)) return null;
      return h * 60 + mi;
    }
    /** 服务端给的 nowMinute 只对「今天」有意义；看往期时不能高亮。 */
    const isToday = () => (viewing ?? data?.date) === data?.date;

    /**
     * 一天的时间线。now 给了就高亮落在 now 上的那一段、并把过去的压暗。
     *
     * `meals` 给了就在对应的段上标出饭点（服务端手上本来就有档位，以前只在顶上写一句话）；
     * `clickable` 为真时点一行会把起止和活动名填进「临时改主意」——以前那儿得手抄时间。
     */
    function timeline(day, now = null, opts = {}) {
      const list = el('div', 'feast-tl');
      const meals = opts.meals ?? [];
      const eatenMin = new Set((opts.eatenAt ?? []).map((at) => {
        // 吃过的那一刻落在哪一档：取档位里最近的、且在她吃之后的。
        const d = new Date(at);
        return d.getHours() * 60 + d.getMinutes();
      }));
      for (const it of day?.items ?? []) {
        const row = el('div', 'feast-tl-row');
        row.appendChild(el('span', 'feast-tl-t', `${it.start}–${it.end}`));
        const mid = el('div', 'feast-tl-n');
        const where = it.scene || it.location;
        mid.appendChild(el('div', 'feast-tl-a', it.activity + (where ? `（${where}）` : '')));
        const bits = [];
        if (it.detail) bits.push(it.detail);
        if (it.outfit) bits.push(`穿着${it.outfit}`);
        if (it.props?.length) bits.push(`手边有${it.props.join('、')}`);
        if (it.with?.length) bits.push(`和${it.with.join('、')}`);
        if (bits.length) mid.appendChild(el('div', 'feast-tl-d', bits.join('；')));
        row.appendChild(mid);

        // 饭点标记：这一段时间里落进了哪一档，就在行尾挂一个小标。
        const s0 = minuteOf(it.start);
        const e0 = minuteOf(it.end);
        if (s0 !== null && e0 !== null) {
          for (const hm of meals) {
            const m = minuteOf(hm);
            if (m === null || m < s0 || m >= e0) continue;
            const did = eatenMin.has(m) || eatenMin.has(m + 1) || eatenMin.has(m - 1)
              || eatenMin.has(m + 2) || eatenMin.has(m - 2);
            row.appendChild(el('span', `feast-meal${did ? ' is-done' : ''}`,
              `${did ? '✓ ' : ''}${t.dayMeal} ${hm}`));
          }
        }

        if (now !== null) {
          const s = minuteOf(it.start);
          const e = minuteOf(it.end);
          if (s !== null && e !== null) {
            if (s <= now && now < e) row.classList.add('is-now');
            else if (e <= now) row.classList.add('is-past');
          }
        }
        if (opts.clickable && it.start && it.end) {
          row.classList.add('is-click');
          row.title = t.dayClickHint;
          row.onclick = () => fillChange(it);
        }
        list.appendChild(row);
      }
      return list;
    }

    /** 点时间线某一段：把起止和活动名填进「临时改主意」，并滚过去。 */
    function fillChange(it) {
      if (!changeInputs) return;
      const { startIn, endIn, actIn } = changeInputs;
      startIn.value = String(it.start ?? '');
      endIn.value = String(it.end ?? '');
      actIn.value = String(it.activity ?? '');
      draftNode = actIn;
      draftNode.value = actIn.value; // 有草稿就别让走表重画把人打断
      toast(root, ctx, t.dayChangePicked(it.start, it.end, it.activity));
      const box = changeInputs.box;
      if (box?.scrollIntoView) {
        try { box.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch { /* 老宿主没有就算了 */ }
      }
      try { actIn.focus(); } catch { /* 同上 */ }
    }

    /** 一天的头：日期、日型、她写的标题与心情、来源。 */
    function dayHead(day, label) {
      const head = el('div', 'feast-day');
      head.appendChild(el('b', null, label));
      head.appendChild(el('span', 'feast-dim', day?.dayType?.name ?? ''));
      if (day?.title) head.appendChild(el('span', null, `——${day.title}`));
      if (day?.mood) head.appendChild(el('span', 'feast-dim', `心情：${day.mood}`));
      const src = sourceLabel(day?.source);
      if (src) head.appendChild(el('span', 'feast-flag', src));
      if (day?.changes?.length) head.appendChild(el('span', 'feast-flag', t.dayChanges(day.changes.length)));
      return head;
    }

    function nowStrip() {
      const box = el('div', 'feast-strip');
      box.appendChild(el('b', null, t.dayNow));
      const it = data?.nowItem;
      if (!data?.enabled) {
        box.appendChild(el('span', 'feast-dim', t.dayOff));
        return box;
      }
      if (!it) {
        box.appendChild(el('span', 'feast-dim', t.dayNothingNow));
      } else if (isSleep(it)) {
        box.appendChild(el('span', null, t.daySleeping));
        box.appendChild(el('span', 'feast-dim', `${it.start}–${it.end}`));
      } else {
        const where = it.scene || it.location;
        box.appendChild(el('span', null, `${it.activity}${where ? `（${where}）` : ''}`));
        box.appendChild(el('span', 'feast-dim', `${it.start}–${it.end}`));
      }
      if (data?.nowHm) box.appendChild(el('span', 'feast-left', t.dayNowAt(data.nowHm)));
      return box;
    }

    /** 一句话的空日程说明，别让面板只剩一片白。 */
    function emptyDay(text) {
      const list = el('div', 'feast-list');
      list.appendChild(el('div', 'feast-empty', text));
      return list;
    }

    function daySection(label, day, now, opts = {}) {
      const box = el('div');
      box.appendChild(dayHead(day, label));
      box.appendChild(day?.items?.length ? timeline(day, now, opts) : emptyDay(t.dayNoDay));
      return box;
    }

    /** 临时改主意的表单：起止时间 + 做什么。点时间线会自动填进来。 */
    function changeForm(date) {
      const box = el('div', 'feast-block');
      box.appendChild(el('div', 'feast-block-t', t.dayChange));
      const form = el('div', 'feast-form');
      const startIn = el('input', 'feast-time');
      startIn.placeholder = '20:00';
      startIn.value = '';
      const endIn = el('input', 'feast-time');
      endIn.placeholder = '21:30';
      endIn.value = '';
      const actIn = el('input', 'feast-activity');
      actIn.placeholder = t.dayChangePh;
      actIn.value = '';
      actIn.addEventListener('input', () => { draftNode = actIn; });
      draftNode = actIn;
      changeInputs = { box, startIn, endIn, actIn };
      const go = el('button', 'feast-btn-primary', t.dayChangeGo);
      form.appendChild(startIn);
      form.appendChild(el('span', 'feast-dim', '–'));
      form.appendChild(endIn);
      form.appendChild(actIn);
      form.appendChild(go);
      box.appendChild(form);
      box.appendChild(el('div', 'feast-note', t.dayChangeHint));

      go.onclick = async () => {
        const start = String(startIn.value ?? '').trim();
        const end = String(endIn.value ?? '').trim();
        const activity = String(actIn.value ?? '').trim();
        go.disabled = true;
        try {
          const r = await ctx.invoke('adjust', [{ date, start, end, activity }]);
          if (r?.ok) {
            toast(root, ctx, r.message ?? t.sayOk);
            await refresh();
          } else {
            toast(root, ctx, r?.message ?? t.sayNo, true);
            go.disabled = false;
          }
        } catch (err) {
          toast(root, ctx, t.failed(err?.message ?? err), true);
          go.disabled = false;
        }
      };
      return box;
    }

    /** 她自己的时间：今天记了几件、下一档几点、她刚做了什么。 */
    function freeSection() {
      const f = data?.free;
      if (!f) return null;
      const box = el('div', 'feast-block');
      box.appendChild(el('div', 'feast-block-t', t.freeTitle));

      const head = el('div', 'feast-day');
      if (!f.enabled) {
        head.appendChild(el('span', 'feast-dim', t.freeOff));
      } else if (f.skipped) {
        head.appendChild(el('span', 'feast-dim', t.freeSkipped));
      } else {
        head.appendChild(el('b', null, f.goal > 0 ? t.freeGoal(f.done.length, f.goal) : t.freeDone(f.done.length)));
        if (f.left === 0) head.appendChild(el('span', 'feast-flag is-owner', t.freeEnough));
        if (f.pendingSlot) head.appendChild(el('span', 'feast-flag', t.freePending(f.pendingSlot)));
        if (f.next) head.appendChild(el('span', 'feast-left', f.next === '没排档' || !f.slots.length ? t.freeNone : t.freeNext(f.next)));
      }
      box.appendChild(head);

      if (f.done.length) {
        const list = el('div', 'feast-list');
        for (const d of f.done) {
          const row = el('div', 'feast-item');
          // 时刻只写本地 HH:MM：服务端给的是毫秒，面板自己截。
          const when = new Date(d.at);
          const hh = String(when.getHours()).padStart(2, '0');
          const mm = String(when.getMinutes()).padStart(2, '0');
          row.appendChild(el('span', 'feast-item-t', `${hh}:${mm}`));
          row.appendChild(el('span', 'feast-item-n', `${d.activity}${d.note ? `——${d.note}` : ''}`));
          list.appendChild(row);
        }
        box.appendChild(list);
      } else if (f.enabled && !f.skipped) {
        box.appendChild(el('div', 'feast-empty', t.freeNotYet));
      }

      // 到点了、但日程说她被占着所以没叫的那几档。不写出来，面板上就只剩「今天没有了」，
      // 用户以为功能坏了（0.7.1 就是这样，实测她一天 13 段里 11 段都被判成"不算"）。
      if (f.skippedSlots?.length) {
        const list = el('div', 'feast-list');
        for (const s of f.skippedSlots) {
          const row = el('div', 'feast-item');
          row.appendChild(el('span', 'feast-item-t', s.slot));
          row.appendChild(el('span', 'feast-item-n', t.freeSkippedSlot(s.doing)));
          list.appendChild(row);
        }
        box.appendChild(list);
      }
      // 面板上替她开口：0.7.1 只有一个「今天不叫了」是工具，主人点不到。
      if (f.enabled && !f.skipped) {
        const acts = el('div', 'feast-act');
        const skip = el('button', null, t.freeSkipToday);
        skip.onclick = async () => {
          skip.disabled = true;
          try {
            const r = await ctx.invoke('freeSkip', []);
            if (r?.ok) toast(root, ctx, r.message ?? t.freeSkipDone);
            else toast(root, ctx, r?.message ?? t.sayNo, true);
          } catch (err) {
            toast(root, ctx, t.failed(err?.message ?? err), true);
          } finally {
            await refresh();
          }
        };
        const start = el('button', null, t.freeStart);
        start.onclick = async () => {
          start.disabled = true;
          try {
            const r = await ctx.invoke('freeStart', []);
            if (r?.ok) toast(root, ctx, r.message ?? t.freeStartDone);
            else toast(root, ctx, r?.message ?? t.sayNo, true);
          } catch (err) {
            toast(root, ctx, t.failed(err?.message ?? err), true);
          } finally {
            start.disabled = false;
            await refresh();
          }
        };
        acts.appendChild(start);
        acts.appendChild(skip);
        box.appendChild(acts);
      }

      box.appendChild(el('div', 'feast-note', t.freeHint));
      return box;
    }

    function pastSection() {
      const box = el('div');
      box.appendChild(el('div', 'feast-combo-h', t.dayPast));
      const days = (data?.recent ?? []).filter((d) => d.date !== data?.date);
      if (!days.length) {
        box.appendChild(el('div', 'feast-empty', t.dayNoPast));
        return box;
      }
      const list = el('div', 'feast-list');
      for (const d of days) {
        const row = el('div', 'feast-item is-click');
        const [, mo, dd] = String(d.date ?? '').split('-');
        row.appendChild(el('span', 'feast-item-t', mo && dd ? `${Number(mo)}/${Number(dd)}` : d.date));
        row.appendChild(el('span', 'feast-item-n',
          `${d.dayType || ''}${d.title ? ` · ${d.title}` : ''}`));
        const src = sourceLabel(d.source);
        if (src) row.appendChild(el('span', 'feast-flag', src));
        row.appendChild(el('span', 'feast-item-t', t.dayCount(d.count ?? 0)));
        row.onclick = async () => {
          viewing = d.date;
          await openDay(d.date);
        };
        list.appendChild(row);
      }
      box.appendChild(list);
      return box;
    }

    /** 看某一天（往期用）：单独拉一次 day，不重画整页。 */
    async function openDay(date) {
      try {
        const r = await ctx.invoke('day', [date]);
        if (!r?.ok) {
          toast(root, ctx, r?.message ?? t.sayNo, true);
          viewing = null;
          render();
          return;
        }
        let seen = wrap.querySelector('.feast-seen');
        if (!seen) {
          seen = el('div', 'feast-seen');
          wrap.prepend(seen);
        }
        seen.replaceChildren();
        const back = el('button', null, t.dayBack);
        back.onclick = () => { viewing = null; render(); };
        seen.appendChild(back);
        seen.appendChild(daySection(date, r.day, null));
      } catch (err) {
        toast(root, ctx, t.failed(err?.message ?? err), true);
        viewing = null;
        render();
      }
    }

    function render() {
      const scrollTop = wrap.scrollTop;
      draftNode = null;
      changeInputs = null;
      wrap.replaceChildren();

      if (!data) return;

      if (!data.enabled) {
        wrap.appendChild(el('div', 'feast-empty', t.dayOff));
        return;
      }

      wrap.appendChild(nowStrip());

      // 今天：只有看今天时才给 nowMinute 高亮。点任意一段能填进下面的改主意表单。
      const canChangeToday = Boolean(data.today?.items?.length) && data.today.source !== 'pending';
      wrap.appendChild(daySection(t.dayToday, data.today, isToday() && !viewing ? data.nowMinute : null, {
        meals: data.mealSlots ?? [],
        eatenAt: (data.eatenToday ?? []).map((e) => e.at),
        clickable: canChangeToday && !viewing,
      }));

      // 明天：来源是 pending 就说明已经问过她、还没交回。
      wrap.appendChild(daySection(t.dayTomorrow, data.tomorrow, null));

      // 按钮跟着明天的状态走：没写 = 请她写；等她写 = 灰掉；已经写好 = 重写（要确认）。
      // 0.7.1 无脑渲染「请她写明天」，而服务端会无条件覆盖——点一下就抹掉她写好的明天。
      const tomorrowState = (data.tomorrow?.items?.length ?? 0) > 0
        ? (data.tomorrow.source === 'pending' ? 'pending' : 'written')
        : 'empty';

      const acts = el('div', 'feast-act');
      if (tomorrowState === 'pending') {
        const ask = el('button', null, t.dayAsking);
        ask.disabled = true;
        acts.appendChild(ask);
        acts.appendChild(el('span', 'feast-dim', t.dayWaiting));
      } else {
        const rewrite = tomorrowState === 'written';
        const ask = el('button', rewrite ? null : 'feast-btn-primary',
          asking ? t.dayAsking : (rewrite ? t.dayAskAgain : t.dayAsk));
        ask.disabled = asking;
        ask.onclick = async () => {
          if (rewrite && !window.confirm(t.dayRewriteConfirm)) return;
          asking = true;
          render();
          try {
            const r = await ctx.invoke('plan', []);
            if (r?.ok) toast(root, ctx, r.message ?? t.dayAsking);
            else toast(root, ctx, r?.message ?? t.sayNo, true);
          } catch (err) {
            toast(root, ctx, t.failed(err?.message ?? err), true);
          } finally {
            asking = false;
            await refresh();
          }
        };
        acts.appendChild(ask);
        if (rewrite) acts.appendChild(el('span', 'feast-dim', t.dayAskAgainHint));
      }
      wrap.appendChild(acts);

      // 改主意只对已经排好的一天有意义；pick 是「等她写」的空壳，改了也没东西可截。
      if (canChangeToday) {
        wrap.appendChild(changeForm(data.date));
      }

      const free = freeSection();
      if (free) wrap.appendChild(free);

      wrap.appendChild(pastSection());
      wrap.scrollTop = scrollTop;
    }

    async function refresh() {
      try {
        data = await ctx.invoke('list', []);
        render();
      } catch (err) {
        wrap.replaceChildren(el('div', 'feast-empty is-bad', t.failed(err?.message ?? err)));
      }
    }

    try {
      data = await ctx.invoke('list', []);
      render();
    } catch (err) {
      wrap.replaceChildren(el('div', 'feast-empty is-bad', t.failed(err?.message ?? err)));
      return { dispose() {} };
    }

    // 钟自己走：整点过后换一段了，「此刻」那个条该跟上（每 60 秒让服务端重算一遍）。
    // 只在「此刻那一段」或「日期」真的变了才重画 —— 否则会把正在填的改主意表单打断。
    let lastKey = `${data?.nowItem?.start ?? ''}|${data?.date ?? ''}`;
    const ticker = ctx.interval?.(() => {
      if (ctx.signal?.aborted) return;
      void (async () => {
        try {
          const next = await ctx.invoke('list', []);
          const key = `${next?.nowItem?.start ?? ''}|${next?.date ?? ''}`;
          // 看往期、或者表单里有没提交的草稿时，别擅自重画把人打断了。
          if (key === lastKey || viewing || hasDraft()) {
            data = next;
            return;
          }
          data = next;
          lastKey = key;
          render();
        } catch { /* 这一拍没拉到就算了，下一拍再来 */ }
      })();
    }, 60_000);

    return {
      dispose() {
        ticker?.dispose?.();
      },
    };
  },
};

// ---------------------------------------------------------------------------
// 套餐面板
// ---------------------------------------------------------------------------

/**
 * 一桌一桌地端。
 *
 * 分两半：上面是现成的套餐（预设 + 你攒的），下面是攒新的一桌。
 * 预设是「槽位现配」，每次配出来可能不一样，所以每张卡都带「看这一桌」——
 * 端之前得看得到具体是哪几道。
 */
const comboPanel = {
  async mount(ctx) {
    const t = tableFor(ctx.language);
    const root = ctx.root;
    root.classList.add('feast');
    const style = el('style');
    style.textContent = CSS;
    root.appendChild(style);

    const wrap = el('div');
    root.appendChild(wrap);

    /** 攒桌区：已勾的 id（顺序就是上桌顺序）。 */
    const picked = new Map();
    /** 正在改的是哪一桌（null = 新建）。 */
    let editing = null;
    /** 攒桌区的筛选 + 搜索。 */
    const build = { filter: {}, q: '' };
    /** 面板数据（一次性拉全库，攒桌区本地筛，省得每勾一下都重拉）。 */
    let data = null;
    /** 每套预设当前的配菜种子：预览和"端过去"必须用同一颗。 */
    const seeds = new Map();
    let pendingBox = null;
    /** 删除要按两次，防手滑。 */
    let confirmId = null;

    function remainMin(p) {
      const ttl = Number(p?.ttlMin) || 30;
      const at = Number(p?.at) || 0;
      const leftMs = at + ttl * 60_000 - Date.now();
      return leftMs <= 0 ? 0 : Math.ceil(leftMs / 60_000);
    }

    /** 一颗新种子。预览和端都用它，所以"看到的就是端过去的"。 */
    function newSeed(id) {
      return `${id}|${Date.now().toString(36)}`;
    }

    function seedFor(id) {
      if (!seeds.has(id)) seeds.set(id, newSeed(id));
      return seeds.get(id);
    }

    /**
     * 拉一次数据，**并且先把每张卡的种子补好**。
     *
     * 陷阱：种子必须在这张卡被画出来之前就存在。如果只在挂载时 list 一次、
     * 等用户点「端这一桌」才现生成种子，那颗种子和卡上列出来的菜不是同一桌
     * ——预览 ≠ 端过去。所以走两段式：
     *   ① `resolve: false` 只拿卡（id 是固定的，不现配菜名）
     *   ② 给每张卡补 seedFor(id)（顺序在画卡之前）
     *   ③ 带整张种子表再 list 一次，这才画卡
     * 存 / 删 / 端之后也走它：新出现的卡（刚存的桌）同样先补种子再画。
     */
    async function refresh() {
      const bare = await ctx.invoke('list', [{ resolve: false }]);
      const cards = [...(bare.presets ?? []), ...(bare.custom ?? [])];
      const live = new Set(cards.map((c) => c.id));
      for (const id of [...seeds.keys()]) if (!live.has(id)) seeds.delete(id);
      for (const c of cards) seedFor(c.id);
      data = await ctx.invoke('list', [{ seeds: Object.fromEntries(seeds) }]);
      return data;
    }

    // ---- 等待条 ----------------------------------------------------------

    function pendingStrip(p) {
      const strip = el('div', 'feast-strip');
      const isTable = p.isTable || (p.total ?? 1) > 1;
      const title = isTable
        ? `${t.comboTable}${p.tableName ? ` · ${p.tableName}` : ''}`
        : p.name;
      strip.appendChild(el('b', null, `🍽 ${title}`));
      if (isTable) {
        const n = Number(p.remaining ?? p.left?.length ?? 0);
        const total = Number(p.total ?? n);
        strip.appendChild(el('span', 'feast-dim', t.comboLeft(n, total)));
        if (p.left?.length) {
          strip.appendChild(el('span', 'feast-dim', p.left.join('、')));
        }
      } else {
        strip.appendChild(el('span', 'feast-dim', `${t.pending} · ${t.pendingHint}`));
      }
      const left = el('span', 'feast-left', t.pendingLeft(remainMin(p)));
      strip.appendChild(left);
      pendingBox = { el: left, p };
      return strip;
    }

    // ---- 一张套餐卡 ------------------------------------------------------

    function setCard(c, isCustom) {
      const card = el('div', 'feast-set');
      if (data?.pending?.comboId && data.pending.comboId === c.id) card.className += ' is-cur';

      const h = el('div', 'feast-set-h');
      h.appendChild(el('span', 'feast-set-n', c.name));
      const meta = [t_n(c.size), c.line].filter(Boolean).join(' · ');
      h.appendChild(el('span', 'feast-set-m', meta));
      card.appendChild(h);

      if (c.desc) card.appendChild(el('div', 'feast-set-d', c.desc));

      // 现配出来的具体菜名：预设每次可能不一样，端之前得看得见。
      if (c.dishes?.length) {
        const row = el('div', 'feast-set-dishes');
        for (const d of c.dishes) row.appendChild(el('span', null, d.name));
        card.appendChild(row);
      } else if (c.missing?.length) {
        card.appendChild(el('div', 'feast-miss', t.comboMissing(c.missing.join('；'))));
      }

      const acts = el('div', 'feast-set-acts');

      const preview = el('button', null, t.comboPick);
      preview.onclick = async () => {
        preview.disabled = true;
        preview.textContent = t.comboPicking;
        try {
          // 换一颗种子重新现配，然后把结果就地画进这张卡；端的时候用的还是这一颗。
          seeds.set(c.id, newSeed(c.id));
          applyList(await refresh());
        } catch (err) {
          toast(root, ctx, t.failed(err?.message ?? err), true);
        } finally {
          preview.disabled = false;
          preview.textContent = t.comboPick;
        }
      };
      acts.appendChild(preview);

      const serve = el('button', 'feast-btn-primary', t.comboServe);
      serve.onclick = async () => {
        serve.disabled = true;
        try {
          const r = await ctx.invoke('serve', [{ id: c.id, seed: seedFor(c.id) }]);
          if (r?.ok) {
            toast(root, ctx, t.served(`${c.name}（${r.dishes?.length ?? c.size}）`));
            applyList(await refresh());
          } else {
            toast(root, ctx, r?.message ?? t.sayNo, true);
            serve.disabled = false;
          }
        } catch (err) {
          toast(root, ctx, t.failed(err?.message ?? err), true);
          serve.disabled = false;
        }
      };
      acts.appendChild(serve);

      if (isCustom) {
        const edit = el('button', null, t.comboEdit);
        edit.onclick = () => {
          editing = c.id;
          picked.clear();
          for (const id of c.picked ?? (c.dishes ?? []).map((d) => d.id)) picked.set(id, true);
          nameInput.value = c.name;
          render();
        };
        acts.appendChild(edit);

        const del = el('button', null, confirmId === c.id ? t.comboConfirmRemove : t.comboRemove);
        del.onclick = async () => {
          if (confirmId !== c.id) { confirmId = c.id; render(); return; }
          confirmId = null;
          try {
            const r = await ctx.invoke('remove', [c.id]);
            if (r?.ok) {
              toast(root, ctx, r.message ?? t.sayOk);
              applyList(await refresh());
            } else {
              toast(root, ctx, r?.message ?? t.sayNo, true);
            }
          } catch (err) {
            toast(root, ctx, t.failed(err?.message ?? err), true);
          }
        };
        acts.appendChild(del);
      }
      card.appendChild(acts);
      return card;
    }

    /** `t_n`：把"几道"说得短一点，卡片标题里用。 */
    const t_n = (n) => `${n} 道`;

    // ---- 攒桌区 ----------------------------------------------------------

    const nameInput = el('input');
    nameInput.className = 'feast-search';
    nameInput.placeholder = t.comboNamePh;

    const searchInput = el('input');
    searchInput.className = 'feast-search';
    searchInput.placeholder = t.search;
    searchInput.value = build.q;
    searchInput.oninput = (e) => {
      // 组词中不重画：input 会被摘下再挂回，组了一半的词当场散掉。
      if (e.isComposing) return;
      build.q = String(searchInput.value ?? '').trim();
      render();
    };
    searchInput.addEventListener('compositionend', () => {
      build.q = String(searchInput.value ?? '').trim();
      render();
    });

    function buildZone() {
      const box = el('div', 'feast-build');
      box.appendChild(el('div', 'feast-block-t', editing ? `${t.comboEdit} · ${t.comboBuild}` : t.comboBuild));

      const bar = el('div', 'feast-build-bar');
      // 类别下拉：只给真有的类别。
      const catSel = el('select');
      catSel.appendChild(option(t.allCats, ''));
      for (const c of data?.categories ?? []) catSel.appendChild(option(c, c));
      catSel.value = build.filter.category ?? '';
      catSel.onchange = () => {
        build.filter.category = catSel.value || undefined;
        // 换类别时清掉对不上的菜系，否则会筛出空结果。
        const ok = data?.categoryCuisines?.[catSel.value] ?? [];
        if (build.filter.cuisine && !ok.includes(build.filter.cuisine)) build.filter.cuisine = undefined;
        render();
      };
      bar.appendChild(catSel);

      const cuiSel = el('select');
      cuiSel.appendChild(option(t.allCuisines, ''));
      const cuisines = build.filter.category
        ? (data?.categoryCuisines?.[build.filter.category] ?? [])
        : (data?.cuisines ?? []);
      for (const c of cuisines) cuiSel.appendChild(option(c, c));
      cuiSel.value = build.filter.cuisine ?? '';
      cuiSel.onchange = () => { build.filter.cuisine = cuiSel.value || undefined; render(); };
      bar.appendChild(cuiSel);

      bar.appendChild(searchInput);
      box.appendChild(bar);

      // 勾选区：本地筛全库，一次画完（库 701 道，滚动区里够用）。
      const q = build.q;
      const list = (data?.items ?? []).filter((d) => {
        if (build.filter.category && d.category !== build.filter.category) return false;
        if (build.filter.cuisine && d.cuisine !== build.filter.cuisine) return false;
        if (q && !(d.name.includes(q) || d.cuisine.includes(q) || d.region.includes(q)
          || (d.keywords ?? []).some((k) => k.includes(q)))) return false;
        return true;
      });
      const grid = el('div', 'feast-pick');
      for (const d of list) {
        const on = picked.has(d.id);
        const chip = el('button', `feast-chip${on ? ' is-on' : ''}`);
        chip.appendChild(el('span', 'feast-chip-n', `${on ? '✓ ' : ''}${d.name}`));
        chip.appendChild(el('span', 'feast-chip-m', `${d.cuisine}·${d.category}`));
        chip.onclick = () => {
          if (picked.has(d.id)) picked.delete(d.id);
          else if (picked.size >= (data?.max ?? 12)) {
            toast(root, ctx, `一桌最多 ${data?.max ?? 12} 道。`, true);
            return;
          } else picked.set(d.id, true);
          render();
        };
        grid.appendChild(chip);
      }
      if (!list.length) grid.appendChild(el('div', 'feast-empty', t.empty));
      box.appendChild(grid);

      box.appendChild(el('div', 'feast-count', t.comboPicked(picked.size, data?.max ?? 12)));
      box.appendChild(nameInput);

      const acts = el('div', 'feast-set-acts');
      const save = el('button', 'feast-btn-primary', editing ? t.comboEdit : t.comboBuild);
      save.onclick = async () => {
        save.disabled = true;
        save.textContent = t.comboSaving;
        try {
          const payload = { name: String(nameInput.value ?? '').trim(), dishes: [...picked.keys()] };
          if (editing) payload.id = editing;
          const r = await ctx.invoke('save', [payload]);
          if (r?.ok) {
            toast(root, ctx, r.message ?? t.sayOk);
            editing = null;
            picked.clear();
            nameInput.value = '';
            applyList(await refresh());
          } else {
            toast(root, ctx, r?.message ?? t.sayNo, true);
            save.disabled = false;
            save.textContent = editing ? t.comboEdit : t.comboBuild;
          }
        } catch (err) {
          toast(root, ctx, t.failed(err?.message ?? err), true);
          save.disabled = false;
          save.textContent = editing ? t.comboEdit : t.comboBuild;
        }
      };
      acts.appendChild(save);

      // 勾了就能直接端，不用先存。
      const serveNow = el('button', null, t.comboServe);
      serveNow.onclick = async () => {
        if (!picked.size) { toast(root, ctx, t.comboNoDish, true); return; }
        serveNow.disabled = true;
        try {
          // 直接把勾好的那几道端过去——不走"先存再端"，
          // 那样会把临时桌留在列表里，而且端过去的可能跟勾的不一样。
          const r = await ctx.invoke('serve', [{
            dishes: [...picked.keys()],
            name: String(nameInput.value ?? '').trim() || undefined,
          }]);
          if (r?.ok) {
            toast(root, ctx, t.served(`${r.combo?.name ?? t.comboTable}（${r.dishes?.length ?? picked.size}）`));
            editing = null;
            picked.clear();
            nameInput.value = '';
            applyList(await refresh());
          } else {
            toast(root, ctx, r?.message ?? t.sayNo, true);
            serveNow.disabled = false;
          }
        } catch (err) {
          toast(root, ctx, t.failed(err?.message ?? err), true);
          serveNow.disabled = false;
        }
      };
      acts.appendChild(serveNow);

      if (editing) {
        const cancel = el('button', null, t.sayCancel);
        cancel.onclick = () => { editing = null; picked.clear(); nameInput.value = ''; render(); };
        acts.appendChild(cancel);
      }
      box.appendChild(acts);
      box.appendChild(el('div', 'feast-set-d', t.comboHint));
      return box;
    }

    // ---- 绘制 ------------------------------------------------------------

    function applyList(d) {
      data = { ...data, ...d };
      // items 只在攒桌时需要；list 已经给了全库，直接用。
      render();
    }

    function render() {
      const scrollTop = wrap.scrollTop;
      // .feast-pick 自己是滚动容器：只救外层 wrap 的话，点靠下的 chip 会跳回列表顶。
      const pick = wrap.querySelector('.feast-pick');
      const pickScroll = pick ? pick.scrollTop : null;
      // 攒桌区的搜索框和名字框是常驻节点（每次重画重新挂回同一颗）：摘下再挂回会丢
      // 焦点和光标，存的是节点本身，重画完放回去。
      const a = document.activeElement;
      const focusNode = (a === searchInput || a === nameInput) ? a : null;
      const focusSel = focusNode ? { start: focusNode.selectionStart, end: focusNode.selectionEnd } : null;
      wrap.replaceChildren();

      if (data?.pending) wrap.appendChild(pendingStrip(data.pending));

      wrap.appendChild(el('div', 'feast-combo-h', t.comboPresets));
      if (data?.presets?.length) {
        for (const c of data.presets) wrap.appendChild(setCard(c, false));
      } else {
        wrap.appendChild(el('div', 'feast-empty', t.comboEmpty));
      }

      wrap.appendChild(el('div', 'feast-combo-h', t.comboCustom));
      if (data?.custom?.length) {
        for (const c of data.custom) wrap.appendChild(setCard(c, true));
      } else {
        wrap.appendChild(el('div', 'feast-empty', t.comboNone));
      }

      wrap.appendChild(el('div', 'feast-combo-h', t.comboBuild));
      wrap.appendChild(buildZone());
      wrap.scrollTop = scrollTop;
      const nextPick = wrap.querySelector('.feast-pick');
      if (nextPick && typeof pickScroll === 'number') nextPick.scrollTop = pickScroll;
      if (focusNode) {
        focusNode.focus();
        if (typeof focusSel?.start === 'number') {
          try { focusNode.setSelectionRange(focusSel.start, focusSel.end); } catch { /* 光标超界就算了 */ }
        }
      }
    }

    // ---- 启动 ------------------------------------------------------------

    async function load() {
      wrap.replaceChildren(el('div', 'feast-empty', t.loading));
      try {
        // 一次拿全量：套餐 + 整库（攒桌区要按名字搜全库），种子在画卡之前补好。
        await refresh();
        render();
      } catch (err) {
        wrap.replaceChildren(el('div', 'feast-empty is-bad', t.failed(err?.message ?? err)));
      }
    }

    await load();

    // 等待条自己走表：到点变成"已经收走了"，不靠重开面板。
    ctx.interval(() => {
      if (!pendingBox) return;
      const left = remainMin(pendingBox.p);
      if (left <= 0) {
        pendingBox.el.textContent = t.pendingGone;
        pendingBox = null;
        return;
      }
      pendingBox.el.textContent = t.pendingLeft(left);
    }, 20_000);

    return { dispose() {} };
  },
};

export default { panels: { menu: menuPanel, combo: comboPanel, history: historyPanel, today: todayPanel } };
