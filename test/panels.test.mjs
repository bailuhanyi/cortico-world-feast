/**
 * 面板的冒烟测试。
 *
 * dist/webui.js 只在 Coo 里跑，测试里跑不到——最容易藏错误的地方。
 * 这里用一个够用的极简 DOM 桩（createElement / appendChild / replaceChildren /
 * classList / textContent / querySelector）把两个面板都真挂一遍，喂真实数据面，
 * 断言：往 ctx.root 里写了东西、点了「端给她」会调 feed、点菜会调 dish、失败时有错误卡。
 */
import assert from 'node:assert/strict';
import { test, report } from './harness.mjs';
import { FeastWorld } from '../src/world.js';
import { loadDishes } from '../src/dishes.js';
import { DEFAULTS } from '../src/config.js';

const lib = await loadDishes();

// --------------------------------------------------------------------------
// 极简 DOM
// --------------------------------------------------------------------------

class Node {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.childNodes = [];
    this.className = '';
    this._text = '';
    this.style = {};
    this.attributes = {};
    this._listeners = {};
    // 真 DOM 的 <input>/<select> 一律有 value（默认 ''）。桩里不给的话，
    // 面板里 `input.value.trim()` 会炸，而那是面板的正常写法。
    this.value = '';
    this.placeholder = '';
    this.disabled = false;
    this.parentNode = null;
    // 真 <input> 的光标位：面板恢复焦点时读它、setSelectionRange 写它。
    this.selectionStart = 0;
    this.selectionEnd = 0;
  }

  get textContent() {
    if (this.childNodes.length) return this.childNodes.map((c) => c.textContent).join('');
    return this._text;
  }

  set textContent(v) {
    this.childNodes = [];
    this._text = v === null || v === undefined ? '' : String(v);
  }

  appendChild(node) {
    this.childNodes.push(node);
    node.parentNode = this;
    this._text = '';
    return node;
  }

  append(...nodes) {
    for (const n of nodes) this.appendChild(typeof n === 'string' ? Object.assign(new Node('#text'), { _text: n }) : n);
  }

  prepend(node) {
    this.childNodes.unshift(node);
    node.parentNode = this;
    return node;
  }

  replaceChildren(...nodes) {
    this.childNodes = [];
    this._text = '';
    for (const n of nodes) this.appendChild(n);
  }

  remove() {
    if (!this.parentNode) return;
    const i = this.parentNode.childNodes.indexOf(this);
    if (i >= 0) this.parentNode.childNodes.splice(i, 1);
    this.parentNode = null;
  }

  get classList() {
    const self = this;
    return {
      add: (...names) => {
        const set = new Set(self.className.split(' ').filter(Boolean));
        for (const n of names) set.add(n);
        self.className = [...set].join(' ');
      },
      remove: (...names) => {
        const drop = new Set(names);
        self.className = self.className.split(' ').filter((n) => n && !drop.has(n)).join(' ');
      },
      contains: (n) => self.className.split(' ').includes(n),
    };
  }

  addEventListener(type, fn) {
    (this._listeners[type] ??= []).push(fn);
  }

  /** 面板重画后会调它恢复焦点：真 DOM 里 focus() 会把 activeElement 指过来。 */
  focus() {
    document.activeElement = this;
  }

  setSelectionRange(start, end) {
    this.selectionStart = start;
    this.selectionEnd = end;
  }

  /** 触发一个事件（onclick 这类属性也一并触发）。 */
  fire(type = 'click') {
    for (const fn of this._listeners[type] ?? []) fn({ type, target: this });
    const prop = this[`on${type}`];
    if (typeof prop === 'function') prop({ type, target: this });
  }

  /** 先序遍历找节点。 */
  *walk() {
    yield this;
    for (const c of this.childNodes) yield* c.walk();
  }

  querySelector(sel) {
    const n = this.querySelectorAll(sel);
    return n[0] ?? null;
  }

  querySelectorAll(sel) {
    const isTag = !sel.startsWith('.');
    const clss = isTag ? [] : sel.split('.').filter(Boolean);
    return [...this.walk()].filter((n) => {
      if (n === this) return false;
      if (isTag) return n.tagName === sel.toUpperCase();
      return clss.every((c) => c && n.classList.contains(c));
    });
  }

  /** 测试用：按 class 收集所有文本。 */
  texts(cls) {
    return this.querySelectorAll(`.${cls}`).map((n) => n.textContent);
  }

  findAll(pred) {
    return [...this.walk()].filter(pred);
  }

  findByText(text) {
    return [...this.walk()].find((n) => n.tagName === 'BUTTON' && n.textContent === text) ?? null;
  }
}

globalThis.document = {
  createElement: (tag) => new Node(tag),
  createTextNode: (t) => Object.assign(new Node('#text'), { _text: String(t) }),
  activeElement: null,
};

/**
 * 等某个条件成立，而不是「等 0 毫秒若干次」。
 *
 * 面板里一次点击往往要跨好几轮 microtask 和 timer（invoke → 重绘 → 再 invoke），
 * 固定次数的 setTimeout(0) 是竞态：机器快就过、机器慢就挂。真正要等的是「结果出现了」。
 */
async function waitFor(check, what = '条件', timeoutMs = 2000) {
  // 用 performance.now 计时：有的用例把 Date.now 换成假钟，用它计时会永远等下去。
  const start = performance.now();
  for (;;) {
    const value = check();
    if (value) return value;
    if (performance.now() - start > timeoutMs) throw new Error(`等 ${what} 超时（${timeoutMs}ms）`);
    await new Promise((r) => setTimeout(r, 2));
  }
}

// --------------------------------------------------------------------------
// 夹具
// --------------------------------------------------------------------------

const invocations = [];
/**
 * 每个用例一份独立的数据目录，见 mountPanels。
 * 带上 pid 和启动时间：只按序号的话，第二次跑测试会读到上一次留下的 state.json。
 */
let panelSeq = 0;
const panelRun = `${process.pid}-${Date.now().toString(36)}`;
/**
 * 面板登记的定时器。每次都从 mountPanels 重新给一份：文件级共享的话，
 * `intervals.find(...)` 会摸到上一个用例的旧面板留下的定时器，测起来就是假的。
 */
const intervalBox = { list: [] };

/**
 * 假钟：把 Date.now 接到一个可推进的 `{ now }` 上（面板每次走表都现读一次 Date.now，
 * 冻结成固定值的话，钟拨了它也不知道）。用完必须换回来。
 */
const realTime = Date.now;
function fakeClock(clock) {
  Date.now = () => clock.now;
  return () => { Date.now = realTime; };
}

async function mountPanels({ language = 'zh', failList = false, clock = null } = {}) {
  // 每次一个独立目录：共用一个的话，上一个用例端过的菜、吃过的记录会漏到下一个用例里，
  // 于是"刚端上来"和"早就吃完了"混在一起，测出来的东西是假的。
  const dataDir = `.tmp/panels/${panelRun}/${panelSeq += 1}`;
  const world = new FeastWorld({
    cfg: { ...DEFAULTS, enabled: true },
    dataDir,
    timezone: 'Asia/Shanghai',
    now: clock ? () => clock.now : () => Date.parse('2026-11-05T12:05:00+08:00'),
    random: () => 0.5,
    timers: { setInterval: () => 1, clearInterval() {}, setTimeout: () => 1 },
  });
  await world.start({
    log: { info() {}, warn() {} },
    async pushEvent(e) { return { ...e, cursor: 1 }; },
  });
  const decl = world.webUi(language);

  const bundle = await import('../dist/webui.js?' + Math.random());
  const root = new Node('div');
  const timeouts = [];
  const panels = { lastHandle: null };
  intervalBox.list.length = 0; // 只清空，不换数组（换掉的话外面拿到的还是旧的）
  const ctx = {
    pageId: 'world:feast',
    panelId: '',
    language,
    root,
    signal: { aborted: false },
    timeout(fn) { timeouts.push(fn); return { dispose() {} }; },
    interval(fn, ms) {
      const entry = { fn, ms, disposed: false };
      intervalBox.list.push(entry);
      return { dispose() { entry.disposed = true; } };
    },
    async invoke(method, args) {
      // 回执也留着：有些断言要看服务端真返回了什么（例如「端这一桌」端过去的菜名），
      // 光看"调了哪个方法"抓不到"端过去的和你看到的不一样"。
      const record = { method, args };
      invocations.push(record);
      if (failList && method === 'list') throw new Error('boom');
      // 面板 id 直接透传：写死成 menu/history 的话，套餐面板的调用会打到菜单面板上。
      const result = await decl.invoke(ctx.panelId, method, args ?? []);
      record.result = result;
      return result;
    },
  };

  async function mount(id) {
    ctx.panelId = id;
    root.replaceChildren();
    document.activeElement = null; // 上一个用例留在输入框里的焦点别漏过来
    invocations.length = 0;
    panels.lastHandle = (await bundle.default.panels[id].mount(ctx)) ?? null;
    return root;
  }

  return { world, bundle, decl, mount, root, invocations, timeouts, intervals: intervalBox.list, panels };
}

// --------------------------------------------------------------------------

test('bundle 形状对：三个面板，mount 都是函数', async () => {
  const b = await import('../dist/webui.js');
  assert.deepEqual(Object.keys(b.default.panels).sort(), ['combo', 'history', 'menu']);
  for (const id of ['menu', 'combo', 'history']) {
    assert.equal(typeof b.default.panels[id].mount, 'function', `${id} 缺 mount`);
  }
  assert.ok(!Array.isArray(b.default.panels));
});

test('菜单面板：挂载后拉到菜、画出卡片、注入了样式', async () => {
  const { mount, invocations, world } = await mountPanels();
  const root = await mount('menu');
  assert.equal(invocations[0].method, 'list');
  assert.ok(root.querySelector('style'), '没注入样式');
  const cards = root.querySelectorAll('.feast-card');
  assert.equal(cards.length, lib.dishes.length, `只画了 ${cards.length} 张卡`);
  assert.ok(root.texts('feast-card-n').includes('麻婆豆腐'));
  assert.ok(root.texts('feast-count')[0].includes(`共 ${lib.dishes.length} 道`));
  assert.ok(root.texts('feast-tag').length > 0, '标签没画出来');
  await world.stop();
});

test('菜单面板：点一张卡进详情，九维条、食材、实吃描写都在', async () => {
  const { mount, invocations, world } = await mountPanels();
  const root = await mount('menu');
  const card = root.querySelectorAll('.feast-card').find((c) => c.textContent.includes('麻婆豆腐'));
  assert.ok(card, '没找到麻婆豆腐那张卡');
  card.fire('click');
  await waitFor(() => root.querySelector('.feast-detail'), '详情画出来');

  assert.ok(invocations.some((i) => i.method === 'dish'), '没请求单道详情');
  assert.ok(root.texts('feast-detail-n')[0].includes('麻婆豆腐'));
  const bars = root.querySelectorAll('.feast-taste-bar');
  assert.equal(bars.length, 9, `九维应该画 9 条，画了 ${bars.length}`);
  const widths = root.findAll((n) => n.tagName === 'I').map((n) => parseFloat(n.style.width ?? '0'));
  assert.ok(widths.some((w) => w >= 70), '分值没有反映到条上');
  assert.ok(root.querySelectorAll('.feast-ing').length > 0, '缺食材');
  assert.ok(root.texts('feast-prose')[0].length > 40, '缺实吃描写');
  await world.stop();
});

test('菜单面板：点「端给她」会真的推到世界，并回到菜单带上等待条', async () => {
  const { mount, invocations, world } = await mountPanels();
  const root = await mount('menu');
  root.querySelectorAll('.feast-card').find((c) => c.textContent.includes('麻婆豆腐')).fire('click');
  await new Promise((r) => setTimeout(r, 0));

  const serve = root.findByText('端给她');
  assert.ok(serve, '没找到「端给她」按钮');
  serve.fire('click');
  await waitFor(() => root.querySelector('.feast-strip'), '端菜后出现等待条');

  assert.ok(invocations.some((i) => i.method === 'feed'), '没调 feed');
  assert.ok(root.querySelector('.feast-strip'), '没出现「还在她面前」那条');
  assert.ok(root.querySelectorAll('.feast-card').length > 0, '端完该回到菜单');
  await world.stop();
});

test('菜单面板：先选类别，菜系下拉跟着收窄，换类别会清掉对不上的菜系', async () => {
  const { mount, invocations, world } = await mountPanels();
  const root = await mount('menu');
  const [cat, cuisine] = root.findAll((n) => n.tagName === 'SELECT');
  assert.ok(cat && cuisine, '应该有类别和菜系两个下拉');

  // 一上来菜系列的是全部菜系
  assert.ok(root.findAll((n) => n.tagName === 'OPTION').length > 20);

  // 选「汤羹」→ 菜系下拉只剩汤羹里真有的那几个。
  // 两个数都从库里算：菜系总数会随加菜变（0.6.0 就从 24 涨到 28），
  // 「汤羹里的菜系数」更是会变——写死 20 这种上限，加两个菜系就红一次。
  const soupCuisines = new Set(
    lib.dishes.filter((d) => d.category === '汤羹').map((d) => d.cuisine),
  );
  assert.ok(soupCuisines.size < lib.cuisines.length, '汤羹不该覆盖全部菜系，否则这条测不出收窄');
  cat.value = '汤羹';
  cat.fire('change');
  await waitFor(() => invocations.filter((i) => i.method === 'list').pop()?.args[0]?.category === '汤羹',
    '请求带上类别');
  const last = invocations.filter((i) => i.method === 'list').pop();
  assert.equal(last.args[0].category, '汤羹');

  // 再选一个菜系，两个条件一起带上
  // 重拉期间面板会先清成"载入中"，那儿没有下拉——要等它画回来再取。
  await waitFor(() => root.findAll((n) => n.tagName === 'SELECT').length === 2, '下拉画回来');
  const after = root.findAll((n) => n.tagName === 'SELECT')[1];
  const opts = after.childNodes.filter((n) => n.tagName === 'OPTION').map((n) => n.value).filter(Boolean);
  assert.equal(opts.length, soupCuisines.size,
    `汤羹下的菜系应该只剩汤羹里真有的那 ${soupCuisines.size} 个，现在是 ${opts.length} 个`);
  assert.ok(opts.every((o) => soupCuisines.has(o)), `汤羹下拉里混进了没有汤羹的菜系：${opts.filter((o) => !soupCuisines.has(o)).join('、')}`);
  after.value = opts[0];
  after.fire('change');
  await waitFor(() => {
    const l = invocations.filter((i) => i.method === 'list').pop()?.args[0];
    return l?.category === '汤羹' && l?.cuisine === opts[0];
  }, '类别和菜系一起带上');
  await world.stop();
});

test('菜单面板：筛选下拉真的会带上条件再请求', async () => {
  const { mount, invocations, world } = await mountPanels();
  const root = await mount('menu');
  const selects = root.findAll((n) => n.tagName === 'SELECT');
  assert.equal(selects.length, 2, '应该有类别和菜系两个下拉');
  // 顺序是「先类别、后菜系」，所以菜系是第二个
  selects[1].value = '川菜';
  selects[1].fire('change');
  // 不写死道数：菜会一直加，跟库里实际数对上就行。
  const chuanCount = lib.dishes.filter((d) => d.cuisine === '川菜').length;
  await waitFor(() => root.querySelectorAll('.feast-card').length === chuanCount, `筛出 ${chuanCount} 道川菜`);
  const last = invocations.filter((i) => i.method === 'list').pop();
  assert.equal(last.args[0].cuisine, '川菜');
  assert.equal(root.querySelectorAll('.feast-card').length, chuanCount);
  await world.stop();
});

test('菜单面板：搜索框防抖后带上 query', async () => {
  const { mount, invocations, world } = await mountPanels();
  const root = await mount('menu');
  const search = root.querySelector('.feast-search');
  search.value = '花椒';
  search.fire('input');
  // 面板里有 260ms 防抖，等请求真的带上 query 再断言
  await waitFor(
    () => invocations.filter((i) => i.method === 'list').pop()?.args[0]?.query === '花椒',
    '搜索请求带上 query',
    3000,
  );
  const last = invocations.filter((i) => i.method === 'list').pop();
  assert.equal(last.args[0].query, '花椒');
  await world.stop();
});

test('菜单面板：「随机一道」直接开详情', async () => {
  const { mount, invocations, world } = await mountPanels();
  const root = await mount('menu');
  root.findByText('随机一道').fire('click');
  await waitFor(() => root.querySelector('.feast-detail'), '随机出的详情');
  assert.ok(invocations.some((i) => i.method === 'random'));
  assert.ok(root.querySelector('.feast-detail'), '没进详情');
  await world.stop();
});

test('菜单面板：取不到数据时给错误卡，不炸', async () => {
  const { mount, world } = await mountPanels({ failList: true });
  const root = await mount('menu');
  assert.ok(root.querySelector('.feast-empty'), '没有错误卡');
  assert.ok(root.querySelector('.feast-empty').textContent.includes('取不到数据'));
  await world.stop();
});

test('历史面板：统计、口味画像、最近几口都画得出来', async () => {
  const { mount, world } = await mountPanels();
  await world.tools().find((t) => t.name === 'feast_eat').handler({ dish: '麻婆豆腐' });
  await world.tools().find((t) => t.name === 'feast_reaction').handler({ action: 'like', note: '麻得正好' });

  const root = await mount('history');
  const values = root.texts('feast-stat-v');
  assert.ok(values.includes('1'), '吃过 1 回没显示');
  assert.equal(root.querySelectorAll('.feast-taste-bar').length, 9, '画像的九维没画');
  assert.ok(root.texts('feast-item-n').some((s) => s.includes('麻婆豆腐')), '最近几口里没有麻婆豆腐');
  assert.ok(root.texts('feast-item-n').some((s) => s.includes('麻得正好')), '反应没显示');
  await world.stop();
});

test('英文界面：文案切过去，数据还是同一份', async () => {
  const { mount, world } = await mountPanels({ language: 'en' });
  const root = await mount('menu');
  assert.equal(root.findByText('Surprise me')?.textContent, 'Surprise me');
  assert.ok(root.texts('feast-count')[0].includes(`${lib.dishes.length} dishes`));
  await world.stop();
});

test('面板只往 ctx.root 里写，没碰 document.body', async () => {
  const { mount, world } = await mountPanels();
  const root = await mount('menu');
  assert.equal(root.childNodes.length, 2, '应该是 <style> + 容器');
  assert.equal(root.childNodes[0].tagName, 'STYLE');
  await world.stop();
});

test('菜单面板：端来的那道写着还剩多久，钟走一格就变小，到点自己收走', async () => {
  // 世界那边的表和面板看表用同一个钟（真实环境里两端也是一致的），
  // 所以端上来的那一瞬间该显示"还剩 30 分钟"。
  const T0 = Date.parse('2026-11-05T11:35:10+08:00');
  const clock = { now: T0 };
  const restore = fakeClock(clock);
  const { mount, world, invocations, intervals, panels } = await mountPanels({ clock });
  try {
    const root = await mount('menu');

    // 从面板上端：端完它会自己回菜单并重拉一次，等待条这时就该出现
    root.querySelectorAll('.feast-card').find((c) => c.textContent.includes('麻婆豆腐')).fire('click');
    await waitFor(() => root.querySelector('.feast-detail'), '详情画出来', 4000);
    root.findByText('端给她').fire('click');
    await waitFor(() => root.querySelector('.feast-left'), '等待条上出现倒计时', 4000);

    assert.ok(root.texts('feast-left')[0].includes('还剩约 30 分钟'), `端上来该显示 30 分钟：${root.texts('feast-left')[0]}`);

    const ticker = intervals.find((i) => i.ms === 30_000);
    assert.ok(ticker, '面板没登记 30 秒走一次的定时器');

    // 拨 16 分钟：不重拉数据，那一行字自己变小
    clock.now = T0 + 16 * 60_000;
    ticker.fn();
    assert.ok(root.texts('feast-left')[0].includes('还剩约 14 分钟'), `该变成 14 分钟：${root.texts('feast-left')[0]}`);

    // 拨过保质期：再走一格，等待条该自己消失
    clock.now = T0 + 31 * 60_000;
    const before = invocations.filter((i) => i.method === 'list').length;
    ticker.fn();
    await waitFor(() => !root.querySelector('.feast-strip'), '过期后等待条消失', 4000);
    assert.ok(invocations.filter((i) => i.method === 'list').length > before, '到点该重拉一次数据');
  } finally {
    panels.lastHandle?.dispose?.();
    restore();
  }
  await world.stop();
});

test('菜单面板：别处端来的菜、别人吃掉了，重开面板时等待条跟着服务端走', async () => {
  const T0 = Date.parse('2026-11-05T11:35:10+08:00');
  const clock = { now: T0 };
  const restore = fakeClock(clock);
  const { mount, world, panels } = await mountPanels({ clock });
  try {
    await world.feedDish('mapo-tofu'); // 这一次不是从面板上端的
    const root = await mount('menu');
    assert.ok(root.querySelector('.feast-strip'), '重开面板该看到还在她面前的那道');
    assert.ok(root.texts('feast-left')[0].includes('还剩约 30 分钟'), root.texts('feast-left')[0]);

    // 她吃掉了：服务端已经收走，面板重开必须跟着没有
    await world.tools().find((t) => t.name === 'feast_eat').handler({});
    const again = await mount('menu');
    assert.ok(!again.querySelector('.feast-strip'), '吃掉了还挂着等待条，那是在骗主人');
  } finally {
    panels.lastHandle?.dispose?.();
    restore();
  }
  await world.stop();
});

test('英文界面：等待条上的倒计时也是英文', async () => {
  const T0 = Date.parse('2026-11-05T11:35:10+08:00');
  const clock = { now: T0 };
  const restore = fakeClock(clock);
  const { mount, world, panels } = await mountPanels({ language: 'en', clock });
  try {
    await world.feedDish('mapo-tofu'); // 先端上：面板一挂载就该看到这条
    const root = await mount('menu');
    await waitFor(() => root.querySelector('.feast-left'), '出现倒计时', 4000);
    assert.ok(root.texts('feast-left')[0].includes('about 30 min left'), root.texts('feast-left')[0]);
  } finally {
    panels.lastHandle?.dispose?.();
    restore();
  }
  await world.stop();
});

// --------------------------------------------------------------------------
// 一起吃饭（会话条挂在菜单面板顶部，没有新面板）
// --------------------------------------------------------------------------

/** 她那边动一下（回喂 / 收摊），走的是她自己的工具。 */
function herTool(world, args) {
  const t = world.tools().find((x) => x.name === 'feast_together');
  assert.ok(t, '没找到 feast_together');
  return t.handler(args);
}

test('菜单面板：没在一起吃时只有一个小按钮，点它就去邀请她', async () => {
  const { mount, invocations, world, panels } = await mountPanels();
  try {
    const root = await mount('menu');
    const bar = root.querySelector('.feast-together');
    assert.ok(bar, '菜单面板顶部该有会话条');
    assert.ok(!bar.textContent.includes('散桌'), '还没开席，不该有散桌');
    assert.ok(!root.findByText('好，一起吃'), '没邀请时不该有「好，一起吃」');

    const ask = root.findByText('🍽 一起吃');
    assert.ok(ask, `会话条上该有邀请按钮：${bar.textContent}`);
    ask.fire('click');
    await waitFor(() => root.findByText('散桌'), '开席后出现散桌');
    assert.ok(invocations.some((i) => i.method === 'invite'), '没调 invite');
  } finally {
    panels.lastHandle?.dispose?.();
  }
  await world.stop();
});

test('菜单面板：正一起吃时画出喂过几口、她分的一口（带接过来/下次吧），点散桌会调 end', async () => {
  const { mount, invocations, world, panels } = await mountPanels();
  try {
    await world.inviteTogether();
    await world.biteTogether(lib.dishes[0].id);
    await herTool(world, { action: 'feed', dish: lib.dishes[1].id });

    const root = await mount('menu');
    const bar = root.querySelector('.feast-together');
    assert.ok(bar.textContent.includes('正一起吃'), `会话条该写着在吃：${bar.textContent}`);
    assert.ok(bar.textContent.includes('喂过 1 口'), `该写喂过几口：${bar.textContent}`);
    assert.ok(bar.textContent.includes(lib.dishes[1].name), `该写她分了哪一口：${bar.textContent}`);
    assert.ok(root.findByText('接过来'), '她分过来的一口该有「接过来」');
    assert.ok(root.findByText('下次吧'), '该有「下次吧」');

    root.findByText('接过来').fire('click');
    await waitFor(() => invocations.some((i) => i.method === 'reply'), '调 reply');
    const call = invocations.filter((i) => i.method === 'reply').pop();
    assert.equal(call.args[0].ok, true, '接过来就是 ok:true');

    root.findByText('散桌').fire('click');
    await waitFor(() => invocations.some((i) => i.method === 'end'), '调 end');
  } finally {
    panels.lastHandle?.dispose?.();
  }
  await world.stop();
});

test('菜单面板：她挂着邀请时给出「好，一起吃」和「今天不了」', async () => {
  const { mount, invocations, world, panels } = await mountPanels();
  try {
    await herTool(world, { action: 'invite' });
    const root = await mount('menu');
    const bar = root.querySelector('.feast-together');
    assert.ok(bar.textContent.includes('想和你一起'), `会话条该说她想一起吃：${bar.textContent}`);

    root.findByText('好，一起吃').fire('click');
    await waitFor(() => invocations.some((i) => i.method === 'accept'), '调 accept');
    await waitFor(() => root.findByText('散桌'), '接住之后就在一起吃');
  } finally {
    panels.lastHandle?.dispose?.();
  }
  await world.stop();
});

test('菜单面板：自己走表只拉「一起吃饭」这一条，结构没变就不重画卡片', async () => {
  const { mount, invocations, world, panels, intervals } = await mountPanels();
  try {
    await world.inviteTogether();
    const root = await mount('menu');
    const cardsBefore = root.querySelectorAll('.feast-card').length;

    const ticker = intervals.find((e) => e.ms === 30_000);
    assert.ok(ticker, '菜单面板该登记一个 30 秒的表');
    const listsBefore = invocations.filter((i) => i.method === 'list').length;
    ticker.fn();
    await waitFor(() => invocations.some((i) => i.method === 'together'), '走表时拉一起吃饭');
    // 结构没变（还是同一顿、没人再喂）：不该重画 701 张卡。
    assert.equal(invocations.filter((i) => i.method === 'list').length, listsBefore,
      '结构没变时不该整块重拉');
    assert.equal(root.querySelectorAll('.feast-card').length, cardsBefore);
  } finally {
    panels.lastHandle?.dispose?.();
  }
  await world.stop();
});

test('菜单面板：她那边先收了这顿，走表一拍之后会话条跟着收掉', async () => {
  const { mount, world, panels, intervals } = await mountPanels();
  try {
    await world.inviteTogether();
    const root = await mount('menu');
    assert.ok(root.findByText('散桌'), '先得在吃');

    await herTool(world, { action: 'end' });
    const ticker = intervals.find((e) => e.ms === 30_000);
    ticker.fn();
    await waitFor(() => !root.findByText('散桌'), '她收摊后面板跟着收起会话条');
  } finally {
    panels.lastHandle?.dispose?.();
  }
  await world.stop();
});

test('菜单面板：菜品详情里能「喂她一口」和「我也吃这道」，不在席上都不显示', async () => {
  const { mount, invocations, world, panels } = await mountPanels();
  try {
    const root = await mount('menu');
    const open = (name) => root.querySelectorAll('.feast-card').find((c) => c.textContent.includes(name));
    open('麻婆豆腐').fire('click');
    await waitFor(() => root.querySelector('.feast-detail'), '详情画出来');
    assert.ok(!root.findByText('我也吃这道'), '没在吃的时候不该有「我也吃这道」');
    assert.ok(!root.findByText('喂她一口'), '没在吃的时候不该有「喂她一口」');

    await world.inviteTogether();
    await mount('menu');
    open('麻婆豆腐').fire('click');
    await waitFor(() => root.querySelector('.feast-detail'), '详情又画出来');

    // 喂她一口：主人的投喂动作，走 bite（进她的吃过记录，但不算吃掉一道）
    const bite = root.findByText('喂她一口');
    assert.ok(bite, '正一起吃时详情里该有「喂她一口」');
    bite.fire('click');
    await waitFor(() => invocations.some((i) => i.method === 'bite'), '调 bite');
    assert.equal(invocations.filter((i) => i.method === 'bite').pop().args[0], 'mapo-tofu',
      '喂的是点开的那道');

    const mine = root.findByText('我也吃这道');
    assert.ok(mine, '正一起吃时详情里该有「我也吃这道」');
    mine.fire('click');
    await waitFor(() => invocations.some((i) => i.method === 'take'), '调 take');
    const call = invocations.filter((i) => i.method === 'take').pop();
    assert.equal(call.args[0].id, 'mapo-tofu', '该把这一道报过去');
  } finally {
    panels.lastHandle?.dispose?.();
  }
  await world.stop();
});

// --------------------------------------------------------------------------
// 套餐面板
// --------------------------------------------------------------------------

test('套餐面板：挂载后画出预设，每张卡带着现配出来的菜名', async () => {
  const { mount, invocations, world, panels } = await mountPanels();
  try {
    const root = await mount('combo');
    assert.equal(invocations[0].method, 'list', '一挂载就该拉数据');
    const cards = root.querySelectorAll('.feast-set');
    assert.ok(cards.length >= 8, `预设该画出 8 张：${cards.length}`);
    const text = cards.map((c) => c.textContent).join('\n');
    assert.ok(text.includes('四菜一汤'), '缺四菜一汤那张');
    assert.ok(text.includes('清爽一餐'), '缺清爽一餐那张');
    // 每张卡都该有「端这一桌」和「看这一桌」。
    assert.ok(root.findByText('端这一桌'), '缺端这一桌按钮');
    assert.ok(root.findByText('看这一桌'), '缺看这一桌按钮');
    // 预设是槽位现配的，端之前必须看得到具体是哪几道。
    assert.ok(root.querySelectorAll('.feast-set-dishes').length >= 8, '每张卡都该列出具体菜名');
  } finally {
    panels.lastHandle?.dispose?.();
  }
  await world.stop();
});

test('套餐面板：点「端这一桌」会真的推过去，并带上等待条', async () => {
  const { mount, invocations, world, panels } = await mountPanels();
  try {
    const root = await mount('combo');
    const card = root.querySelectorAll('.feast-set').find((c) => c.textContent.includes('四菜一汤'));
    assert.ok(card, '没找到四菜一汤');
    const serve = card.findAll((n) => n.tagName === 'BUTTON').find((b) => b.textContent.includes('端这一桌'));
    assert.ok(serve, '那张卡上没找到端这一桌');
    serve.fire('click');
    await waitFor(() => invocations.some((i) => i.method === 'serve'), '调 serve');
    await waitFor(() => root.querySelector('.feast-strip'), '出现等待条');

    const strip = root.querySelector('.feast-strip').textContent;
    assert.ok(strip.includes('这一桌'), `等待条该说这是一桌：${strip}`);
    assert.ok(/还剩 \d+ \/ \d+ 道/.test(strip), `该写还剩几道：${strip}`);
  } finally {
    panels.lastHandle?.dispose?.();
  }
  await world.stop();
});

// 卡片上列的菜名和「端这一桌」端过去的菜名必须一模一样。
// 这两条钉的是同一件事：种子（也就是这一桌怎么配）必须在**画卡之前**就定好。
// 以前卡上写死 `<id>|panel`、端的时候另生成一颗 `Date.now()`，于是"看到的"
// 和"端过去的"是两桌菜——面板自己还写着"看到的这几道就是会端过去的那几道"。
test('套餐面板：不先点「看这一桌」，直接端也是卡上列的那几道', async () => {
  const { mount, invocations, world, panels } = await mountPanels();
  try {
    const root = await mount('combo');
    const card = () => root.querySelectorAll('.feast-set').find((c) => c.textContent.includes('四菜一汤'));
    const row = card().querySelectorAll('.feast-set-dishes')[0];
    assert.ok(row, '卡上该列出具体菜名');
    const shown = row.querySelectorAll('span').map((n) => n.textContent);
    assert.ok(shown.length >= 2, `卡上该列出具体菜名：${shown.join('、')}`);

    const serve = card().findAll((n) => n.tagName === 'BUTTON').find((b) => b.textContent.includes('端这一桌'));
    serve.fire('click');
    const call = await waitFor(() => invocations.filter((i) => i.method === 'serve' && i.result).pop(), 'serve 回执');

    const served = (call.result.dishes ?? []).map((d) => d.name);
    assert.deepEqual(served, shown,
      `卡上列的和端过去的不是同一桌：卡上「${shown.join('、')}」/ 端过去「${served.join('、')}」`);
    assert.equal(typeof call.args[0].seed, 'string', '端的时候该带上这一张卡的那颗种子');
  } finally {
    panels.lastHandle?.dispose?.();
  }
  await world.stop();
});

test('套餐面板：点过「看这一桌」之后再端，端的是重配后卡上显示的那一桌', async () => {
  const { mount, invocations, world, panels } = await mountPanels();
  try {
    const root = await mount('combo');
    const card = () => root.querySelectorAll('.feast-set').find((c) => c.textContent.includes('清爽一餐'));
    const withSeeds = () => invocations.filter((i) => i.method === 'list' && i.args?.[0]?.seeds).length;
    const before = withSeeds();
    assert.ok(before > 0, '一挂载就该带种子拉过一次数据');

    card().findAll((n) => n.tagName === 'BUTTON').find((b) => b.textContent.includes('看这一桌')).fire('click');
    await waitFor(() => withSeeds() > before, '预览后带新种子重拉数据');

    const shown = card().querySelectorAll('.feast-set-dishes')[0].querySelectorAll('span').map((n) => n.textContent);
    // 这一张卡这次画用好的是哪颗种子——端的时候必须还是它。
    const seedUsed = invocations.filter((i) => i.method === 'list' && i.args?.[0]?.seeds).pop().args[0].seeds['light-meal'];
    assert.equal(typeof seedUsed, 'string', '画卡的那次 list 该带上这一张卡的种子');

    const serve = card().findAll((n) => n.tagName === 'BUTTON').find((b) => b.textContent.includes('端这一桌'));
    serve.fire('click');
    const call = await waitFor(() => invocations.filter((i) => i.method === 'serve' && i.result).pop(), 'serve 回执');

    assert.equal(call.args[0].seed, seedUsed, '端的时候换了种子，卡上的菜就不再是端过去的菜');
    const served = (call.result.dishes ?? []).map((d) => d.name);
    assert.deepEqual(served, shown,
      `预览之后端的该是重配的那一桌：卡上「${shown.join('、')}」/ 端过去「${served.join('、')}」`);
  } finally {
    panels.lastHandle?.dispose?.();
  }
  await world.stop();
});

test('套餐面板：勾几道 → 直接端，勾的那几道就是端过去的那几道', async () => {
  const { mount, invocations, world, panels } = await mountPanels();
  try {
    const root = await mount('combo');
    const chips = root.querySelectorAll('.feast-chip');
    assert.ok(chips.length > 100, `勾选区该有整库：${chips.length}`);
    // 勾三道
    const want = ['麻婆豆腐', '东坡肉', '腌笃鲜'];
    for (const name of want) {
      const chip = root.querySelectorAll('.feast-chip').find((c) => c.textContent.includes(name));
      assert.ok(chip, `勾选区里没找到${name}`);
      chip.fire('click');
      await new Promise((r) => setTimeout(r, 0));
    }
    const card = root.querySelectorAll('.feast-build')[0];
    assert.ok(card.textContent.includes('已选 3'), `该显示已选 3 道：${card.textContent.slice(-80)}`);

    // 只在动作条里找按钮：菜卡本身也是 button，findAll 会把 701 个 chip 都算进来。
    const acts = card.querySelectorAll('.feast-set-acts')[0];
    const serve = acts.findAll((n) => n.tagName === 'BUTTON').find((b) => b.textContent.includes('端这一桌'));
    assert.ok(serve, '动作条里没找到端这一桌');
    serve.fire('click');
    serve.fire('click');
    await waitFor(() => invocations.some((i) => i.method === 'serve'), '调 serve');

    const call = invocations.filter((i) => i.method === 'serve').pop();
    assert.equal(call.args[0].dishes.length, 3, '该把勾的三道传过去');
    await waitFor(() => root.querySelector('.feast-strip'), '出现等待条');
    assert.ok(root.querySelector('.feast-strip').textContent.includes('3'), '等待条该说三道');
  } finally {
    panels.lastHandle?.dispose?.();
  }
  await world.stop();
});

test('套餐面板：攒一桌存下来，重开面板还在', async () => {
  const { mount, invocations, world, panels } = await mountPanels();
  try {
    let root = await mount('combo');
    const chips = () => root.querySelectorAll('.feast-chip');
    chips().find((c) => c.textContent.includes('麻婆豆腐')).fire('click');
    await new Promise((r) => setTimeout(r, 0));
    root = root; // 重绘后 root 还在
    chips().find((c) => c.textContent.includes('东坡肉')).fire('click');
    await new Promise((r) => setTimeout(r, 0));

    const input = root.findAll((n) => n.tagName === 'INPUT').find((i) => i.placeholder.includes('名字'));
    assert.ok(input, '缺起名字的输入框');
    input.value = '我的两菜桌';
    input.fire('input');

    const save = root.querySelectorAll('.feast-set-acts').at(-1)
      .findAll((n) => n.tagName === 'BUTTON')
      .find((b) => b.textContent.trim() === '攒一桌');
    assert.ok(save, '缺存下来按钮');
    save.fire('click');
    await waitFor(() => invocations.some((i) => i.method === 'save'), '调 save');
    await waitFor(() => root.textContent.includes('我的两菜桌'), '存下来的桌出现在列表里', 3000);

    // 重开面板（同一个 World），自定义的桌该还在。
    const again = await mount('combo');
    await waitFor(() => again.textContent.includes('我的两菜桌'), '重开面板后自定义桌还在');
    assert.ok(again.querySelectorAll('.feast-set').length >= 9, '预设 8 + 自定义 1');
  } finally {
    panels.lastHandle?.dispose?.();
  }
  await world.stop();
});

test('菜单面板：搜索框打完字重拉，焦点和光标还在输入框里（组词中不重拉）', async () => {
  const { mount, world, panels } = await mountPanels();
  try {
    const root = await mount('menu');
    const allCount = root.querySelectorAll('.feast-card').length;
    assert.ok(allCount > 100, '先确认全量卡片在');

    const search = root.findAll((n) => n.tagName === 'INPUT').find((i) => i.placeholder.includes('搜菜名'));
    assert.ok(search, '缺搜索框');
    search.focus();
    search.value = '豆腐';
    // 输入法组词中：不该触发重拉（树一摘，组了一半的词就散了）
    search.oninput({ isComposing: true });
    await new Promise((r) => setTimeout(r, 350));
    assert.equal(root.querySelectorAll('.feast-card').length, allCount, '组词中不该重拉');

    search.selectionStart = 2;
    search.selectionEnd = 2; // 光标在词尾
    search.fire('compositionend'); // 组词结束才真正去搜
    await waitFor(() => root.querySelectorAll('.feast-card').length < allCount, '按词筛出结果');

    const active = document.activeElement;
    assert.ok(active, '重画后焦点还在');
    assert.equal(active.tagName, 'INPUT', '焦点回到了输入框');
    assert.equal(active.value, '豆腐', '重画后搜索词还在');
    assert.equal(active.selectionStart, 2, '光标位置也放回去了');
    assert.equal(root.findAll((n) => n === active).length, 1, '拿到焦点的输入框在面板里');
  } finally {
    panels.lastHandle?.dispose?.();
  }
  await world.stop();
});

test('菜单面板：一起吃饭记一笔打到一半，她分一口过来重画也不丢字、不丢焦点', async () => {
  const { mount, world, panels, intervals } = await mountPanels();
  try {
    await world.inviteTogether();
    const root = await mount('menu');
    const noteOf = () => root.findAll((n) => n.tagName === 'INPUT').find((i) => i.placeholder.includes('我在吃'));
    const note = noteOf();
    assert.ok(note, '缺记一笔的输入框');
    note.focus();
    note.selectionStart = 4;
    note.selectionEnd = 4;
    note.value = '我在吃一碗';
    note.fire('input');
    assert.equal(document.activeElement, note, '焦点先落在输入框上');

    // 她分了一口过来：会话条结构变了，走表一拍后整条重画
    await herTool(world, { action: 'feed', dish: lib.dishes[1].id });
    const ticker = intervals.find((e) => e.ms === 30_000);
    assert.ok(ticker, '菜单面板该登记 30 秒的表');
    ticker.fn();
    await waitFor(() => root.findByText('接过来'), '她分的一口画出来');

    const next = noteOf();
    assert.ok(next && next !== note, '输入框被重画成了新节点');
    assert.equal(next.value, '我在吃一碗', '打了一半的字没被吞');
    assert.equal(document.activeElement, next, '焦点放回了新的输入框');
    assert.equal(next.selectionStart, 4, '光标位置放回去了');
  } finally {
    panels.lastHandle?.dispose?.();
  }
  await world.stop();
});

test('套餐面板：攒桌搜索打字不丢焦点，点靠下的 chip 后滚动位置不跳顶', async () => {
  const { mount, world, panels } = await mountPanels();
  try {
    const root = await mount('combo');
    const search = root.findAll((n) => n.tagName === 'INPUT').find((i) => i.placeholder.includes('搜菜名'));
    assert.ok(search, '缺攒桌搜索框');
    search.focus();
    search.value = '豆腐';
    search.selectionStart = 2;
    search.selectionEnd = 2;
    search.fire('input'); // 同步重画
    assert.equal(document.activeElement, search, '重画后焦点还在同一个搜索框');
    assert.equal(root.findAll((n) => n === search).length, 1, '搜索框被重新挂回面板');
    assert.equal(search.selectionStart, 2, '光标位置放回去了');
    assert.ok(root.querySelector('.feast-pick'), '筛选后勾选区还在');

    // 清掉搜索回到全量，把勾选区滚下去再点 chip：不该弹回顶
    search.value = '';
    search.fire('input');
    const pick = root.querySelector('.feast-pick');
    assert.ok(pick, '缺勾选区');
    pick.scrollTop = 250;
    const chip = root.querySelectorAll('.feast-chip').find((c) => c.textContent.includes('麻婆豆腐'));
    assert.ok(chip, '全量列表里该有麻婆豆腐');
    chip.fire('click');
    const nextPick = root.querySelector('.feast-pick');
    assert.equal(nextPick.scrollTop, 250, '点 chip 后勾选区不该跳回顶');
    assert.ok(nextPick.querySelectorAll('.feast-chip').some((c) => c.classList.contains('is-on')
      && c.textContent.includes('麻婆豆腐')), 'chip 勾上了');
  } finally {
    panels.lastHandle?.dispose?.();
  }
  await world.stop();
});

test('套餐面板：攒的桌能改（名字和勾选带进攒桌区，保存带 id）', async () => {
  const { mount, invocations, world, panels } = await mountPanels();
  try {
    const root = await mount('combo');
    const chips = () => root.querySelectorAll('.feast-chip');
    chips().find((c) => c.textContent.includes('麻婆豆腐')).fire('click');
    await new Promise((r) => setTimeout(r, 0));
    chips().find((c) => c.textContent.includes('东坡肉')).fire('click');
    await new Promise((r) => setTimeout(r, 0));
    const input = root.findAll((n) => n.tagName === 'INPUT').find((i) => i.placeholder.includes('名字'));
    input.value = '改前桌';
    input.fire('input');
    root.querySelectorAll('.feast-set-acts').at(-1).findAll((n) => n.tagName === 'BUTTON')
      .find((b) => b.textContent.trim() === '攒一桌').fire('click');
    await waitFor(() => root.textContent.includes('改前桌'), '先攒出一张桌');

    const myCard = () => root.querySelectorAll('.feast-set').find((c) => c.textContent.includes('改前桌'));
    myCard().findAll((n) => n.tagName === 'BUTTON').find((b) => b.textContent.trim() === '改').fire('click');
    await new Promise((r) => setTimeout(r, 0));
    const nameInput = root.findAll((n) => n.tagName === 'INPUT').find((i) => i.placeholder.includes('名字'));
    assert.equal(nameInput.value, '改前桌', '名字带进了攒桌区');
    assert.ok(root.querySelector('.feast-build').textContent.includes('已选 2'), '勾选带进了攒桌区');
    assert.ok(root.querySelectorAll('.feast-chip').some((c) => c.classList.contains('is-on')
      && c.textContent.includes('麻婆豆腐')), '原来勾的菜还亮着');

    // 加一道再存：这次 save 要带 id，改的是同一张桌
    root.querySelectorAll('.feast-chip').find((c) => c.textContent.includes('腌笃鲜')).fire('click');
    await new Promise((r) => setTimeout(r, 0));
    root.querySelectorAll('.feast-set-acts').at(-1).findAll((n) => n.tagName === 'BUTTON')
      .find((b) => b.textContent.trim() === '改').fire('click');
    await waitFor(() => invocations.some((i) => i.method === 'save' && i.args[0]?.id), '改桌的保存带 id');
    const call = invocations.filter((i) => i.method === 'save').pop();
    assert.equal(call.args[0].name, '改前桌', '名字没变');
    assert.equal(call.args[0].dishes.length, 3, '改成三道了');
    await waitFor(() => root.querySelector('.feast-build').textContent.includes('已选 0'), '存完攒桌区清空');
  } finally {
    panels.lastHandle?.dispose?.();
  }
  await world.stop();
});

test('套餐面板：删要按两次（第一次只亮确认话术，第二次才真删）', async () => {
  const { mount, invocations, world, panels } = await mountPanels();
  try {
    const root = await mount('combo');
    const chips = () => root.querySelectorAll('.feast-chip');
    chips().find((c) => c.textContent.includes('麻婆豆腐')).fire('click');
    await new Promise((r) => setTimeout(r, 0));
    const input = root.findAll((n) => n.tagName === 'INPUT').find((i) => i.placeholder.includes('名字'));
    input.value = '待删桌';
    input.fire('input');
    root.querySelectorAll('.feast-set-acts').at(-1).findAll((n) => n.tagName === 'BUTTON')
      .find((b) => b.textContent.trim() === '攒一桌').fire('click');
    await waitFor(() => root.textContent.includes('待删桌'), '先攒出一张待删的桌');

    const myCard = () => root.querySelectorAll('.feast-set').find((c) => c.textContent.includes('待删桌'));
    const delOf = (card) => card.findAll((n) => n.tagName === 'BUTTON').find((b) => b.textContent.trim() === '删');
    delOf(myCard()).fire('click');
    await new Promise((r) => setTimeout(r, 0));
    assert.ok(!invocations.some((i) => i.method === 'remove'), '第一次点没真删');
    assert.ok(myCard().textContent.includes('再点一次就删掉'), '该变成确认话术');

    // 确认态下按钮文案变了，按新文案找到它再点
    const confirmOf = (card) => card.findAll((n) => n.tagName === 'BUTTON')
      .find((b) => b.textContent.trim() === '再点一次就删掉');
    confirmOf(myCard()).fire('click');
    await waitFor(() => invocations.some((i) => i.method === 'remove'), '第二次点才调 remove');
    await waitFor(() => !root.textContent.includes('待删桌'), '删完列表里没了');
  } finally {
    panels.lastHandle?.dispose?.();
  }
  await world.stop();
});

test('套餐面板：英文界面的按钮和标题是英文', async () => {
  const { mount, world, panels } = await mountPanels({ language: 'en' });
  try {
    const root = await mount('combo');
    const text = root.textContent;
    assert.ok(text.includes('Ready-made sets'), '缺英文标题');
    assert.ok(text.includes('Serve this table'), '缺英文按钮');
    assert.ok(text.includes('Build a table'), '缺英文攒桌标题');
    // 套餐名、菜名是数据，跟整个菜品库一样是中文——英文界面不译数据。
    // 这一条把那个界线钉住：证明确实是"内容中文、界面英文"，不是漏翻了界面。
    assert.ok(text.includes('四菜一汤'), '套餐名属于内容，仍应是中文');
  } finally {
    panels.lastHandle?.dispose?.();
  }
  await world.stop();
});

await report();