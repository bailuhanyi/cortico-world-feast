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
 * 颜色全部走宿主主题的自定义属性（--surface/--foreground/--border/--accent…），
 * 自定义属性会继承进 shadow root，所以明暗两套主题都不用自己写。
 *
 * 两个面板：
 *   menu    —— 翻菜单、看九维口味和实吃描写、点「端给她」
 *   history —— 她吃过什么、攒出来的口味画像
 */

const CSS = `
.feast{--fe-line:var(--border,#e3e4e3);--fe-ink:var(--foreground,#1b1a1e);--fe-dim:var(--muted-foreground,#5c5c60);--fe-card:var(--surface,#fbfbfb);--fe-accent:var(--accent,#00a870);font:13px/1.6 var(--sans,-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif);color:var(--fe-ink);padding:4px 2px 24px}
.feast *{box-sizing:border-box}
.feast-bar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px}
.feast input,.feast select,.feast button{font:inherit;color:inherit;background:var(--fe-card);border:1px solid var(--fe-line);border-radius:var(--radius-sm,6px);padding:5px 9px;outline:none}
.feast input:focus,.feast select:focus{border-color:var(--fe-accent)}
.feast-search{flex:1;min-width:150px}
.feast button{cursor:pointer;transition:background .12s,border-color .12s}
.feast button:hover{border-color:var(--fe-accent)}
.feast-btn-primary{background:var(--fe-accent);border-color:var(--fe-accent);color:var(--on-accent,#fff);font-weight:600}
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
.feast-card-n{font-weight:600;font-size:14px}
.feast-card-m{color:var(--fe-dim);font-size:11.5px}
.feast-card-s{color:var(--fe-dim);font-size:12px;line-height:1.5;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.feast-tags{display:flex;gap:5px;flex-wrap:wrap;margin-top:2px}
.feast-tag{font-size:11px;padding:1px 6px;border-radius:999px;border:1px solid var(--fe-line);color:var(--fe-dim)}
.feast-once{font-size:11px;color:var(--fe-accent);border:1px solid var(--fe-accent);border-radius:999px;padding:1px 6px;white-space:nowrap}
.feast-detail{display:flex;flex-direction:column;gap:12px;max-width:760px}
.feast-detail-h{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap}
.feast-detail-n{font-size:19px;font-weight:600;line-height:1.3}
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
.feast-set-n{font-weight:600;font-size:14px}
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
    comboPack: '收起',
    comboHint: '点菜卡选或取消；选好了存下来，下次直接端。',
    comboTable: '这一桌',
    comboLeft: (n, t) => `还剩 ${n} / ${t} 道`,
    comboDone: '这一桌吃完了',
    comboMissing: (s) => `少配了：${s}`,
    comboNoDish: '这一桌一道菜都选上',
    comboReuse: (n) => `再端一次「${n}」`,
    comboSizeLabel: '来一桌配几道',
    comboAdhoc: '随便配一桌',
    comboSeedHint: '看到的这几道就是会端过去的那几道。',
    /* --- 一起吃饭（菜单面板顶部那条） --- */
    togetherTitle: '一起吃饭',
    togetherNow: (min) => `正一起吃${min ? ` · ${min} 分钟了` : ''}`,
    togetherStartedByOwner: '起头的是主人',
    togetherStartedByHer: '起头的是她',
    togetherInvite: '🍽 一起吃',
    togetherHerAsk: (m) => `🍽 她说想和你一起吃饭（还剩约 ${m} 分钟）`,
    togetherHerAskDone: '🍽 她说想和你一起吃饭',
    togetherAccept: '好，一起吃',
    togetherDecline: '今天不了',
    togetherEnd: '散桌',
    togetherOwnerAte: '主人也在吃',
    togetherNoDish: '库里没有这道',
    togetherBites: (n) => `喂过 ${n} 口`,
    togetherBack: (n) => `她分了你一口 ${n}`,
    togetherBackOk: '接过来',
    togetherBackNo: '下次吧',
    togetherBackYes: '接过去了',
    togetherBackNoDone: '这次没要',
    togetherTakePh: '我在吃…（一句话就行）',
    togetherTake: '记下来',
    togetherTakeThis: '我也吃这道',
    togetherLastEnd: (why) => `刚才那顿：${why}`,
    togetherEndWhyFinished: '她那份吃完了',
    togetherEndWhyOwner: '主人说散了',
    togetherEndWhyTtl: '放太久了，收了',
    togetherEndWhyHer: '她先收了',
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
    comboPack: 'Collapse',
    comboHint: 'Tap cards to pick or unpick; save the table and serve it later.',
    comboTable: 'This table',
    comboLeft: (n, t) => `${n} of ${t} left`,
    comboDone: 'this table is finished',
    comboMissing: (s) => `Missing: ${s}`,
    comboNoDish: 'Pick at least one dish',
    comboReuse: (n) => `Serve “${n}” again`,
    comboSizeLabel: 'Dishes per table',
    comboAdhoc: 'Just pick a table',
    comboSeedHint: 'What you see is what gets served.',
    /* --- eating together (the bar at the top of the menu panel) --- */
    togetherTitle: 'Eating together',
    togetherNow: (min) => `Eating together${min ? ` · ${min} min in` : ''}`,
    togetherStartedByOwner: 'you started it',
    togetherStartedByHer: 'she started it',
    togetherInvite: '🍽 Eat together',
    togetherHerAsk: (m) => `🍽 She asked you to eat together (about ${m} min left)`,
    togetherHerAskDone: '🍽 She asked you to eat together',
    togetherAccept: 'Okay, let’s eat',
    togetherDecline: 'Not today',
    togetherEnd: 'Clear the table',
    togetherOwnerAte: 'you are eating',
    togetherNoDish: 'not in the library',
    togetherBites: (n) => `${n} bites fed`,
    togetherBack: (n) => `She offered you a bite of ${n}`,
    togetherBackOk: 'Take it',
    togetherBackNo: 'Next time',
    togetherBackYes: 'taken',
    togetherBackNoDone: 'declined',
    togetherTakePh: 'I am eating… (one line is enough)',
    togetherTake: 'Note it',
    togetherTakeThis: 'I’m having this too',
    togetherLastEnd: (why) => `Last meal: ${why}`,
    togetherEndWhyFinished: 'her share was finished',
    togetherEndWhyOwner: 'you called it',
    togetherEndWhyTtl: 'it sat too long',
    togetherEndWhyHer: 'she closed it',
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
    /** 等待条右边那个"还剩多久"的节点，随钟走。 */
    let pendingBox = null;
    /** 会话条里要随钟走的那几个节点。 */
    let togetherBox = null;
    const wrap = el('div');
    root.appendChild(wrap);

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
        if (r?.ok === false) toast(root, ctx, r?.message ?? '不行', true);
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
        bar.appendChild(note);
        const say = el('button', null, t.togetherTake);
        say.onclick = () => void act('take', [{ note: String(note.value ?? '').trim() }]);
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
      const ask = el('button', null, t.togetherInvite);
      ask.onclick = () => void act('invite');
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
      wrap.replaceChildren(el('div', 'feast-empty', t.loading));
      let data;
      try {
        data = await ctx.invoke('list', [{ ...state.filter }]);
      } catch (err) {
        wrap.replaceChildren(el('div', 'feast-empty is-bad', t.failed(err?.message ?? err)));
        return;
      }      state.cuisines = data.cuisines ?? [];
      state.categories = data.categories ?? [];
      state.categoryCuisines = data.categoryCuisines ?? {};
      // 每次重拉都跟着服务端走：端来的菜可能是在别处端的，也可能已经被吃掉/过期收走。
      state.pending = data.pending ?? null;
      // 一起吃饭同理：她那边挂了邀请、分了主人一口，都只有服务端知道。
      state.together = data.together ?? null;
      // 会话条自己走表时要重画，而重画要的那份数据得留着。
      state.last = data;
      render(data);
    }

    function render(data) {
      wrap.replaceChildren();
      pendingBox = null;
      togetherBox = null;

      // 一起吃饭（会话条）放在工具条下面、等待条上面：
      // "我们一起吃" 比 "我端了东西给你" 更贴顶，两者同时存在时也读得通。
      if (state.together) wrap.appendChild(togetherBar(state.together));

      // 工具条
      const bar = el('div', 'feast-bar');
      const search = el('input', 'feast-search');
      search.type = 'search';
      search.placeholder = t.search;
      search.value = state.filter.query ?? '';
      let timer = null;
      search.oninput = () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          state.filter.query = String(search.value ?? '').trim();
          void load();
        }, 260);
      };
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

      // 端过来还没吃的那道：右侧写着还剩多久，自己会走。
      if (state.pending) {
        const p = state.pending;
        const strip = el('div', 'feast-strip');
        strip.appendChild(el('b', null, `🍽 ${p.name}`));
        strip.appendChild(el('span', 'feast-dim', `${t.pending} · ${t.pendingHint}`));
        const left = el('span', 'feast-left', t.pendingLeft(remainMin(p)));
        strip.appendChild(left);
        pendingBox = { el: left, p };
        wrap.appendChild(strip);
      }

      wrap.appendChild(el('div', 'feast-count', data.matched < data.total
        ? t.matched(data.matched, data.total)
        : t.all(data.total)));

      if (!data.items?.length) {
        wrap.appendChild(el('div', 'feast-empty', t.empty));
        return;
      }

      const grid = el('div', 'feast-grid');
      for (const d of data.items) {
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
            toast(root, ctx, r?.message ?? '不行', true);
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
      // 正一起吃的时候，才谈得上"我也吃这道"——不在席上没这个上下文。
      if (state.together?.active) {
        const mine = el('button', null, t.togetherTakeThis);
        mine.onclick = async () => {
          mine.disabled = true;
          try {
            const r = await ctx.invoke('take', [{ id: d.id }]);
            if (r?.ok) {
              state.together = r.together ?? state.together;
              toast(root, ctx, r.message ?? '记下了');
              mine.disabled = false;
            } else {
              toast(root, ctx, r?.message ?? '不行', true);
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
    for (const [k, v] of [[t.statTotal, data.total], [t.statToday, data.today], [t.statKnown, data.top?.length ?? 0]]) {
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
            toast(root, ctx, r?.message ?? '不行', true);
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
              toast(root, ctx, r.message ?? '删掉了。');
              applyList(await refresh());
            } else {
              toast(root, ctx, r?.message ?? '删不掉', true);
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
    searchInput.oninput = () => { build.q = String(searchInput.value ?? '').trim(); render(); };

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
            toast(root, ctx, r.message ?? '存下来了');
            editing = null;
            picked.clear();
            nameInput.value = '';
            applyList(await refresh());
          } else {
            toast(root, ctx, r?.message ?? '存不下来', true);
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
            toast(root, ctx, r?.message ?? '不行', true);
            serveNow.disabled = false;
          }
        } catch (err) {
          toast(root, ctx, t.failed(err?.message ?? err), true);
          serveNow.disabled = false;
        }
      };
      acts.appendChild(serveNow);

      if (editing) {
        const cancel = el('button', null, '取消');
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

export default { panels: { menu: menuPanel, combo: comboPanel, history: historyPanel } };
