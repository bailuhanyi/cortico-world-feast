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
  const world = new FeastWorld({
    cfg: { ...DEFAULTS, enabled: true },
    dataDir: '.tmp/panels',
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
      invocations.push({ method, args });
      if (failList && method === 'list') throw new Error('boom');
      const which = ctx.panelId === 'history' ? 'history' : 'menu';
      return decl.invoke(which, method, args ?? []);
    },
  };

  async function mount(id) {
    ctx.panelId = id;
    root.replaceChildren();
    invocations.length = 0;
    panels.lastHandle = (await bundle.default.panels[id].mount(ctx)) ?? null;
    return root;
  }

  return { world, bundle, decl, mount, root, invocations, timeouts, intervals: intervalBox.list, panels };
}

// --------------------------------------------------------------------------

test('bundle 形状对：两个面板，mount 都是函数', async () => {
  const b = await import('../dist/webui.js');
  assert.deepEqual(Object.keys(b.default.panels).sort(), ['history', 'menu']);
  assert.equal(typeof b.default.panels.menu.mount, 'function');
  assert.equal(typeof b.default.panels.history.mount, 'function');
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

  // 选「汤羹」→ 菜系下拉只剩汤羹里真有的那几个
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
  assert.ok(opts.length > 0 && opts.length < 20, `汤羹下的菜系应该收窄了，现在是 ${opts.length} 个`);
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

await report();