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
    like: '好吃',
    dislike: '不对付',
    ok: '一般',
    empty: '没有符合条件的菜。',
    loading: '翻菜单…',
    failed: (e) => `取不到数据：${e}`,
    served: (n) => `端过去了：${n}`,
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
    like: 'liked',
    dislike: 'missed',
    ok: 'ok',
    empty: 'Nothing matches.',
    loading: 'Loading…',
    failed: (e) => `Failed to load: ${e}`,
    served: (n) => `Served: ${n}`,
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

    const state = { filter: {}, cuisines: [], categories: [], detail: null, pending: null };
    const wrap = el('div');
    root.appendChild(wrap);

    async function load() {
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
      state.pending = data.pending ?? null;
      render(data);
    }

    function render(data) {
      wrap.replaceChildren();

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
          state.filter.query = search.value.trim();
          void load();
        }, 260);
      };
      bar.appendChild(search);

      const cuisine = el('select');
      cuisine.appendChild(option(t.allCuisines, ''));
      for (const c of state.cuisines) cuisine.appendChild(option(c, c));
      cuisine.value = state.filter.cuisine ?? '';
      cuisine.onchange = () => {
        state.filter.cuisine = cuisine.value;
        void load();
      };
      bar.appendChild(cuisine);

      const cat = el('select');
      cat.appendChild(option(t.allCats, ''));
      for (const c of state.categories) cat.appendChild(option(c, c));
      cat.value = state.filter.category ?? '';
      cat.onchange = () => {
        state.filter.category = cat.value;
        void load();
      };
      bar.appendChild(cat);

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

      // 端过来还没吃的那道
      if (state.pending) {
        const strip = el('div', 'feast-strip');
        const b = el('b', null, `🍽 ${state.pending.name}`);
        strip.appendChild(b);
        strip.appendChild(el('span', 'feast-dim', `${t.pending} · ${t.pendingHint}`));
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
      state.pending = data.pending ?? state.pending;
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
    return { dispose() {} };
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
        if (e.by === 'owner') row.appendChild(el('span', 'feast-flag is-owner', t.owner));
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

export default { panels: { menu: menuPanel, history: historyPanel } };
