/**
 * 用真实数据面挂载 dist 中的四个面板，验证 invoke、DOM 节点和交互契约。
 * DOM 桩不模拟布局、绘制或原生输入法；这些断言不代表 GUI 视觉验收。
 */
import assert from 'node:assert/strict';
import { test as registerTest, report } from './harness.mjs';
import { FeastWorld } from '../src/world.js';
import { loadDishes } from '../src/dishes.js';
import { DEFAULTS } from '../src/config.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { templateDay, writeDay, readDay, newPlay, writePlay } from '../src/life/index.js';
import { parseSlots } from '../src/state.js';

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
    this.dataset = {};
    this.scrollTop = 0;
    this.scrollHeight = 0;
    this.clientHeight = 0;
    if (this.tagName === 'DETAILS') this.open = false;
  }

  contains(node) { return node === this || this.childNodes.some((child) => child.contains(node)); }
  get parentElement() { return this.parentNode; }
  get children() { return this.childNodes.filter((node) => node.tagName !== '#TEXT'); }
  get firstChild() { return this.childNodes[0] ?? null; }
  getBoundingClientRect() {
    const { top = 0, bottom = top } = this.rect ?? {};
    return { top, bottom, left: 0, right: 0, width: 0, height: bottom - top };
  }
  scrollIntoView() {}

  get textContent() {
    if (this.childNodes.length) return this.childNodes.map((c) => c.textContent).join('');
    return this._text;
  }

  set textContent(v) {
    this.replaceChildren();
    this._text = v === null || v === undefined ? '' : String(v);
  }

  appendChild(node) {
    this.insertBefore(node, null);
    return node;
  }

  append(...nodes) { nodes.forEach((node) => this.appendChild(Node.from(node))); }
  prepend(...nodes) { const first = this.firstChild; nodes.forEach((node) => this.insertBefore(Node.from(node), first)); }
  static from(node) { return node instanceof Node ? node : Object.assign(new Node('#text'), { _text: String(node) }); }

  insertBefore(node, reference) {
    if (node === reference) return node;
    if (reference && reference.parentNode !== this) throw new Error('NotFoundError');
    node.remove();
    const index = reference ? this.childNodes.indexOf(reference) : this.childNodes.length;
    this.childNodes.splice(index, 0, node);
    node.parentNode = this;
    this._text = '';
    return node;
  }

  replaceChildren(...nodes) {
    for (const child of [...this.childNodes]) child.remove();
    this._text = '';
    this.append(...nodes);
  }

  replaceChild(node, old) {
    if (node !== old) { this.insertBefore(node, old); old.remove(); }
    return old;
  }

  replaceWith(...nodes) {
    const parent = this.parentNode;
    if (!parent) return;
    for (const node of nodes) parent.insertBefore(Node.from(node), this);
    if (!nodes.includes(this)) this.remove();
  }

  remove() {
    if (!this.parentNode) return;
    const i = this.parentNode.childNodes.indexOf(this);
    if (i >= 0) this.parentNode.childNodes.splice(i, 1);
    this.parentNode = null;
    if (document.activeElement && this.contains(document.activeElement)) document.activeElement = null;
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

  removeEventListener(type, fn) {
    this._listeners[type] = (this._listeners[type] ?? []).filter((listener) => listener !== fn);
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
    if (name === 'id') this.id = String(value);
    if (name.startsWith('data-')) this.dataset[Node.dataKey(name)] = String(value);
  }
  getAttribute(name) {
    if (name.startsWith('data-')) return this.dataset[Node.dataKey(name)] ?? null;
    if (name === 'id') return this.id ?? null;
    return this.attributes[name] ?? null;
  }
  removeAttribute(name) {
    delete this.attributes[name];
    if (name === 'id') delete this.id;
    if (name.startsWith('data-')) delete this.dataset[Node.dataKey(name)];
  }
  static dataKey(name) { return name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase()); }

  /** 面板重画后会调它恢复焦点：真 DOM 里 focus() 会把 activeElement 指过来。 */
  focus() {
    document.activeElement = this;
  }

  setSelectionRange(start, end) {
    this.selectionStart = start;
    this.selectionEnd = end;
  }

  click() { if (!this.disabled) this.fire('click'); }

  /** 触发一个事件（onclick 这类属性也一并触发）。 */
  fire(type = 'click', init = {}) {
    const event = { type, target: this, defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; }, stopPropagation() {}, ...init };
    for (const fn of this._listeners[type] ?? []) fn(event);
    const prop = this[`on${type}`];
    if (typeof prop === 'function') prop(event);
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

  querySelectorAll(sel) { return [...this.walk()].slice(1).filter((n) => n.matches(sel)); }

  matches(sel) {
    return sel.split(',').some((part) => {
      let ok = true;
      const plain = part.trim().replace(/\[([\w-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\]]*)))?\]/g, (_, name, quoted, single, bare) => {
        const value = quoted ?? single ?? bare;
        const actual = this.getAttribute(name);
        ok &&= actual !== null && (value === undefined || value === actual);
        return '';
      });
      const tag = /^[\w-]+/.exec(plain)?.[0];
      if (tag && tag.toUpperCase() !== this.tagName) return false;
      for (const [, prefix, token] of plain.matchAll(/([.#])([\w-]+)/g)) {
        if (prefix === '.' ? !this.classList.contains(token) : this.id !== token) return false;
      }
      return ok;
    });
  }

  closest(sel) { return this.matches(sel) ? this : this.parentElement?.closest(sel) ?? null; }

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

const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
const originalComputedStyle = Object.getOwnPropertyDescriptor(globalThis, 'getComputedStyle');
Object.defineProperty(globalThis, 'getComputedStyle', { configurable: true, writable: true, value: (node) => node.style ?? {} });
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

/**
 * 在菜单面板上点开某道菜的详情卡。
 *
 * 0.7.2 起菜单首屏只画 MENU_PAGE 张，「麻婆豆腐」不再保证一开始就在页面上——
 * 所以先搜一下把它筛出来，再点。搜不到就直接失败，别让后面的断言拿到 undefined.fire。
 */
async function openDishCard(root, name) {
  if (root.querySelector('.feast-detail-n')?.textContent.includes(name)) return;
  const find = () => root.querySelectorAll('.feast-card').find((c) => c.textContent.includes(name));
  if (!find()) {
    const search = root.findAll((n) => n.tagName === 'INPUT').find((i) => String(i.placeholder ?? '').includes('搜菜名'));
    assert.ok(search, '缺搜索框，没法把菜筛出来');
    search.value = name;
    search.fire('input');
    await waitFor(find, `搜出 ${name}`);
  }
  const card = find();
  assert.ok(card, `没找到 ${name} 那张卡`);
  card.fire('click');
}

// --------------------------------------------------------------------------
// 夹具
// --------------------------------------------------------------------------

// 各用例独立目录，并在用例失败时也卸载面板和恢复全局桩。
let panelSeq = 0;
const panelRun = await mkdtemp(join(tmpdir(), 'feed-world-panels-'));
const panelWorlds = [];
const activePanels = new Set();
const globals = ['window', 'localStorage'];
const restoreGlobal = (name, descriptor) => {
  if (descriptor) Object.defineProperty(globalThis, name, descriptor);
  else delete globalThis[name];
};
const setGlobal = (name, value) => Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
const endTurn = () => new Promise((resolve) => setImmediate(resolve));

function test(name, run) {
  registerTest(name, async () => {
    const previous = globals.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
    try { await run(); }
    finally {
      for (const panel of activePanels) panel.dispose();
      document.activeElement = null;
      Date.now = realTime;
      for (const [key, descriptor] of previous) restoreGlobal(key, descriptor);
    }
  });
}

function memoryStorage() {
  const values = new Map();
  const writes = [];
  return {
    values, writes,
    get length() { return values.size; },
    key(index) { return [...values.keys()][index] ?? null; },
    getItem(key) { return values.get(String(key)) ?? null; },
    setItem(key, value) { writes.push([String(key), String(value)]); values.set(String(key), String(value)); },
    removeItem(key) { values.delete(String(key)); },
    clear() { values.clear(); },
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

/** 给异步响应设置关卡，让测试明确控制先后顺序而不依赖 I/O 快慢。 */
function deferInvocations(matches) {
  const queue = [];
  return {
    queue,
    hook(call, next) {
      if (!matches(call)) return next();
      const gate = deferred();
      queue.push({ call, ...gate, next });
      return gate.promise;
    },
    async take(predicate, description) { return waitFor(() => queue.find(({ call }) => predicate(call)), description); },
  };
}

/**
 * 假钟：把 Date.now 接到一个可推进的 `{ now }` 上（面板每次走表都现读一次 Date.now，
 * 冻结成固定值的话，钟拨了它也不知道）。用完必须换回来。
 */
const realTime = Date.now;
function fakeClock(clock) {
  Date.now = () => clock.now;
  return () => { Date.now = realTime; };
}

async function mountPanels({ language = 'zh', failList = false, clock = null, cfg = {}, todayList = null, workHandler = null, workPolicyHandler = null, fillFreeHandler = null, persist = null, invokeHook = null, storage } = {}) {
  // 每个用例一个目录，整次运行还有 mkdtemp 隔离；最后统一清理。
  const dataDir = join(panelRun, String(panelSeq += 1));
  const world = new FeastWorld({
    cfg: { ...DEFAULTS, enabled: true, ...cfg },
    dataDir,
    persist,
    timezone: 'Asia/Shanghai',
    now: clock ? () => clock.now : () => Date.parse('2026-11-05T12:05:00+08:00'),
    random: () => 0.5,
    timers: { setInterval: () => 1, clearInterval() {}, setTimeout: () => 1 },
  });
  panelWorlds.push(world);
  await world.start({
    log: { info() {}, warn() {} },
    async pushEvent(e) { return { ...e, cursor: 1 }; },
  });
  const decl = world.webUi(language);

  const importBundle = () => import('../dist/webui.js?' + Math.random());
  const bundle = await importBundle();
  const root = new Node('div');
  Object.assign(root.style, { overflowY: 'auto' });
  Object.assign(root, { clientHeight: 400, scrollHeight: 2000 });
  const timeouts = [];
  const intervals = [];
  const invocations = [];
  const panels = { lastHandle: null };
  const configureStorage = () => {
    if (storage === undefined) return;
    setGlobal('localStorage', storage);
    setGlobal('window', { ...globalThis.window, localStorage: storage });
  };

  async function defaultInvoke(panelId, method, args) {
    if (failList && method === 'list') throw new Error('boom');
    if (panelId === 'today') {
      if (method === 'list' && todayList) {
        const result = await decl.invoke(panelId, method, args);
        return typeof todayList === 'function' ? todayList(result) : { ...result, ...todayList };
      }
      if (method === 'work' && workHandler) return workHandler(args[0] ?? {});
      if (method === 'workPolicy' && workPolicyHandler) return workPolicyHandler(args[0] ?? {});
      if (method === 'fillFree' && fillFreeHandler) return fillFreeHandler(args[0] ?? []);
      if (method === 'plan' && args[0]?.retry) return { ok: true };
      if (['thread', 'recovery'].includes(method)) return { ok: true };
    }
    return decl.invoke(panelId, method, args);
  }

  async function mount(panelId, { freshBundle = false } = {}) {
    panels.lastHandle?.dispose?.();
    configureStorage();
    root.replaceChildren();
    root.scrollTop = 0;
    document.activeElement = null;
    invocations.length = 0;
    const unsubscribed = new AbortController();
    const ctx = {
      pageId: 'world:feast', panelId, language, root, signal: unsubscribed.signal,
      timeout(fn, ms) {
        const entry = () => { if (!entry.disposed) { entry.disposed = true; return fn(); } };
        Object.assign(entry, { ms, disposed: false });
        timeouts.push(entry);
        return { dispose() { entry.disposed = true; } };
      },
      interval(fn, ms) {
        const entry = { fn, ms, disposed: false };
        intervals.push(entry);
        return { dispose() { entry.disposed = true; } };
      },
      async invoke(method, args = []) {
        const record = { panelId, method, args };
        invocations.push(record);
        const next = () => defaultInvoke(panelId, method, args);
        try {
          record.result = await (invokeHook ? invokeHook(record, next) : next());
          return record.result;
        } catch (error) {
          record.error = error;
          throw error;
        }
      },
    };
    const module = freshBundle ? await importBundle() : bundle;
    const handle = await module.default.panels[panelId].mount(ctx);
    const tracked = { dispose() {
      if (!activePanels.delete(tracked)) return;
      // 先调用面板自己的 dispose，随后才模拟宿主发出的 abort。
      try { handle?.dispose?.(); } finally { unsubscribed.abort(); }
    } };
    activePanels.add(tracked);
    panels.lastHandle = tracked;
    return root;
  }

  return { world, bundle, decl, mount, root, invocations, timeouts, intervals, panels };
}

function comboChips(root) {
  for (let guard = 0; guard < 40; guard += 1) {
    const more = root.querySelector('.feast-build')?.findAll((node) => node.tagName === 'BUTTON' && /再看 \d+ 道/.test(node.textContent))[0];
    if (!more) return root.querySelectorAll('.feast-chip');
    assert.equal(more.disabled, false, '分页入口应可点击');
    more.click();
  }
  throw new Error('套餐分页未能到达末页');
}

function changeFormOf(root) {
  const form = root.querySelector('.feast-today-controls')?.querySelectorAll('.feast-form')
    .find((node) => node.querySelectorAll('.feast-time').length === 2);
  assert.ok(form, '缺包含起止时间的改主意表单');
  return form;
}

function threadInputOf(root) {
  const block = root.querySelectorAll('.feast-block')
    .find((node) => node.querySelector('.feast-block-t')?.textContent === '她留下的线索');
  const input = block?.querySelector('input.feast-activity');
  assert.ok(input, '缺线索区的想法输入框');
  return input;
}

// --------------------------------------------------------------------------

test('bundle 形状对：面板 id 与服务端声明一一对上，mount 都是函数', async () => {
  const b = await import('../dist/webui.js');
  // 不写死面板数（不变式 3）：webUi() 声明了几个就要求客户端导出几个。
  // 面板 id 对不上不会报错，只会在宿主里点进去是一片空白——所以这条必须钉住。
  const { mount: _mount, decl } = await mountPanels();
  const declared = decl.panels.map((p) => p.id).sort();
  assert.deepEqual(Object.keys(b.default.panels).sort(), declared,
    `客户端导出的面板 ${Object.keys(b.default.panels).sort().join('、')} 与服务端声明的 ${declared.join('、')} 对不上`);
  for (const id of declared) {
    assert.equal(typeof b.default.panels[id].mount, 'function', `${id} 缺 mount`);
  }
  assert.ok(!Array.isArray(b.default.panels));
  assert.equal(b.default.panels.today, b.default.panels['today'], '按 panel id 取菜单导出，避免依赖列表位置');
});

test('菜单面板：挂载后拉到菜、画出首屏卡片、注入了样式', async () => {
  const { mount, invocations, world } = await mountPanels();
  const root = await mount('menu');
  assert.ok(invocations.some((call) => call.method === 'list' && call.result), '挂载后应读取列表并收到回执');
  assert.ok(root.querySelector('style'), '没注入样式');
  const cards = root.querySelectorAll('.feast-card');
  // 0.7.2 起首屏只画 MENU_PAGE 张，剩下的按「再看 N 道」加——
  // 800 道一次全画是 8000 多个节点，而一屏最多看十几张。所以这里钉的是「分页」不是「全画」。
  assert.ok(cards.length > 0, '一张卡都没画');
  assert.ok(cards.length < lib.dishes.length, `首屏不该把 ${lib.dishes.length} 道全画出来`);
  assert.ok(root.texts('feast-count')[0].includes(`共 ${lib.dishes.length} 道`));
  assert.ok(root.texts('feast-tag').length > 0, '标签没画出来');
  await world.stop();
});

test('菜单面板：首屏之后「再看 N 道」能把剩下的翻出来，翻到底按钮就没了', async () => {
  const { mount, world, panels } = await mountPanels();
  try {
    const root = await mount('menu');
    const first = root.querySelectorAll('.feast-card').length;
    assert.ok(first > 0 && first < lib.dishes.length);

    // 一路点到底。每点一次卡片只会变多，不会重拉（数据已经在手里）。
    for (let guard = 0; guard < 40; guard += 1) {
      const more = root.findAll((n) => n.tagName === 'BUTTON' && /再看 \d+ 道/.test(n.textContent));
      if (!more.length) break;
      more[0].fire('click');
      await new Promise((r) => setTimeout(r, 0));
    }
    assert.equal(root.querySelectorAll('.feast-card').length, lib.dishes.length,
      '翻到底应该把整库都画出来');
    assert.ok(!root.findAll((n) => n.tagName === 'BUTTON' && /再看 \d+ 道/.test(n.textContent)).length,
      '画完了就不该再留「再看」');
  } finally {
    panels.lastHandle?.dispose?.();
  }
  await world.stop();
});

test('菜单面板：换筛选会回到第一页', async () => {
  const { mount, world, panels } = await mountPanels();
  try {
    const root = await mount('menu');
    // 先翻一页
    root.findAll((n) => n.tagName === 'BUTTON' && /再看 \d+ 道/.test(n.textContent))[0].fire('click');
    await new Promise((r) => setTimeout(r, 0));
    const grown = root.querySelectorAll('.feast-card').length;

    // 再筛一个结果很少的条件：应该回到第一页，而不是带着上一次的分页位置。
    const selects = root.findAll((n) => n.tagName === 'SELECT');
    selects[1].value = '川菜';
    selects[1].fire('change');
    // 川菜 45 道，一页 60 张装得下，所以「再看」不该出现。
    await waitFor(() => root.querySelectorAll('.feast-card').length
      === lib.dishes.filter((d) => d.cuisine === '川菜').length, '筛出川菜');
    assert.ok(grown > 0);
    assert.equal(root.querySelectorAll('.feast-card').length,
      lib.dishes.filter((d) => d.cuisine === '川菜').length);
  } finally {
    panels.lastHandle?.dispose?.();
  }
  await world.stop();
});

test('菜单面板：点一张卡进详情，九维条、食材、实吃描写都在', async () => {
  const { mount, invocations, world } = await mountPanels();
  const root = await mount('menu');
  // 麻婆豆腐不一定落在首屏那 60 张里：先筛出来再点（openDishCard 会搜）。
  await openDishCard(root, '麻婆豆腐');
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
  await openDishCard(root, '麻婆豆腐');
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
  // 后续读取保留旧控件；要等新回执和菜系同步，不是只等下拉存在。
  await waitFor(() => last.result && root.findAll((n) => n.tagName === 'SELECT')[1]?.childNodes.filter((n) => n.tagName === 'OPTION' && n.value).length === soupCuisines.size, '最终筛选回执和菜系同步');
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

test('历史面板：「尝过的菜」是真实道数，不是「吃得最多的前 12 道」', async () => {
  const { mount, world } = await mountPanels();
  // 吃 20 道不重复的菜。服务端 top 被 slice(0, 12) 截过，
  // 面板要是拿 top.length 当计数，这里就会显示 12 而不是 20。
  const eat = world.tools().find((t) => t.name === 'feast_eat');
  const picks = lib.dishes.slice(0, 20);
  for (const d of picks) await eat.handler({ dish: d.name });

  const root = await mount('history');
  const values = root.texts('feast-stat-v');
  assert.ok(values.includes('20'), `尝过的菜该是 20，实际显示：${values.join(' / ')}`);
  assert.ok(!values.includes('12'), '别拿被截断的 top.length 当计数');
  // 「吃得最多」那一块还是最多 12 条（那是列表，不是计数）
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
  assert.ok(root.childNodes.some((node) => node.tagName !== 'STYLE'), '应该有内容容器');
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
    await openDishCard(root, '麻婆豆腐');
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
    await openDishCard(root, '麻婆豆腐');
    await waitFor(() => root.querySelector('.feast-detail'), '详情画出来');
    assert.ok(!root.findByText('我也吃这道'), '没在吃的时候不该有「我也吃这道」');
    assert.ok(!root.findByText('喂她一口'), '没在吃的时候不该有「喂她一口」');

    await world.inviteTogether();
    await mount('menu');
    await openDishCard(root, '麻婆豆腐');
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
    assert.ok(invocations.some((call) => call.method === 'list' && call.result), '挂载后应收到列表回执');
    const cards = root.querySelectorAll('.feast-set');
    assert.ok(cards.length >= 8, `预设该画出 8 张：${cards.length}`);
    const text = cards.map((c) => c.textContent).join('\n');
    assert.ok(text.includes('四菜一汤'), '缺四菜一汤那张');
    assert.ok(text.includes('清爽一餐'), '缺清爽一餐那张');
    // 每张卡都该有「端这一桌」和「换一桌」。
    assert.ok(root.findByText('端这一桌'), '缺端这一桌按钮');
    assert.ok(root.findByText('换一桌'), '缺换一桌按钮');
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
test('套餐面板：不先点「换一桌」，直接端也是卡上列的那几道', async () => {
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

test('套餐面板：点过「换一桌」之后再端，端的是重配后卡上显示的那一桌', async () => {
  const { mount, invocations, world, panels } = await mountPanels();
  try {
    const root = await mount('combo');
    const card = () => root.querySelectorAll('.feast-set').find((c) => c.textContent.includes('清爽一餐'));
    const withSeeds = () => invocations.filter((i) => i.method === 'list' && i.args?.[0]?.seeds).length;
    const before = withSeeds();
    assert.ok(before > 0, '一挂载就该带种子拉过一次数据');

    card().findByText('换一桌').click();
    await waitFor(() => {
      const latest = latestCall(invocations, 'list')?.result;
      const expected = latest?.presets?.find((entry) => entry.id === 'light-meal')?.dishes?.map((dish) => dish.name);
      const rendered = card()?.querySelector('.feast-set-dishes')?.querySelectorAll('span').map((node) => node.textContent);
      return withSeeds() > before && expected?.length && JSON.stringify(rendered) === JSON.stringify(expected)
        && card().findByText('换一桌')?.disabled === false;
    }, '按新种子画出预览后的卡');

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
      const chip = comboChips(root).find((c) => c.textContent.includes(name));
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
    const chips = () => comboChips(root);
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
    // 0.7.2 起首屏只画 MENU_PAGE 张，所以这里不再是 800；要断言的是「一页正经的卡」。
    assert.ok(allCount > 10, '先确认首屏卡片在');

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
    const chip = comboChips(root).find((c) => c.textContent.includes('麻婆豆腐'));
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
    const chips = () => comboChips(root);
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
    comboChips(root).find((c) => c.textContent.includes('腌笃鲜')).fire('click');
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
    const chips = () => comboChips(root);
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

// --------------------------------------------------------------------------
// 今天面板（她的一天）
// --------------------------------------------------------------------------

/**
 * 今天面板要靠服务端已经有今天的日程。启动时 #lifeEnsure 会用模板兜底落一天，
 * 但这条路径依赖「今天没有文件」；每个用例一个独立目录，所以天然满足。
 */
test('今天首页：摘要区分计划与事实，线程和存储操作调用新契约', async () => {
  const { mount, world, panels, root, invocations } = await mountPanels({ todayList: {
    actual: [{ at: 1, hm: '11:30', kind: 'meal', text: '午饭', note: '一起吃' }],
    upcoming: [{ start: '13:00', activity: '散步' }],
    pending: { name: '水果' }, together: { invite: { at: 1 } },
    planRetryAvailable: false,
    storageIssues: [{ key: 'state', label: '状态文件', status: 'error', message: '读取失败', backupAvailable: true }],
    threads: { items: [{ id: 'th-1', text: '买花', sourceDate: '2026-11-05', sourceActivity: '路过花店', source: 'coo', status: 'active' }] },
  } });
  try {
    await mount('today');
    assert.ok(root.textContent.includes('今天留下的事'));
    assert.ok(root.textContent.includes('午饭') && root.textContent.includes('一起吃'));
    assert.ok(root.textContent.includes('她邀请你一起吃饭'));
    assert.ok(root.textContent.includes('这是计划，不代表事情已经发生'));
    assert.ok(root.textContent.includes('水果') || root.textContent.includes('有一份餐点'));
    assert.ok(root.textContent.includes('她留下: 买花'));
    const threadInput = threadInputOf(root);
    assert.ok(threadInput && threadInput.tagName === 'INPUT', '缺想法输入框');
    assert.equal(threadInput.maxLength, 120, '想法输入框仍须保留 120 字上限');
    threadInput.value = '周末买花'; threadInput.fire('input');
    root.findByText('记下想法').fire('click');
    await waitFor(() => invocations.some((i) => i.method === 'thread'), '新增 thread 调用');
    assert.deepEqual(invocations.find((i) => i.method === 'thread').args, [{ text: '周末买花' }]);
    await waitFor(() => invocations.filter((i) => i.method === 'list').length >= 2 && latestCall(invocations, 'list')?.result, '新增 thread 后刷新回执');
    await endTurn();
    const reload = root.findByText('重新读取');
    reload.fire('click');
    await waitFor(() => latestCall(invocations, 'recovery')?.result?.ok && invocations.filter((i) => i.method === 'list').length >= 3 && latestCall(invocations, 'list')?.result, '重新读取最终回执');
    await endTurn();
    assert.deepEqual(invocations.find((i) => i.method === 'recovery').args, [{ key: 'state', action: 'reload' }]);
    const restore = root.findByText('从备份恢复');
    assert.ok(restore, '有备份时应显示恢复按钮');
    const savedWindow = globalThis.window;
    globalThis.window = { ...(savedWindow ?? {}), confirm: () => true };
    restore.fire('click');
    await waitFor(() => invocations.filter((i) => i.method === 'recovery').length > 1, '备份恢复调用');
    assert.deepEqual(invocations.filter((i) => i.method === 'recovery').at(-1).args, [{ key: 'state', action: 'restore' }]);
    if (savedWindow) globalThis.window = savedWindow; else delete globalThis.window;
  } finally { panels.lastHandle?.dispose?.(); }
  await world.stop();
});

test('今天面板：thread 完成与搁下、pending 重发走正确动作', async () => {
  const { mount, world, panels, root, invocations } = await mountPanels({ todayList: {
    tomorrow: { date: '2026-11-06', source: 'pending', items: [] },
    planRetryAvailable: true,
    threads: { items: [
      { id: 'a', text: '读书', sourceDate: '2026-11-05', source: 'owner', status: 'active' },
      { id: 'b', text: '散步', sourceDate: '2026-11-05', source: 'coo', status: 'active' },
    ] },
  } });
  const savedWindow = globalThis.window;
  globalThis.window = { ...(savedWindow ?? {}), confirm: () => true };
  try {
    await mount('today');
    assert.ok(root.findAll((n) => n.tagName === 'BUTTON' && n.textContent.includes('已经跟她说了')).length, '空 items 的 pending 仍应被识别');
    assert.ok(root.findByText('重新发送'), '10 分钟后才有的重发动作应显示');
    root.findByText('重新发送').fire('click');
    await waitFor(() => invocations.find((i) => i.method === 'plan' && i.args[0]?.retry)?.result?.ok
      && invocations.filter((i) => i.method === 'list').length >= 2 && latestCall(invocations, 'list')?.result, 'plan retry 和刷新回执');
    await endTurn();
    assert.deepEqual(invocations.find((i) => i.method === 'plan' && i.args[0]?.retry).args, [{ retry: true }]);
    root.findByText('完成').fire('click');
    await waitFor(() => invocations.find((i) => i.method === 'thread' && i.args[0]?.status === 'done')?.result?.ok
      && invocations.filter((i) => i.method === 'list').length >= 3 && latestCall(invocations, 'list')?.result, 'thread done 与刷新回执');
    await endTurn();
    const drop = root.findByText('搁下');
    assert.ok(drop, '第二条活跃 thread 应仍可操作');
    drop.fire('click');
    await waitFor(() => invocations.some((i) => i.method === 'thread' && i.args[0]?.status === 'dropped'), 'thread dropped 调用');
  } finally {
    if (savedWindow) globalThis.window = savedWindow; else delete globalThis.window;
    panels.lastHandle?.dispose?.();
  }
  await world.stop();
});

test('今天面板：画出今天的时间线和「此刻」，此刻那一段被点亮', async () => {
  const clock = { now: Date.parse('2026-11-05T12:05:00+08:00') };
  const { mount, invocations, world, panels } = await mountPanels({ clock });
  try {
    const root = await mount('today');
    assert.ok(invocations.some((i) => i.method === 'list'), '没拉 list');
    assert.ok(root.querySelector('style'), '没注入样式');

    // 时间线展开后覆盖到 00:00 和 24:00（模板一天的首尾）。
    expandTimeline(root);
    const rows = root.querySelectorAll('.feast-tl-row');
    assert.ok(rows.length > 2, `时间线只有 ${rows.length} 段`);
    assert.ok(rows.some((r) => r.textContent.includes('00:00')));
    assert.ok(rows.some((r) => r.textContent.includes('24:00')));

    // 「此刻」那一条：12:05 落在吃午饭（模板上班日 12:00–13:00）。
    const current = root.querySelectorAll('.feast-stat-v')[0];
    assert.ok(current, '缺「此刻」摘要');
    assert.ok(current.textContent.includes('12:05'), `此刻摘要没报当前时刻：${current.textContent}`);
    assert.ok(current.textContent.includes('吃午饭'), `此刻摘要没落到午饭那段：${current.textContent}`);

    // 点亮的是那一段，且只有一段。
    const lit = root.querySelectorAll('.feast-tl-row.is-now');
    assert.equal(lit.length, 1, `该点亮一段，点亮了 ${lit.length} 段`);
    assert.ok(lit[0].textContent.includes('吃午饭'));
    // 早于此刻的段被压暗。
    assert.ok(root.querySelectorAll('.feast-tl-row.is-past').length > 0, '过去的段没压暗');

    // 今天和明天各有独立标题；标题不依赖折叠时间线内的日程详情。
    assert.equal(root.querySelector('[data-ux-island="timeline"]').querySelector('.feast-combo-h').textContent, '今天');
    assert.equal(root.querySelector('[data-ux-island="tomorrow"]').querySelector('.feast-combo-h').textContent, '明天');
  } finally {
    panels.lastHandle?.dispose?.();
  }
  await world.stop();
});

test('今天面板：她已经写好明天时，按钮变成「请她重新想想」而不是抹掉重来', async () => {
  const clock = { now: Date.parse('2026-11-05T21:30:00+08:00') };
  const { mount, invocations, world, panels } = await mountPanels({ clock });
  try {
    // 先让她真写好明天（走工具，和服务端那条路一致）。
    const plan = world.tools().find((tool) => tool.name === 'feast_life_plan');
    await plan.handler({
      date: 'tomorrow',
      title: '写好的明天',
      items: [
        { start: '00:00', end: '08:00', activity: '睡觉' },
        { start: '08:00', end: '12:00', activity: '她认真写的上午' },
        { start: '12:00', end: '24:00', activity: '她认真写的下午' },
      ],
    });

    const root = await mount('today');
    assert.ok(root.textContent.includes('她认真写的上午'), '面板上该能看到她写的明天');
    // 0.7.2：这时候不能再挂「请她写明天」——那一下会把写好的明天清空（服务端已修，
    // 面板这一层也不该再让人误以为可以随便点）。
    assert.ok(!root.findByText('请她写明天'), '已经写好了就不该还是「请她写明天」');
    assert.ok(root.findByText('请她重新想想'), '该换成「请她重新想想」');

    // 点它：要二次确认（测试里 window.confirm 默认没有，所以这里先补一个）
    const calls = [];
    const realConfirm = globalThis.window?.confirm;
    globalThis.window = { ...(globalThis.window ?? {}), confirm: (msg) => { calls.push(msg); return true; } };
    try {
      root.findByText('请她重新想想').fire('click');
      await waitFor(() => invocations.some((i) => i.method === 'plan'), '调了 plan');
      assert.equal(calls.length, 1, '该先问一句再动手');
    } finally {
      if (realConfirm) globalThis.window.confirm = realConfirm;
      else delete globalThis.window;
    }
    // 她写好的内容不能因为点了一下就没了。
    await waitFor(() => root.textContent.includes('她认真写的上午'), '她的明天还在', 3000);
  } finally {
    panels.lastHandle?.dispose?.();
  }
  await world.stop();
});

test('今天面板：点时间线某一段，起止和活动名自动填进改主意表单', async () => {
  const clock = { now: Date.parse('2026-11-05T12:05:00+08:00') };
  const { mount, world, panels } = await mountPanels({ clock });
  try {
    const root = await mount('today');
    expandTimeline(root);
    const rows = root.querySelectorAll('.feast-tl-row');
    assert.ok(rows.length > 0, '缺时间线');
    // 找一行不是「此刻」的，免得和点亮那条混在一起
    const row = rows.find((r) => !r.classList.contains('is-past')) ?? rows[0];
    const label = row.querySelector('.feast-tl-t').textContent;
    const activity = row.querySelector('.feast-tl-a').textContent;
    row.fire('click');

    const form = changeFormOf(root);
    const inputs = form.findAll((n) => n.tagName === 'INPUT');
    const [startIn, endIn] = inputs;
    const actIn = inputs.at(-1);
    const [s, e] = label.split('–');
    assert.equal(startIn.value, s, '起始时间该填进去');
    assert.equal(endIn.value, e, '结束时间该填进去');
    assert.ok(actIn.value && activity.includes(actIn.value), `活动名该填进去：${actIn.value}`);
  } finally {
    panels.lastHandle?.dispose?.();
  }
  await world.stop();
});

test('今天面板：时间线使用 displayCategory，调整表单可清除分类且不推断分类', async () => {
  const clock = { now: Date.parse('2026-11-05T12:05:00+08:00') };
  const { mount, world, panels, invocations } = await mountPanels({ clock, todayList: (base) => ({
    ...base,
    today: { ...base.today, items: base.today.items.map((item, i) => ({ ...item, category: i === 0 ? 'manual-original' : undefined, displayCategory: i === 0 ? 'work' : undefined })) },
  }) });
  try {
    const root = await mount('today');
    expandTimeline(root);
    const row = root.querySelectorAll('.feast-tl-row').find((r) => r.getAttribute('data-category') === 'work');
    assert.ok(row, '应从服务端 displayCategory 标记分类');
    assert.ok(row.querySelector('.feast-category')?.textContent.includes('工作'));
    assert.equal(root.querySelectorAll('.feast-tl-row').some((r) => r.attributes['data-category'] === 'sleep'), false,
      'displayCategory 缺失时不应从 activity/category 推断');
    row.fire('click');
    const form = changeFormOf(root);
    const select = form.findAll((n) => n.tagName === 'SELECT')[0];
    assert.ok(select, '编辑表单缺分类选择');
    assert.equal(select.value, 'manual-original', '编辑仍使用原 category 而不是 displayCategory');
    select.value = '';
    form.findAll((n) => n.tagName === 'BUTTON')[0].fire('click');
    await waitFor(() => invocations.some((i) => i.method === 'adjust'), 'adjust 调用');
    assert.equal(invocations.filter((i) => i.method === 'adjust').at(-1).args[0].category, '', '空分类应传空值清除');
  } finally { panels.lastHandle?.dispose?.(); }
  await world.stop();
});

test('今天面板：饭点画进了时间线（到点的段上挂着「饭点 HH:MM」）', async () => {
  const clock = { now: Date.parse('2026-11-05T12:05:00+08:00') };
  const { mount, world, panels } = await mountPanels({ clock });
  try {
    const root = await mount('today');
    expandTimeline(root);
    const marks = root.texts('feast-meal');
    const slots = parseSlots(DEFAULTS.mealSlots).map((s) => s.hm);
    assert.ok(marks.length >= slots.length,
      `三顿饭应该各挂一个标，现在只有 ${marks.length} 个：${marks.join('、')}`);
    for (const hm of slots) {
      assert.ok(marks.some((m) => m.includes(hm)), `时间线上找不到 ${hm} 这一档：${marks.join('、')}`);
    }
  } finally {
    panels.lastHandle?.dispose?.();
  }
  await world.stop();
});

test('今天面板：明天标题始终在状态之前，折叠、刷新和中英文都不混入今天', async () => {
  for (const language of ['zh', 'en']) {
    let tomorrow = null;
    const setup = await mountPanels({ language, todayList: (base) => ({ ...base, tomorrow }) });
    const label = language === 'en' ? 'Tomorrow' : '明天';
    const expand = language === 'en' ? 'Expand full timeline' : '展开完整时间线';
    const collapse = language === 'en' ? 'Collapse full timeline' : '收起完整时间线';
    try {
      const root = await setup.mount('today');
      const verify = () => {
        const section = root.querySelector('[data-ux-island="tomorrow"]');
        const heading = section.firstChild;
        const status = section.querySelector('.feast-tomorrow-state');
        const body = section.childNodes.at(-1);
        assert.equal(heading.textContent, label, '状态前应有独立的明天标题');
        assert.ok(section.childNodes.indexOf(heading) < section.childNodes.indexOf(status));
        assert.equal(body.hidden, true, '时间线默认折叠');
        assert.equal(body.contains(heading), false, '折叠不能把明天标题藏起来');
        section.findByText(expand).click();
        assert.equal(body.hidden, false);
        assert.equal(section.findAll((node) => node.textContent === label).length, 1, '展开后不重复明天标题');
        section.findByText(collapse).click();
        assert.equal(body.hidden, true);
        assert.equal(section.firstChild, heading);
        return status.querySelector('.feast-flag').textContent;
      };
      assert.equal(verify(), language === 'en' ? 'Not generated yet' : '尚未生成');
      for (const next of [
        { ...templateDay('2026-11-06'), source: 'pending', items: [] },
        templateDay('2026-11-06'),
      ]) {
        tomorrow = next;
        const previous = root.querySelector('[data-ux-island="tomorrow"]');
        setup.intervals.find(({ ms }) => ms === 60_000).fn();
        await waitFor(() => root.querySelector('[data-ux-island="tomorrow"]') !== previous, '明天来源变化后局部刷新');
        verify();
      }
      assert.equal(setup.invocations.some(({ method }) => method === 'plan'), false, '展开与收起不触发写计划');
    } finally { setup.panels.lastHandle?.dispose?.(); await setup.world.stop(); }
  }
});

test('今天面板：点「请她写明天」会调 plan，并把明天的来源变成「等她写」', async () => {
  const clock = { now: Date.parse('2026-11-05T21:30:00+08:00') };
  const { mount, invocations, world, panels } = await mountPanels({ clock });
  try {
    const root = await mount('today');
    // 21:30 已经过了 lifeGenerateAt（22:00 之前，所以启动不会自动推）——
    // 先确认没有明天，再手点，免得测的是自动流程而不是这个按钮。
    const ask = root.findByText('请她写明天');
    assert.ok(ask, '缺「请她写明天」按钮');
    ask.fire('click');

    await waitFor(() => invocations.some((i) => i.method === 'plan'), '调了 plan');
    // 推完会 refresh 一次，明天的来源该显示成「等她写」。
    await waitFor(() => root.querySelectorAll('.feast-flag')
      .some((f) => f.textContent.includes('等她写')), '明天的来源变成等她写', 3000);
    // 「等她写」是空壳，别有 items——空壳下面不该画时间线。
    assert.ok(root.textContent.includes('这一天她还没想好怎么过'), '空壳没给说明');
  } finally {
    panels.lastHandle?.dispose?.();
  }
  await world.stop();
});

test('今天面板：临时改主意会带上日期和时间段调 adjust，改完时间线跟着变', async () => {
  const clock = { now: Date.parse('2026-11-05T12:05:00+08:00') };
  const { mount, invocations, world, panels } = await mountPanels({ clock });
  try {
    const root = await mount('today');
    const form = changeFormOf(root);
    assert.ok(form, '缺改主意表单');
    const [startIn, endIn] = form.findAll((n) => n.tagName === 'INPUT');
    const actIn = form.findAll((n) => n.tagName === 'INPUT').at(-1);
    startIn.value = '20:00';
    endIn.value = '21:00';
    actIn.value = '下楼买布丁';
    form.findAll((n) => n.tagName === 'BUTTON')[0].fire('click');

    await waitFor(() => invocations.some((i) => i.method === 'adjust'), '调了 adjust');
    const call = invocations.filter((i) => i.method === 'adjust').pop();
    assert.equal(call.args[0].start, '20:00');
    assert.equal(call.args[0].end, '21:00');
    assert.equal(call.args[0].activity, '下楼买布丁');
    assert.equal(call.args[0].date, '2026-11-05', '得带上改的是哪一天');

    expandTimeline(root);
    // 「下楼买布丁」这句话在 toast 里就已经有了，等它等于测了个假的——
    // 要等的是**时间线里**多出这一段。
    await waitFor(() => root.querySelectorAll('.feast-tl-row')
      .some((r) => r.textContent.includes('下楼买布丁')), '改完时间线里出现新安排', 3000);
    assert.equal(invocations.filter((i) => i.method === 'list').length >= 2, true, '改完没重拉 list');
  } finally {
    panels.lastHandle?.dispose?.();
  }
  await world.stop();
});

test('今天面板：「做什么」留空 = 不做了，真的会把那一段取消掉', async () => {
  const clock = { now: Date.parse('2026-11-05T12:05:00+08:00') };
  const { mount, invocations, world, panels } = await mountPanels({ clock });
  try {
    const root = await mount('today');
    expandTimeline(root);
    // 取消 20:00–23:00：「自己的时间」那一段被吃掉，时间线里不该再有一个横跨 20 点后的它。
    const before = root.querySelectorAll('.feast-tl-row')
      .filter((r) => r.textContent.includes('自己的时间'));
    assert.ok(before.length, '模板上班日里没有「自己的时间」，这条测试的前提变了');

    const form = changeFormOf(root);
    const inputs = form.findAll((n) => n.tagName === 'INPUT');
    inputs[0].value = '20:00';
    inputs[1].value = '23:00';
    // 最后一格（做什么）故意留空
    form.findAll((n) => n.tagName === 'BUTTON')[0].fire('click');

    await waitFor(() => invocations.some((i) => i.method === 'adjust'), '调了 adjust');
    // 空 activity 要原样传过去，不能在前端就被拦下或被替换成占位字。
    assert.equal(invocations.filter((i) => i.method === 'adjust').pop().args[0].activity, '');

    // 别用「段数变少」判断：取消会把一段截短，截出来的残余段和吃掉的那段数量可能正好抵消
    // （19:45–23:00 的「自己的时间」被挖掉 20:00–23:00 后剩 19:45–20:00）。
    await waitFor(() => !root.querySelectorAll('.feast-tl-row')
      .some((r) => r.textContent.includes('自己的时间') && r.textContent.includes('23:00')),
    '取消后那一段不该再横到 23:00', 3000);

    const rows = root.querySelectorAll('.feast-tl-row');
    assert.ok(rows.length > 0);
    assert.ok(rows[0].textContent.includes('00:00'), '取消后没从 00:00 开始');
    assert.ok(rows.at(-1).textContent.includes('24:00'), '取消后没排到 24:00');
    // 取消后时间线仍然首尾相接，不能留空档。
    const spans = rows.map((r) => r.textContent);
    assert.ok(spans.some((s) => s.includes('20:00')), '20:00 之后应该由后一段接上');
  } finally {
    panels.lastHandle?.dispose?.();
  }
  await world.stop();
});

test('今天面板：关掉 lifeEnabled 时给一句说明，不硬画时间线', async () => {
  const clock = { now: Date.parse('2026-11-05T12:05:00+08:00') };
  const { mount, world, panels } = await mountPanels({ clock, cfg: { lifeEnabled: false } });
  try {
    const root = await mount('today');
    assert.ok(root.textContent.includes('关着'), `关掉时该有说明：${root.textContent.slice(0, 120)}`);
    assert.equal(root.querySelectorAll('.feast-tl-row').length, 0, '关掉时不该画时间线');
  } finally {
    panels.lastHandle?.dispose?.();
  }
  await world.stop();
});

test('今天面板：往期调用 review，计划与实际记录分区展示，收起可用', async () => {
  const clock = { now: Date.parse('2026-11-05T12:05:00+08:00') };
  const { mount, invocations, world, panels } = await mountPanels({ clock });
  try {
    const day = templateDay('2026-11-03', { now: clock.now, dayTypeId: 'restday' });
    day.title = '往期计划标题';
    day.items[0].activity = '计划去看海';
    await writeDay(world.dataDir, day);
    await writePlay(world.dataDir, { ...newPlay(day.date), done: [
      { at: Date.parse('2026-11-03T10:00:00+08:00'), activity: '实际在窗边读书', note: '读到第三章' },
    ] });
    const root = await mount('today');
    const past = root.querySelectorAll('.feast-item.is-click');
    assert.equal(past.length, 1, '独立夹具中写入的往期必须出现，不能跳过断言');
    past[0].fire('click');
    await waitFor(() => root.querySelector('.feast-seen')?.querySelector('.feast-journal'), '往期回顾展开');
    assert.deepEqual(invocations.find((i) => i.method === 'review').args, ['2026-11-03']);
    assert.ok(!invocations.some((i) => i.method === 'day'), '新回顾不应调用旧 day 接口');
    const seen = root.querySelector('.feast-seen');
    const actual = seen.querySelector('.feast-journal');
    assert.ok(seen.querySelectorAll('.feast-tl-row').some((row) => row.textContent.includes('计划去看海')));
    assert.ok(seen.querySelector('.feast-day').textContent.includes('往期计划标题'));
    assert.equal(actual.querySelectorAll('.feast-actual-row').length, 1);
    assert.ok(actual.textContent.includes('实际在窗边读书') && actual.textContent.includes('读到第三章'));
    assert.ok(!actual.textContent.includes('计划去看海'), '不能把日程安排冒充实际记录');
    assert.ok(actual.textContent.includes('日程仍然只是打算'));
    returnToday(root);
    await waitFor(() => root.querySelector('.feast-seen') === null && root.querySelector('.feast-current-plan'), '收起历史并回今天');
  } finally { panels.lastHandle?.dispose?.(); await world.stop(); }
});

test('今天面板：画出「她自己的时间」那一块（记了几件、下一档、做过什么）', async () => {
  const clock = { now: Date.parse('2026-11-05T21:02:00+08:00') };
  const { mount, world, panels } = await mountPanels({ clock, cfg: { lifeFreeSlots: '21:00,22:00' } });
  try {
    // 先记一笔，面板才该显示出今天做过什么。
    const tools = Object.fromEntries(world.tools().map((x) => [x.name, x.handler]));
    await tools.feast_life_play({ activity: '出去走走', note: '看见一只三花猫' });

    const root = await mount('today');
    const block = root.querySelectorAll('.feast-block').find((b) => b.textContent.includes('她自己的时间'));
    assert.ok(block, '没有「她自己的时间」那一块');
    assert.ok(/今天记了 1 件/.test(block.textContent), `没显示记了几件：${block.textContent.slice(0, 120)}`);
    // 0.8.0 删了「记到几件就不再叫」：面板不该再有那条线，也不该有「在等她记」。
    assert.ok(!/不再按点叫|已到数|在等她记/.test(block.textContent), `还在画配额那一套：${block.textContent.slice(0, 200)}`);
    assert.ok(!/还差 \d+ 件/.test(block.textContent), `面板写成了任务额度：${block.textContent.slice(0, 160)}`);
    assert.ok(block.textContent.includes('下一档'), '没显示下一档');
    assert.ok(block.textContent.includes('出去走走'), '没显示她做过什么');
    assert.ok(block.textContent.includes('看见一只三花猫'), '没显示那笔的细节');
    // 提示语要说清单只是举例。
    assert.ok(/只是例子/.test(block.textContent), '没说明单子只是举例');
  } finally {
    panels.lastHandle?.dispose?.();
  }
  await world.stop();
});

test('今天面板：只在有可填空档时显示主动补充，点击仅调用 fillFree', async () => {
  const clock = { now: Date.parse('2026-11-05T12:05:00+08:00') };
  let requestCount = 0;
  const { mount, world, panels, invocations } = await mountPanels({ clock,
    todayList: { freePlanSlots: [], fillFreeAvailable: false, fillFreePending: false },
    fillFreeHandler: async (args) => { requestCount += 1; return { ok: true }; },
  });
  try {
    let root = await mount('today');
    assert.ok(!root.findByText('请她想想空出来的时间'), '无时段时不要显示误导按钮');
    await mount('today');
  } finally { panels.lastHandle?.dispose?.(); }
  await world.stop();

  const available = await mountPanels({ clock,
    todayList: { freePlanSlots: [{ start: '13:00', end: '14:00' }], fillFreeAvailable: true, fillFreePending: false },
    fillFreeHandler: async (args) => { requestCount += 1; assert.deepEqual(args, []); return { ok: true }; },
  });
  try {
    const root = await available.mount('today');
    const button = root.findByText('请她想想空出来的时间');
    assert.ok(button, '有可填时段应显示主动补充');
    button.fire('click');
    await waitFor(() => available.invocations.some((i) => i.method === 'fillFree'), '调用 fillFree');
    assert.deepEqual(available.invocations.filter((i) => i.method === 'fillFree')[0].args, []);
    assert.equal(requestCount, 1, '只有用户点击后才能请求');
  } finally { available.panels.lastHandle?.dispose?.(); await available.world.stop(); }
});

test('今天面板：自由时间关着时只说一句，不硬画进度', async () => {
  const clock = { now: Date.parse('2026-11-05T12:05:00+08:00') };
  const { mount, world, panels } = await mountPanels({ clock, cfg: { lifeFreeEnabled: false } });
  try {
    const root = await mount('today');
    const block = root.querySelectorAll('.feast-block').find((b) => b.textContent.includes('她自己的时间'));
    assert.ok(block, '缺自由时间那一块');
    assert.ok(block.textContent.includes('关着'), `关着时该有说明：${block.textContent.slice(0, 100)}`);
  } finally {
    panels.lastHandle?.dispose?.();
  }
  await world.stop();
});

test('今天面板：关闭上班先显示对照，确认时提交预览版本并支持撤销', async () => {
  const clock = { now: Date.parse('2026-11-05T12:05:00+08:00') };
  const { mount, world, panels, invocations } = await mountPanels({ clock });
  try {
    const root = await mount('today');
    const block = root.querySelectorAll('.feast-block').find((b) => b.textContent.includes('上不上班（持续生效）'));
    assert.ok(block, '没有长期工作排程那一块');
    // 长期控制与日期作用域不同：今天的调整藏在 details 中。
    const daily = block.querySelector('.feast-work-daily');
    assert.ok(daily, '缺「仅修改今天的安排」折叠区');
    daily.open = true; // 简易 DOM 不模拟原生 details 展开，测试显式打开
    daily.fire('toggle');
    const onBtn = daily.findByText('今天照原安排上班');
    const offBtn = daily.findByText('今天不上班（仅今天）');
    assert.ok(onBtn && offBtn, `两个按日按钮没画全：${daily.textContent.slice(0, 120)}`);
    assert.equal(onBtn.disabled, true, '当前状态那个键该是禁用的（不然点了没变化，像没反应）');
    offBtn.fire('click');
    await waitFor(() => root.querySelector('.feast-work-preview'), '面板内显示预览对照');
    assert.ok(root.querySelector('.feast-work-preview').textContent.includes('当前安排'));
    assert.ok(root.querySelector('.feast-work-preview').textContent.includes('家'), '自由安排应显示居家地点而不是公司');
    assert.equal(invocations.filter((i) => i.method === 'work').length, 1, '预览阶段不应提交修改');
    root.findByText('取消').fire('click');
    assert.ok(!root.querySelector('.feast-work-preview'), '取消应关闭预览');
    const reopenedDaily = root.querySelector('.feast-work-daily');
    assert.ok(reopenedDaily?.open, '预览取消后按日详情仍应展开');
    reopenedDaily.findByText('今天不上班（仅今天）').fire('click');
    await waitFor(() => root.querySelector('.feast-work-preview'), '重新打开预览');
    root.findByText('确认今天不上班').fire('click');
    await waitFor(() => invocations.filter((i) => i.method === 'work').length >= 2, '确认后提交');
    const calls = invocations.filter((i) => i.method === 'work');
    const previews = calls.filter((i) => i.args[0].action === 'preview');
    const submit = calls.find((i) => i.args[0].action !== 'preview' && i.args[0].action !== 'undo');
    assert.equal(previews.length, 2, '取消后重开应重新预览');
    assert.equal(submit.args[0].revision, previews.at(-1).result.revision, '提交必须携带最近预览返回的 revision');
    await waitFor(() => Boolean(root.findByText('撤销关闭上班')), '显示撤销');
    root.findByText('撤销关闭上班').fire('click');
    await waitFor(() => invocations.some((i) => i.method === 'work' && i.args[0].action === 'undo'), '执行撤销');
  } finally {
    panels.lastHandle?.dispose?.();
    await world.stop();
  }
});

test('今天面板：预览后日程变化时 revision 拒绝关闭并清除旧预览', async () => {
  const clock = { now: Date.parse('2026-11-05T12:05:00+08:00') };
  const { mount, world, panels, invocations } = await mountPanels({ clock });
  try {
    const root = await mount('today');
    const ui = world.webUi('zh');
    const daily = root.querySelector('.feast-work-daily'); daily.open = true; daily.fire('toggle');
    daily.findByText('今天不上班（仅今天）').fire('click');
    await waitFor(() => root.querySelector('.feast-work-preview'), '预览显示');
    await ui.invoke('today', 'adjust', [{ date: '2026-11-05', start: '19:00', end: '20:00', activity: '后来新增' }]);
    root.findByText('确认今天不上班').fire('click');
    await waitFor(() => invocations.filter((i) => i.method === 'work').some((i) => i.args[0].action !== 'preview' && i.args[0].action !== 'undo'), '过期 revision 提交被拒绝');
    await waitFor(() => !root.querySelector('.feast-work-preview'), '过期预览清除');
    const calls = invocations.filter((i) => i.method === 'work');
    const preview = calls.find((i) => i.args[0].action === 'preview');
    const submit = calls.find((i) => i.args[0].action !== 'preview' && i.args[0].action !== 'undo');
    assert.equal(calls.length, 2);
    assert.equal(submit.args[0].revision, preview.result.revision);
    assert.ok(root.querySelector('.feast-toast')?.textContent.includes('日程已经变化'));
    const latest = await (await world.webUi('zh')).invoke('today', 'list', []);
    assert.equal(latest.work, true, '并发修改后仍保持上班状态');
  } finally { panels.lastHandle?.dispose?.(); await world.stop(); }
});

test('今天面板：不上班的日子，按钮翻到「不上班」那一侧', async () => {
  const clock = { now: Date.parse('2026-11-05T12:05:00+08:00') };
  const { mount, world, panels } = await mountPanels({ clock });
  try {
    await writeDay(world.dataDir, templateDay('2026-11-05', { now: clock.now, work: false, dayTypeId: 'restday' }));
    const root = await mount('today');
    const block = root.querySelectorAll('.feast-block').find((b) => b.textContent.includes('上不上班（持续生效）'));
    assert.ok(block, '没有「今天上不上班」那一块');
    const daily = block.querySelector('.feast-work-daily');
    assert.equal(daily.findByText('今天不上班（仅今天）').disabled, true);
    assert.equal(daily.findByText('今天照原安排上班').disabled, false);
    assert.equal(block.findByText('开启长期工作排程').disabled, true, '单日不上班不改变长期排程规则');
    assert.equal(block.findByText('关闭长期工作排程').disabled, false);
  } finally {
    panels.lastHandle?.dispose?.();
  }
  await world.stop();
});

test('今天面板：说明今天是「她定的饭点」还是「配置的饭点」', async () => {
  const clock = { now: Date.parse('2026-11-05T12:05:00+08:00') };
  const first = await mountPanels({ clock });
  try {
    await writeDay(first.world.dataDir, templateDay('2026-11-05', {
      now: clock.now, dayTypeId: 'workday', mealSlots: ['12:30', '19:40'],
    }));
    const root = await first.mount('today');
    const block = root.querySelectorAll('.feast-block').find((b) => b.textContent.includes('上不上班（持续生效）'));
    assert.ok(block, '没有那一块');
    assert.ok(block.textContent.includes('饭点由她定'), `没说她定过饭点：${block.textContent.slice(0, 160)}`);
    assert.ok(block.textContent.includes('12:30'), '没把她定的档位写出来');
    assert.ok(block.textContent.includes('19:40'));
  } finally {
    first.panels.lastHandle?.dispose?.();
  }
  await first.world.stop();

  // 她没定的日子：说清是配置那组，不是她定的。
  const second = await mountPanels({ clock });
  try {
    const root = await second.mount('today');
    const block = root.querySelectorAll('.feast-block').find((b) => b.textContent.includes('上不上班（持续生效）'));
    assert.ok(block.textContent.includes('饭点走配置'), `没说清这组是配置来的：${block.textContent.slice(0, 160)}`);
  } finally {
    second.panels.lastHandle?.dispose?.();
  }
  await second.world.stop();
});

test('今天面板：无当天日程也可保存长期工作设置，重开面板保留', async () => {
  const clock = { now: Date.parse('2026-11-05T12:05:00+08:00') };
  const { mount, world, panels } = await mountPanels({ clock });
  try {
    // 删掉今天的日程 = 还没想好这一天怎么过。
    const { rm } = await import('node:fs/promises');
    const { join } = await import('node:path');
    await rm(join(world.dataDir, 'feast', 'life', '2026-11-05.json'), { force: true });
    const root = await mount('today');
    const block = root.querySelectorAll('.feast-block').find((b) => b.textContent.includes('上不上班（持续生效）'));
    assert.ok(block, '没有那一块');
    assert.ok(block.textContent.includes('还没有可修改的日程'));
    assert.equal(root.querySelector('.feast-work-pill').textContent, '还没安排');
    assert.ok(block.textContent.includes('权重都会变为 0'));
    assert.equal(block.findByText('关闭长期工作排程').disabled, false);
    block.findByText('关闭长期工作排程').fire('click');
    await waitFor(() => root.findByText('关闭长期工作排程')?.disabled === true, '关闭长期工作');
    const again = await mount('today');
    assert.equal(again.findByText('关闭长期工作排程').disabled, true, '重开面板仍为关闭');
    assert.equal(again.findByText('开启长期工作排程').disabled, false);
    again.findByText('开启长期工作排程').fire('click');
    await waitFor(() => again.findByText('开启长期工作排程')?.disabled === true, '恢复长期工作');
  } finally {
    panels.lastHandle?.dispose?.();
  }
  await world.stop();
});

test('长期排程开关：关闭不触碰当日日程，仍可单独清理今天；失败不伪装成功', async () => {
  const { mount, world, panels, invocations } = await mountPanels();
  try {
    const date = '2026-11-06';
    await writeDay(world.dataDir, templateDay(date, { dayTypeId: 'workday', work: true }));
    const root = await mount('today');
    assert.equal(root.querySelectorAll('.feast-work-retained').length, 0);
    root.findByText('关闭长期工作排程').fire('click');
    await waitFor(() => root.findByText('开启长期工作排程')?.disabled === false, '长期关闭完成');
    assert.equal(invocations.filter((i) => i.method === 'workPolicy').length, 1);
    assert.equal(invocations.filter((i) => i.method === 'work').length, 0);
    assert.equal(invocations.filter((i) => i.method === 'plan').length, 0);
    assert.equal(root.querySelector('.feast-work-pill').textContent, '今天上班');
    const tomorrowNotice = root.querySelectorAll('.feast-work-retained')
      .find((notice) => notice.textContent === '已关闭后续排班，明天的工作安排仍保留。');
    assert.ok(tomorrowNotice, '显示明天保留的工作安排');
    assert.ok(tomorrowNotice.parentNode.findByText('请她重新想想'));
    const daily = root.querySelector('.feast-work-daily');
    assert.equal(daily.findByText('今天不上班（仅今天）').disabled, false, '已有工作仍可清理');
    root.findByText('调整今天').fire('click');
    assert.equal(daily.open, true);
    assert.equal(document.activeElement.textContent, '仅修改今天的安排');
    daily.findByText('今天不上班（仅今天）').fire('click');
    await waitFor(() => root.querySelector('.feast-work-preview'), '保留单日清理');
    assert.equal(root.querySelector('.feast-work-daily').open, true);
  } finally { panels.lastHandle?.dispose?.(); await world.stop(); }
  const failed = await mountPanels({ workPolicyHandler: async () => ({ok:false,message:'保存失败'}) });
  try {
    const root = await failed.mount('today');
    root.findByText('关闭长期工作排程').fire('click');
    await waitFor(() => latestCall(failed.invocations, 'workPolicy')?.result?.ok === false && toastMatching(root, /保存失败/), '失败回执与提示');
    await waitFor(() => root.findByText('关闭长期工作排程')?.disabled === false, '失败后可重试');
    assert.equal(root.findByText('开启长期工作排程').disabled, true);
    assert.ok(root.querySelector('.feast-toast')?.textContent.includes('保存失败'));
  } finally { failed.panels.lastHandle?.dispose?.(); await failed.world.stop(); }
});

test('长期工作规则读取失败时两个主按钮禁用并显示原因', async () => {
  const { mount, world, panels } = await mountPanels({ todayList: { workSchedulingError:true } });
  try {
    const root = await mount('today');
    assert.equal(root.findByText('开启长期工作排程').disabled, true);
    assert.equal(root.findByText('关闭长期工作排程').disabled, true);
    assert.ok(root.textContent.includes('工作排程规则读取或保存失败'));
  } finally { panels.lastHandle?.dispose?.(); await world.stop(); }
});

test('今天面板在接下来显示提醒时间和来源，同一分钟暂停后刷新说明', async () => {
  const { mount, world, panels, intervals } = await mountPanels({ cfg: { lifeFreeSlots: '17:00', mealSlots: '18:00' } });
  try {
    const root = await mount('today');
    const reminderText = () => root.querySelector('.feast-reminders').textContent;
    assert.match(reminderText(), /饭点提醒 18:00 · 来自设置/);
    assert.match(reminderText(), /自由时间提醒 17:00 · 按当前安排，这一档忙时不提醒/);
    const tools = Object.fromEntries(world.tools().map(({ name, handler }) => [name, handler]));
    await tools.feast_skip({});
    await tools.feast_life_skip({});
    intervals.find(({ ms }) => ms === 60_000).fn();
    await waitFor(() => reminderText().includes('今天先别叫了'), '刷新反映暂停');
    assert.match(reminderText(), /饭点提醒 18:00 · 她说今天不吃了/);
  } finally { panels.lastHandle?.dispose?.(); await world.stop(); }
});

test('英文首页也显示待补提醒及饭点来源，不把补档当作时间', async () => {
  const setup = await mountPanels({ language: 'en', clock: { now: Date.parse('2026-11-05T12:25:00+08:00') },
    cfg: { lifeDayType: 'restday', mealSlots: '11:30', lifeFreeSlots: '11:30,13:00' } });
  try {
    const root = await setup.mount('today');
    const text = root.querySelector('.feast-reminders').textContent;
    assert.match(text, /Meal reminder 11:30 · Catch-up reminder due · From settings/);
    assert.match(text, /Free-time reminder catch-up · Catch-up reminder due/);
    assert.ok(!text.includes('补'));
  } finally { setup.panels.lastHandle?.dispose?.(); await setup.world.stop(); }
});

// --------------------------------------------------------------------------
// 本轮 UI 回归：真实后端 + 极简 DOM 行为冒烟，不代表浏览器渲染验收。
// --------------------------------------------------------------------------

const latestCall = (calls, method) => calls.filter((call) => call.method === method).at(-1);
const setInput = (node, value) => { assert.ok(node, '缺输入控件'); node.value = value; node.fire('input'); };
const selectActual = (root, index, checked = true) => {
  const check = root.querySelectorAll('.feast-actual-row')[index]?.querySelector('input');
  assert.ok(check && !check.disabled, '只选择可用的实际记录');
  check.checked = checked; check.fire('change'); return check;
};

async function seedActual(world) {
  await world.tools().find((tool) => tool.name === 'feast_eat').handler({ dish: '麻婆豆腐' });
  await writePlay(world.dataDir, { ...newPlay('2026-11-05'), done: [
    { at: Date.parse('2026-11-05T10:00:00+08:00'), activity: '读了一章书', note: '窗边读完' },
    { at: Date.parse('2026-11-05T11:00:00+08:00'), activity: '散步回来', note: '看见小猫' },
    { at: Date.parse('2026-11-05T23:00:00+08:00'), activity: '未来记录不得选择', note: '' },
  ] });
}

async function saveFirstCard(setup) {
  await seedActual(setup.world);
  const root = await setup.mount('today');
  selectActual(root, 0);
  setInput(root.querySelector('.feast-card-title'), '窗边的一天');
  root.findByText('保存纪念卡').click();
  await waitFor(() => root.querySelector('.feast-memory-card'), '真实保存纪念卡');
  return root;
}

function presetChoice(root, id) {
  const select = root.querySelector('.feast-today-controls').querySelectorAll('select')
    .find((node) => node.getAttribute('aria-label') === '生活提醒预设');
  assert.ok(select, '缺预设选择'); select.value = id; select.fire('change');
}

function draftInputs(root) {
  setInput(root.querySelector('.feast-journal-title'), '还没保存的小标题');
  setInput(root.querySelector('.feast-card-title'), '还没保存的卡标题');
  setInput(threadInputOf(root), '周末买花的想法');
  const form = changeFormOf(root);
  const [start, end] = form.querySelectorAll('.feast-time');
  setInput(start, '20:00'); setInput(end, '21:00');
  setInput(form.querySelector('input.feast-activity'), '尚未提交的调整');
}

function assertDrafts(root) {
  assert.equal(root.querySelector('.feast-journal-title').value, '还没保存的小标题');
  assert.equal(root.querySelector('.feast-card-title').value, '还没保存的卡标题');
  assert.equal(threadInputOf(root).value, '周末买花的想法');
  const form = changeFormOf(root);
  assert.deepEqual(form.querySelectorAll('.feast-time').map((node) => node.value), ['20:00', '21:00']);
  assert.equal(form.querySelector('input.feast-activity').value, '尚未提交的调整');
}

test('菜单快捷：liked/untried/recent 与类别、菜系、搜索求交并保留其他 filter', async () => {
  const setup = await mountPanels();
  const { world, panels, invocations } = setup;
  try {
    await world.tools().find((tool) => tool.name === 'feast_eat').handler({ dish: '麻婆豆腐' });
    await world.tools().find((tool) => tool.name === 'feast_reaction').handler({ action: 'like', note: '喜欢' });
    const root = await setup.mount('menu');
    const dish = lib.dishes.find((entry) => entry.id === 'mapo-tofu');
    for (const [index, value] of [[0, dish.category], [1, dish.cuisine]]) {
      const before = invocations.length;
      const select = root.querySelectorAll('select')[index]; select.value = value; select.fire('change');
      await waitFor(() => invocations.length > before && latestCall(invocations, 'list')?.result, '筛选刷新');
    }
    setInput(root.querySelector('.feast-search'), '豆腐');
    await waitFor(() => latestCall(invocations, 'list')?.result && latestCall(invocations, 'list').args[0].query === '豆腐', '搜索刷新');
    for (const [label, quick] of [['她喜欢的', 'liked'], ['还没尝过', 'untried'], ['最近吃过', 'recent']]) {
      root.findByText(label).click();
      const call = await waitFor(() => {
        const call = latestCall(invocations, 'list'); return call?.result && call.args[0].quick === quick && call;
      }, `${quick} 筛选刷新`);
      assert.deepEqual(call.args[0], { category: dish.category, cuisine: dish.cuisine, query: '豆腐', quick });
      assert.equal(root.findByText(label).getAttribute('aria-pressed'), 'true');
      assert.ok(call.result.items.every((entry) => entry.category === dish.category && entry.cuisine === dish.cuisine));
      const ids = call.result.items.map((entry) => entry.id);
      assert.equal(ids.includes(dish.id), quick !== 'untried', '喜欢/最近应保留吃过喜欢的菜，未尝应排除');
      assert.equal(root.querySelectorAll('.feast-card').length, call.result.items.length);
    }
  } finally { panels.lastHandle?.dispose?.(); await world.stop(); }
});

test('菜单换口味：最多三道可开详情，推荐和查看都不 feed、不记吃', async () => {
  const setup = await mountPanels();
  try {
    const root = await setup.mount('menu');
    const before = await setup.decl.invoke('history', 'list', []);
    root.findByText('今天换换口味').click();
    await waitFor(() => root.querySelector('.feast-discovery'), '候选出现');
    const picks = root.querySelector('.feast-discovery').querySelectorAll('.feast-chip');
    const call = latestCall(setup.invocations, 'recommend');
    assert.equal(picks.length, 3, '整库足够时展示三道，且不得超过三道');
    assert.equal(new Set(call.result.items.map((item) => item.id)).size, 3);
    assert.deepEqual(picks.map((node) => node.textContent), call.result.items.map((item) => `${item.name} · ${item.cuisine}`));
    picks[0].click();
    await waitFor(() => root.querySelector('.feast-detail'), '候选详情');
    assert.deepEqual(latestCall(setup.invocations, 'dish').args, [call.result.items[0].id]);
    assert.ok(!setup.invocations.some((entry) => ['feed', 'bite', 'take'].includes(entry.method)));
    assert.deepEqual(await setup.decl.invoke('history', 'list', []), before, '推荐和详情不能变更吃过历史');
    assert.equal(root.querySelector('.feast-strip'), null);
  } finally { setup.panels.lastHandle?.dispose?.(); await setup.world.stop(); }
});

test('真实回顾：60 Unicode 字标题独立保存，纪念卡限选1–2条，计划和未来不混入', async () => {
  const setup = await mountPanels();
  try {
    await seedActual(setup.world);
    const before = await readDay(setup.world.dataDir, '2026-11-05');
    const root = await setup.mount('today');
    assert.equal(root.querySelectorAll('.feast-actual-row').length, 3, '两件活动和一口饭是真实记录，未来活动不出现');
    assert.ok(!root.querySelector('.feast-journal').textContent.includes('未来记录不得选择'));
    assert.ok(!root.querySelector('.feast-journal').textContent.includes('吃午饭'), '模板日程不能成为实际记录');
    const title = root.querySelector('.feast-journal-title');
    const cardTitle = root.querySelector('.feast-card-title');
    assert.equal(title.maxLength, 120, '60个增补平面Unicode字需要120个UTF-16码元');
    assert.equal(cardTitle.maxLength, 120);
    const journalCalls = setup.invocations.filter((entry) => entry.method === 'journal').length;
    root.querySelectorAll('.feast-actual-row')[0].findByText('用作小标题').click();
    assert.equal(title.value, '读了一章书', '用真实记录正文预填标题');
    assert.equal(title.parentNode.parentNode.open, true, '预填时展开标题工具');
    assert.equal(document.activeElement, title);
    assert.equal(root.querySelectorAll('.feast-actual-row')[0].querySelector('input').checked, false, '预填不勾选纪念卡记录');
    assert.equal(setup.invocations.filter((entry) => entry.method === 'journal').length, journalCalls, '预填后仍须明确保存');
    assert.equal((await setup.decl.invoke('today', 'review', ['2026-11-05'])).journal.title, '');
    const unicode = '🐟'.repeat(60);
    setInput(title, unicode); root.findByText('保存小标题').click();
    await waitFor(() => latestCall(setup.invocations, 'journal')?.result?.ok && root.querySelector('.feast-journal').textContent.includes(unicode), '小标题真实保存');
    assert.equal((await setup.decl.invoke('today', 'review', ['2026-11-05'])).journal.title, unicode);
    assert.deepEqual(await readDay(setup.world.dataDir, '2026-11-05'), before, '手动标题不改日程标题或计划');
    const count = setup.invocations.filter((entry) => entry.method === 'journal').length;
    root.findByText('保存纪念卡').click();
    assert.equal(setup.invocations.filter((entry) => entry.method === 'journal').length, count, '空选时应在界面拦下');
    assert.match(root.querySelector('.feast-journal').querySelector('.feast-feedback').textContent, /请选择1–2条/);
    selectActual(root, 0); selectActual(root, 1);
    assert.equal(selectActual(root, 2).checked, false, '第三条必须拒绝，保留前两条选择');
    setInput(root.querySelector('.feast-card-title'), unicode);
    root.findByText('保存纪念卡').click();
    await waitFor(() => root.querySelector('.feast-memory-card'), '两条纪念卡保存');
    const saved = latestCall(setup.invocations, 'journal');
    assert.equal(saved.args[0].action, 'card'); assert.equal(saved.args[0].selectedIds.length, 2);
    assert.equal(saved.result.card.title, unicode);
    const review = await setup.decl.invoke('today', 'review', ['2026-11-05']);
    assert.deepEqual(review.journal.cards[0].entries, review.actual.slice(0, 2));
    assert.equal(root.querySelectorAll('.feast-actual-row').filter((row) => row.querySelector('input').checked).length, 0);
    selectActual(root, 2); root.findByText('保存纪念卡').click();
    await waitFor(() => root.querySelectorAll('.feast-memory-card').length === 2, '单条纪念卡保存');
    assert.equal(latestCall(setup.invocations, 'journal').result.card.entries.length, 1);
    assert.deepEqual(await readDay(setup.world.dataDir, '2026-11-05'), before);
  } finally { setup.panels.lastHandle?.dispose?.(); await setup.world.stop(); }
});

test('回顾保存失败：真实后端拒绝超长标题，输入与选择可继续重试', async () => {
  const setup = await mountPanels();
  try {
    await seedActual(setup.world); const root = await setup.mount('today');
    setInput(root.querySelector('.feast-journal-title'), '字'.repeat(61));
    root.findByText('保存小标题').click();
    await waitFor(() => root.querySelector('.feast-feedback.is-bad'), '标题错误明确显示');
    assert.match(root.querySelector('.feast-journal').querySelector('.feast-feedback').textContent, /最多 60 字/);
    assert.equal(root.querySelector('.feast-journal-title').value, '字'.repeat(61));
    selectActual(root, 0); selectActual(root, 1);
    setInput(root.querySelector('.feast-card-title'), '卡'.repeat(61));
    root.findByText('保存纪念卡').click();
    await waitFor(() => latestCall(setup.invocations, 'journal')?.args[0].action === 'card'
      && latestCall(setup.invocations, 'journal').result?.ok === false && !root.findByText('保存纪念卡').disabled, '纪念卡失败可重试');
    assert.equal(root.querySelector('.feast-card-title').value, '卡'.repeat(61));
    assert.equal(root.querySelectorAll('.feast-actual-row').filter((row) => row.querySelector('input').checked).length, 2);
    assert.equal((await setup.decl.invoke('today', 'review', ['2026-11-05'])).journal.cards.length, 0);
    setInput(root.querySelector('.feast-card-title'), '重试保留的两件事'); root.findByText('保存纪念卡').click();
    await waitFor(() => root.querySelector('.feast-memory-card'), '原选择重试成功');
    assert.equal(latestCall(setup.invocations, 'journal').result.card.entries.length, 2);
    assert.equal(root.querySelector('.feast-journal-title').value, '字'.repeat(61), '另一份尚未保存的输入也保留');
  } finally { setup.panels.lastHandle?.dispose?.(); await setup.world.stop(); }
});

test('未来回顾：能看计划但无实际记录可选，伪造计划ID由真实后端拒绝', async () => {
  const setup = await mountPanels();
  try {
    await writeDay(setup.world.dataDir, templateDay('2026-11-06', { dayTypeId: 'restday' }));
    await writePlay(setup.world.dataDir, { ...newPlay('2026-11-06'), done: [
      { at: Date.parse('2026-11-06T10:00:00+08:00'), activity: '未来活动', note: '' },
    ] });
    const root = await setup.mount('today');
    const next = labeledButton(root, /下一[日天]|后一[日天]/);
    assert.ok(next && next.disabled, '今天之后的日期不能从事实工作台打开');
    const before = setup.invocations.filter((call) => call.method === 'review').length;
    next.click();
    assert.equal(setup.invocations.filter((call) => call.method === 'review').length, before);
    // 未来计划仍由真实 review 接口提供；UI 不把它混入已发生的日期工作台。
    const review = await setup.decl.invoke('today', 'review', ['2026-11-06']);
    assert.equal(review.ok, true);
    assert.ok(review.day.items.length > 0, '未来计划仍可读取');
    assert.deepEqual(review.actual, [], '未来计划或未来来源记录都不能当作已发生');
    for (const date of ['2026-11-05', '2026-11-06']) {
      const result = await setup.decl.invoke('today', 'journal', [{ action: 'card', date, selectedIds: ['plan-00:00'] }]);
      assert.equal(result.ok, false); assert.match(result.message, /实际记录为空|今天或过去/);
    }
  } finally { setup.panels.lastHandle?.dispose?.(); await setup.world.stop(); }
});

test('纪念卡原生导出：真实文本进入Blob，文件名正确，临时链接与URL均清理', async () => {
  const setup = await mountPanels();
  const create = Object.getOwnPropertyDescriptor(URL, 'createObjectURL');
  const revoke = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL');
  const originalClick = Node.prototype.click;
  const blobs = []; const clicks = []; const revoked = [];
  URL.createObjectURL = (blob) => { blobs.push(blob); return `blob:panel-test-${blobs.length}`; };
  URL.revokeObjectURL = (url) => { revoked.push(url); };
  Node.prototype.click = function () { if (this.tagName === 'A') clicks.push({ href: this.href, download: this.download }); else originalClick.call(this); };
  try {
    const root = await saveFirstCard(setup);
    const card = latestCall(setup.invocations, 'journal').result.card;
    const timeoutCount = setup.timeouts.length;
    root.findByText('下载文字卡').click();
    await waitFor(() => clicks.length === 1 && setup.timeouts.length > timeoutCount, '原生下载完成');
    const exported = latestCall(setup.invocations, 'journal');
    assert.deepEqual(exported.args, [{ action: 'export', date: '2026-11-05', cardId: card.id }]);
    assert.equal(exported.result.ok, true);
    assert.deepEqual(clicks[0], { href: 'blob:panel-test-1', download: `fish-day-2026-11-05-${card.id.slice(0, 8)}.txt` });
    assert.ok(blobs[0] instanceof Blob); assert.equal(blobs[0].type, 'text/plain;charset=utf-8');
    assert.equal(Buffer.from(await blobs[0].arrayBuffer()).toString('utf8'), '\ufeff' + exported.result.text);
    assert.match(exported.result.text, /窗边的一天/); assert.match(exported.result.text, /读了一章书/);
    assert.equal(root.querySelector('textarea').value, exported.result.text);
    assert.equal(root.querySelector('textarea').readOnly, true);
    assert.equal(root.querySelectorAll('a').length, 0, '临时a标签已移除');
    setup.timeouts.slice(timeoutCount).forEach((fn) => fn());
    assert.deepEqual(revoked, ['blob:panel-test-1'], '延迟清理URL');
    root.findByText('下载文字卡').click();
    await waitFor(() => clicks.length === 2, '第二次导出');
    setup.panels.lastHandle.dispose();
    assert.deepEqual(revoked, ['blob:panel-test-1', 'blob:panel-test-2'], '卸载清理尚未回收URL');
  } finally {
    setup.panels.lastHandle?.dispose?.(); await setup.world.stop();
    Node.prototype.click = originalClick;
    if (create) Object.defineProperty(URL, 'createObjectURL', create); else delete URL.createObjectURL;
    if (revoke) Object.defineProperty(URL, 'revokeObjectURL', revoke); else delete URL.revokeObjectURL;
  }
});

test('纪念卡不能下载时：仍展开真实只读文本供手动复制', async () => {
  const setup = await mountPanels();
  const original = Object.getOwnPropertyDescriptor(URL, 'createObjectURL');
  URL.createObjectURL = undefined;
  try {
    const root = await saveFirstCard(setup); root.findByText('下载文字卡').click();
    await waitFor(() => root.querySelector('.feast-memory-card').textContent.includes('请复制下方文字'), '下载不可用提示');
    const output = root.querySelector('textarea');
    assert.equal(output.readOnly, true); assert.equal(output.value, latestCall(setup.invocations, 'journal').result.text);
    assert.match(output.value, /读了一章书/); assert.equal(root.querySelectorAll('a').length, 0);
    assert.equal(root.findByText('下载文字卡').disabled, false);
  } finally {
    setup.panels.lastHandle?.dispose?.(); await setup.world.stop();
    if (original) Object.defineProperty(URL, 'createObjectURL', original); else delete URL.createObjectURL;
  }
});

test('预设无persist：只能预览逐项差异，确认禁用，取消不改且草稿保留', async () => {
  const setup = await mountPanels({ cfg: { mealReminder: false, mealMaxRetries: 3, lifeFreeSlots: '' } });
  try {
    const root = await setup.mount('today'); const before = structuredClone(setup.world.cfg);
    draftInputs(root); presetChoice(root, 'lively'); assertDrafts(root);
    root.findByText('预览修改').click();
    await waitFor(() => root.querySelector('.feast-preset-preview'), '只读预览');
    assert.equal(root.findByText('确认应用这套设置').disabled, true);
    assert.match(root.textContent, /未提供保存配置接口，只能预览/);
    const preview = latestCall(setup.invocations, 'style');
    assert.deepEqual(preview.args, [{ action: 'preview', preset: 'lively' }]); assert.equal(preview.result.canApply, false);
    assert.equal(root.querySelector('.feast-preset-preview').querySelectorAll('.feast-note').length, preview.result.changes.length);
    assert.match(root.querySelector('.feast-preset-preview').textContent, /当前 关闭 → 应用后 开启/);
    assert.match(root.querySelector('.feast-preset-preview').textContent, /当前 3 → 应用后 0/);
    assert.match(root.querySelector('.feast-preset-preview').textContent, /当前 未设置 → 应用后 10:00,14:00,21:00/);
    root.findByText('确认应用这套设置').click();
    assert.equal(setup.invocations.filter((call) => call.method === 'style').length, 1, '禁用确认不得调用apply');
    root.findByText('取消预览').click(); assert.equal(root.querySelector('.feast-preset-preview'), null);
    assert.deepEqual(setup.world.cfg, before); assertDrafts(root);
  } finally { setup.panels.lastHandle?.dispose?.(); await setup.world.stop(); }
});

test('预设确认：先逐项预览和取消，确认携带revision后才persist真实差量', async () => {
  const patches = [];
  const setup = await mountPanels({ persist: async (patch) => { patches.push(structuredClone(patch)); },
    cfg: { mealReminder: false, mealMaxRetries: 3, lifeFreeEnabled: false, lifeFreeSlots: '', lifeFreeBusyCall: true, lifeMomentEvents: true, lifeFreeAskReport: true } });
  try {
    await seedActual(setup.world);
    const plan = await readDay(setup.world.dataDir, '2026-11-05');
    const root = await setup.mount('today'); patches.length = 0;
    const before = structuredClone(setup.world.cfg); draftInputs(root); selectActual(root, 0);
    presetChoice(root, 'lively'); root.findByText('预览修改').click();
    await waitFor(() => root.querySelector('.feast-preset-preview'), '七项预览');
    const preview = latestCall(setup.invocations, 'style').result;
    const expected = [
      '饭点提醒: 当前 关闭 → 应用后 开启', '每顿最多再催几次: 当前 3 → 应用后 0',
      '自由时间提醒: 当前 关闭 → 应用后 开启', '自由时间档位: 当前 未设置 → 应用后 10:00,14:00,21:00',
      '忙着的时候也叫: 当前 开启 → 应用后 关闭', '时段切换事件: 当前 开启 → 应用后 关闭', '提醒她报备: 当前 开启 → 应用后 关闭',
    ];
    assert.deepEqual(root.querySelector('.feast-preset-preview').texts('feast-note'), expected);
    assert.equal(preview.changes.length, 7); assert.equal(patches.length, 0); assert.deepEqual(setup.world.cfg, before);
    root.findByText('取消预览').click(); assert.equal(patches.length, 0); assert.deepEqual(setup.world.cfg, before); assertDrafts(root);
    root.findByText('预览修改').click(); await waitFor(() => root.querySelector('.feast-preset-preview'), '重新预览');
    const confirmed = latestCall(setup.invocations, 'style').result;
    root.findByText('确认应用这套设置').click();
    await waitFor(() => !root.querySelector('.feast-preset-preview') && latestCall(setup.invocations, 'style')?.result?.ok && toastMatching(root, /(?:应用|保存)/), '预设确认成功回执');
    assert.deepEqual(latestCall(setup.invocations, 'style').args, [{ action: 'apply', preset: 'lively', revision: confirmed.revision }]);
    assert.deepEqual(patches, [confirmed.patch]);
    for (const [key, value] of Object.entries(confirmed.patch)) assert.equal(setup.world.cfg[key], value);
    assert.deepEqual(await readDay(setup.world.dataDir, '2026-11-05'), plan);
    assertDrafts(root); assert.equal(root.querySelectorAll('.feast-actual-row')[0].querySelector('input').checked, true);
  } finally { setup.panels.lastHandle?.dispose?.(); await setup.world.stop(); }
});

test('预设保存错误与过期显式提示，失败不改配置、草稿与选择仍保留', async () => {
  let fail = true; const patches = [];
  const setup = await mountPanels({ persist: async (patch) => { patches.push(patch); if (fail) throw new Error('磁盘写入失败'); } });
  try {
    await seedActual(setup.world); const root = await setup.mount('today'); patches.length = 0;
    draftInputs(root); selectActual(root, 1); presetChoice(root, 'quiet');
    const preview = async () => { root.findByText('预览修改').click(); await waitFor(() => root.querySelector('.feast-preset-preview'), '准备预览'); };
    await preview(); const before = structuredClone(setup.world.cfg);
    root.findByText('确认应用这套设置').click();
    await waitFor(() => root.querySelectorAll('.feast-feedback.is-bad').some((node) => node.textContent.includes('磁盘写入失败')), '持久化失败提示');
    assert.deepEqual(setup.world.cfg, before); assert.equal(patches.length, 1); assertDrafts(root);
    assert.equal(root.querySelectorAll('.feast-actual-row')[1].querySelector('input').checked, true);
    assert.equal(root.findByText('确认应用这套设置').disabled, false, '失败可重试');
    root.findByText('取消预览').click(); fail = false; await preview();
    setup.world.cfg.mealMaxRetries = 2; // 模拟预览后宿主配置变化，apply仍走真实revision检查。
    root.findByText('确认应用这套设置').click();
    await waitFor(() => !root.querySelector('.feast-preset-preview') && root.querySelectorAll('.feast-feedback.is-bad').some((node) => /stale|过期/i.test(node.textContent)), '过期提示');
    assert.equal(latestCall(setup.invocations, 'style').result.stale, true);
    assert.equal(patches.length, 1, '过期不得调用persist'); assert.equal(setup.world.cfg.lifeFreeEnabled, true);
    assertDrafts(root); assert.equal(root.querySelectorAll('.feast-actual-row')[1].querySelector('input').checked, true);
  } finally { setup.panels.lastHandle?.dispose?.(); await setup.world.stop(); }
});

test('关闭日程仍可保存真实回顾和查看往期，首页不硬画当日时间线', async () => {
  const setup = await mountPanels({ cfg: { lifeEnabled: false } });
  try {
    await seedActual(setup.world);
    await writeDay(setup.world.dataDir, templateDay('2026-11-03', { dayTypeId: 'restday' }));
    await writePlay(setup.world.dataDir, { ...newPlay('2026-11-03'), done: [
      { at: Date.parse('2026-11-03T10:00:00+08:00'), activity: '关闭前留下的散步', note: '' },
    ] });
    const root = await setup.mount('today');
    assert.match(root.textContent, /关着/); assert.equal(root.querySelectorAll('.feast-tl-row').length, 0);
    assert.equal(root.querySelectorAll('.feast-actual-row').length, 3);
    selectActual(root, 0); root.findByText('保存纪念卡').click();
    await waitFor(() => root.querySelector('.feast-memory-card'), '关闭日程时保存真实纪念卡');
    root.querySelector('.feast-item.is-click').click();
    await waitFor(() => root.querySelector('.feast-seen')?.querySelector('.feast-actual-row'), '关闭日程仍能往期review');
    assert.match(root.querySelector('.feast-seen').querySelector('.feast-journal').textContent, /关闭前留下的散步/);
    assert.deepEqual(latestCall(setup.invocations, 'review').args, ['2026-11-03']);
  } finally { setup.panels.lastHandle?.dispose?.(); await setup.world.stop(); }
});

test('首页顺序与样式静态契约：当前计划在长期控制之前，焦点及减弱动画规则存在', async () => {
  const setup = await mountPanels();
  try {
    const root = await setup.mount('today'); const nodes = [...root.walk()];
    const current = root.querySelector('.feast-current-plan'); const controls = root.querySelector('.feast-today-controls');
    const work = root.querySelector('.feast-today-status');
    assert.ok(current && controls && work); assert.ok(nodes.indexOf(current) < nodes.indexOf(controls));
    assert.ok(nodes.indexOf(current) < nodes.indexOf(work)); assert.ok([...controls.walk()].includes(work));
    assert.equal(controls.tagName, 'DETAILS'); assert.equal(controls.open, false);
    assert.match(current.textContent, /这是计划，不代表事情已经发生/);
    const css = root.querySelector('style').textContent;
    assert.match(css, /:is\(button,input,select,summary,textarea,\[role="button"\],a\[href\]\):focus-visible\{[^}]*outline:2px solid/);
    assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
    assert.match(css, /animation:none!important;transition:none!important;transform:none!important;scroll-behavior:auto!important/);
    // 仅静态CSS与节点顺序断言；这个Node桩没有布局、原生焦点环或动画渲染能力。
  } finally { setup.panels.lastHandle?.dispose?.(); await setup.world.stop(); }
});

// --------------------------------------------------------------------------
// 本轮日期工作台、浏览/草稿分离与异步行为。所有时间都使用明确的测试时区。
// --------------------------------------------------------------------------

const todayDate = '2026-11-05';
const day3 = '2026-11-03';
const day4 = '2026-11-04';
const testClock = () => ({ now: Date.parse('2026-11-05T12:05:00+08:00') });
const labeledButton = (root, label) => root.findAll((n) => n.tagName === 'BUTTON')
  .find((node) => [node.textContent.trim(), node.getAttribute('aria-label'), node.title].some((text) => label.test(text ?? '')));
function clickButton(root, label) {
  const node = labeledButton(root, label);
  assert.ok(node && !node.disabled, `缺可点击按钮 ${label}`);
  node.click();
  return node;
}
const previousDay = (root) => clickButton(root, /上一日|前一[日天]|上一天/);
const nextDay = (root) => clickButton(root, /下一[日天]|后一[日天]/);
const returnToday = (root) => clickButton(root, /回到今天|返回今天|回今天/);
const dateControl = (root, date) => {
  const bar = root.querySelector('.feast-date-navigation') ?? root.querySelector('.feast-datebar');
  const node = bar?.querySelector('button[aria-label="选择日期"]');
  return node && (!date || node.title === date || bar.textContent.includes(date)) ? node : null;
};
const calendarCell = (root, date) => root.querySelector(`button[data-date="${date}"]`)
  ?? labeledButton(root, new RegExp(`^${date}`));
const toastMatching = (root, pattern) => root.findAll((node) => node !== root
  && (node.classList.contains('feast-feedback') || node.classList.contains('feast-toast')
    || ['status', 'alert'].includes(node.getAttribute('role')))
  && pattern.test(node.textContent)).find((node) => !node.children.some((child) => pattern.test(child.textContent)
    && ['status', 'alert'].includes(child.getAttribute('role'))));
const readPosition = (node, y) => { node.scrollTop = y; node.fire('scroll'); };
const nodeSnapshot = (root) => ({ nodes: [...root.walk()], text: root.textContent });
function assertUnchanged(root, before, reason) {
  assert.equal(root.textContent, before.text, reason);
  const nodes = [...root.walk()];
  assert.equal(nodes.length, before.nodes.length, reason);
  assert.ok(nodes.every((node, i) => node === before.nodes[i]), reason);
}

async function seedPast(setup, date, text, makeCard = false) {
  const day = templateDay(date, { dayTypeId: 'restday' });
  day.title = `${text}的计划`;
  day.items[0].activity = `${text}的安排`;
  await writeDay(setup.world.dataDir, day);
  await writePlay(setup.world.dataDir, { ...newPlay(date), done: [
    { at: Date.parse(`${date}T10:00:00+08:00`), activity: `${text}的实录`, note: `${text}的备注` },
  ] });
  if (makeCard) {
    const review = await setup.decl.invoke('today', 'review', [date]);
    const result = await setup.decl.invoke('today', 'journal', [{ action: 'card', date, title: `${text}纪念卡`, selectedIds: [review.actual[0].id] }]);
    assert.equal(result.ok, true, '准备真实的历史纪念卡');
  }
}

function expandTimeline(root) {
  const toggle = root.querySelector('.feast-timeline-toggle');
  assert.ok(toggle, '缺完整时间线开关');
  if (/展开/.test(toggle.textContent)) toggle.click();
}

function openCalendar(root, date = todayDate) {
  const control = dateControl(root, date);
  assert.ok(control && !control.disabled, '日期条应可展开月历');
  control.click();
  return control;
}

test('所有面板读 viewState：同数据目录跨挂载稳定，换目录隔离，日期取服务端时区', async () => {
  const clock = { now: Date.parse('2026-11-04T16:01:00Z') };
  const a = await mountPanels({ clock });
  const b = await mountPanels({ clock });
  let scope;
  for (const { id } of a.decl.panels) {
    await a.mount(id);
    const call = latestCall(a.invocations, 'viewState');
    assert.ok(call, `${id} 挂载没有请求 viewState`);
    assert.deepEqual(call.args, []);
    scope ??= call.result.scope;
    assert.equal(typeof scope, 'string');
    assert.ok(scope && !scope.includes(a.world.dataDir), 'scope 不暴露数据目录');
    for (const key of ['ok', 'scope', 'date', 'timezone']) assert.ok(Object.hasOwn(call.result, key), `viewState 缺 ${key}`);
    assert.deepEqual([call.result.ok, call.result.scope, call.result.date, call.result.timezone], [true, scope, todayDate, 'Asia/Shanghai']);
  }
  assert.equal((await a.world.webUi('en').invoke('menu', 'viewState', [])).scope, scope);
  assert.notEqual((await b.decl.invoke('menu', 'viewState', [])).scope, scope, '不同 dataDir 的 scope 不能串');
  clock.now += 86_400_000;
  const tomorrow = await a.decl.invoke('today', 'viewState', []);
  assert.equal(tomorrow.date, '2026-11-06');
  assert.equal(tomorrow.scope, scope, '跨天不应丢失同一数据目录的身份');
});

test('菜单链：按搜索及分类浏览→进详情→返回→跨面板回来，恢复过滤、滚动和卡片焦点', async () => {
  const setup = await mountPanels();
  const root = await setup.mount('menu');
  const dishButton = () => root.querySelector('[data-dish-id="mapo-tofu"]');
  const select = root.querySelectorAll('select')[1];
  select.value = '川菜'; select.fire('change');
  await waitFor(() => root.querySelectorAll('.feast-card').length === lib.dishes.filter((d) => d.cuisine === '川菜').length, '川菜列表落地');
  setInput(root.findAll((node) => node.tagName === 'INPUT').find((node) => node.placeholder.includes('搜菜名')), '麻婆豆腐');
  await waitFor(() => latestCall(setup.invocations, 'list')?.result && root.querySelectorAll('.feast-card').length === 1 && dishButton(), '搜出目标菜');
  root.clientHeight = 400; root.scrollHeight = 1000;
  readPosition(root, 136);
  dishButton().focus(); dishButton().click();
  await waitFor(() => root.querySelector('.feast-detail-n')?.textContent === '麻婆豆腐', '指定详情');
  root.scrollTop = 0; // 详情与列表的阅读位置不同。
  clickButton(root, /回菜单|返回菜单/);
  await waitFor(() => dishButton() && !root.querySelector('.feast-detail'), '回到来时的搜索列表');
  assert.equal(root.scrollTop, 136);
  assert.equal(document.activeElement, dishButton(), '详情回到原菜卡，而不是页顶或搜索框');
  await setup.mount('history');
  await setup.mount('menu');
  assert.equal(latestCall(setup.invocations, 'list').args[0].query, '麻婆豆腐');
  assert.equal(latestCall(setup.invocations, 'list').args[0].cuisine, '川菜');
  assert.equal(root.scrollTop, 136);
  assert.ok(document.activeElement === dishButton(), '跨面板回来仍落在原卡片锚点');
});

test('仅浏览状态可落盘：fresh bundle 恢复同 scope 菜单筛选，不串他人；草稿、确认、回执和 revision 不落盘', async () => {
  const storage = memoryStorage();
  const setup = await mountPanels({ storage, persist: async () => {} });
  const second = await mountPanels({ storage });
  await setup.decl.invoke('combo', 'save', [{ name: '确认状态测试桌', dishes: ['mapo-tofu'] }]);
  const root = await setup.mount('menu');
  setInput(root.querySelector('.feast-invite-note'), '私人邀请草稿！');
  setInput(root.findAll((node) => node.tagName === 'INPUT').find((node) => node.placeholder.includes('搜菜名')), '豆腐');
  await waitFor(() => latestCall(setup.invocations, 'list')?.args[0]?.query === '豆腐' && latestCall(setup.invocations, 'list').result, '菜单浏览状态已更新');
  await setup.mount('combo');
  comboChips(root).find((node) => node.textContent.includes('麻婆豆腐')).click();
  setInput(root.findAll((n) => n.tagName === 'INPUT').find((n) => n.placeholder.includes('名字')), '私人套餐草稿！');
  const ownTable = () => root.querySelectorAll('.feast-set').find((node) => node.textContent.includes('确认状态测试桌'));
  ownTable().findByText('删').click();
  assert.ok(ownTable().findByText('再点一次就删掉'));
  await setup.mount('today');
  draftInputs(root); presetChoice(root, 'quiet');
  root.findByText('预览修改').click();
  const preview = await waitFor(() => latestCall(setup.invocations, 'style')?.result?.revision && root.querySelector('.feast-preset-preview')
    && latestCall(setup.invocations, 'style').result, '生成真实预览 revision');
  const persisted = JSON.stringify(storage.writes);
  assert.ok(storage.writes.length && persisted.includes('豆腐'), '菜单浏览 filter 应写 localStorage');
  for (const marker of ['私人邀请草稿！', '私人套餐草稿！', '还没保存的小标题', '还没保存的卡标题', '周末买花的想法', '尚未提交的调整', preview.revision]) {
    assert.equal(persisted.includes(marker), false, `操作内容不应进入 localStorage: ${marker}`);
  }
  for (const [, value] of storage.writes) {
    assert.doesNotMatch(value, /"(?:revision|confirmId|receipt|feedback|drafts|presetPreview)"/i);
  }
  await setup.mount('combo');
  assert.equal(root.findAll((n) => n.tagName === 'INPUT').find((n) => n.placeholder.includes('名字')).value, '私人套餐草稿！', '同会话重挂保留套餐编辑');
  assert.ok(ownTable().findByText('删'), '未确认删除不能跨 mount 恢复');
  await setup.mount('menu');
  assert.equal(root.querySelector('.feast-invite-note').value, '私人邀请草稿！');
  await setup.mount('today');
  assertDrafts(root);
  assert.equal(root.querySelector('.feast-preset-preview'), null, '提交确认与 revision 不跨 mount 恢复');
  await setup.mount('menu', { freshBundle: true });
  assert.equal(latestCall(setup.invocations, 'list').args[0].query, '豆腐', '仅凭落盘状态可恢复浏览');
  assert.equal(root.querySelector('.feast-invite-note').value, '', '新入口不得从 localStorage 恢复私人草稿');
  const otherRoot = await second.mount('menu');
  assert.ok(!latestCall(second.invocations, 'list').args[0].query, '不同 scope 不共享筛选');
  assert.equal(otherRoot.querySelector('.feast-invite-note').value, '');
});

test('菜单后续列表更新保留旧 DOM；快速切筛选、IME 与卸载后的旧响应不得覆盖', async () => {
  const read = deferInvocations((call) => call.method === 'list' && Boolean(call.args[0]?.cuisine));
  const setup = await mountPanels({ invokeHook: read.hook });
  const root = await setup.mount('menu');
  const sentinel = root.querySelector('.feast-card');
  const changeCuisine = (value) => { const n = root.querySelectorAll('select')[1]; n.value = value; n.fire('change'); };
  changeCuisine('川菜');
  const older = await read.take((call) => call.args[0]?.cuisine === '川菜', '旧筛选正在等响应');
  assert.equal(root.querySelector('.feast-card'), sentinel, '不是首次加载，不应拆掉旧列表');
  changeCuisine('粤菜');
  const newer = await read.take((call) => call.args[0]?.cuisine === '粤菜', '新筛选已发出');
  const oldResult = await older.next();
  const newResult = await newer.next();
  newer.resolve(newResult);
  await waitFor(() => root.querySelector('.feast-card') !== sentinel && root.querySelectorAll('select')[1]?.value === '粤菜', '新筛选已渲染');
  const shown = nodeSnapshot(root);
  older.resolve(oldResult);
  await endTurn();
  assertUnchanged(root, shown, '晚到的旧列表不能回写 DOM');
  const search = root.findAll((node) => node.tagName === 'INPUT').find((node) => node.placeholder.includes('搜菜名'));
  changeCuisine('北京菜');
  const pending = await read.take((call) => call.args[0]?.cuisine === '北京菜', '开始输入前已有后台列表请求');
  search.focus(); search.value = '豆'; search.setSelectionRange(1, 1);
  search.fire('compositionstart'); search.fire('input', { isComposing: true });
  pending.resolve(await pending.next());
  await endTurn();
  assert.ok(root.contains(search)); assert.equal(document.activeElement, search); assert.equal(search.value, '豆');
  assert.equal(search.selectionStart, 1);
  assert.ok(!setup.invocations.some((call) => call.args[0]?.query === '豆'), '组词中的输入不能发搜索请求');
  search.value = '豆腐'; search.fire('compositionend');
  const requestPending = await read.take((call) => call.args[0]?.query === '豆腐', '组词结束才有搜索请求');
  const timer = setup.intervals.at(-1);
  setup.panels.lastHandle.dispose();
  assert.equal(timer.disposed, true, '卸载必须取消轮询');
  const detached = nodeSnapshot(root);
  requestPending.resolve(await requestPending.next());
  await endTurn();
  assertUnchanged(root, detached, '卸载后晚到的列表不能回写 DOM');
});

test('套餐重配保留旧 DOM 且防重复操作；跨面板较新读取与卸载不受旧响应污染', async () => {
  let delay = false;
  const requests = deferInvocations((call) => delay && call.panelId === 'combo' && call.method === 'list' && Boolean(call.args[0]?.seeds));
  const setup = await mountPanels({ invokeHook: requests.hook });
  const root = await setup.mount('combo');
  const cards = () => root.querySelectorAll('.feast-set');
  const snapshot = cards();
  delay = true;
  cards()[0].findByText('换一桌').click();
  const older = await waitFor(() => requests.queue[0], '第一桌重配请求');
  assert.equal(cards()[0], snapshot[0], '后续 loading 不摘除旧套餐卡');
  assert.equal(cards()[1].findByText('换一桌').disabled, true, '读取期间不能重复操作另一桌');
  cards()[1].findByText('换一桌').click();
  assert.equal(requests.queue.length, 1, '禁用入口不得产生额外重配');
  const oldResult = await older.next();
  delay = false;
  await setup.mount('history');
  await setup.mount('combo');
  const shown = nodeSnapshot(root);
  older.resolve({ ...oldResult, presets: oldResult.presets.map((entry) => ({ ...entry, name: '过期预览结果' })) });
  await endTurn();
  assertUnchanged(root, shown, '旧挂载的预览不能覆盖当前套餐');
  delay = true;
  cards()[0].findByText('换一桌').click();
  const pending = await waitFor(() => requests.queue[1], '卸载前的套餐读取');
  const snapshotResult = await pending.next();
  setup.panels.lastHandle.dispose();
  assert.ok(setup.intervals.length && setup.intervals.every((timer) => timer.disposed));
  const detached = nodeSnapshot(root);
  pending.resolve(snapshotResult);
  await endTurn();
  assertUnchanged(root, detached, '卸载后的套餐回执不得写入页面');
});

test('日期月历：按需读取、实际/卡片是两个标记、未知不当作无、未来不可选、关闭后不轮询', async () => {
  const setup = await mountPanels();
  await seedPast(setup, day3, '只有实录');
  await seedPast(setup, day4, '实录及卡片', true);
  const { writeFile } = await import('node:fs/promises');
  const { playPath } = await import('../src/life/store.js');
  const { journalPath } = await import('../src/life/journal.js');
  const unknown = '2026-11-02';
  const future = '2026-11-06';
  // 同样的损坏，历史应暴露为未知，未来应跳过读文件、不报告损坏。
  for (const date of [unknown, future]) {
    await writePlay(setup.world.dataDir, newPlay(date));
    await writeFile(playPath(setup.world.dataDir, date), '{损坏');
    await writeFile(journalPath(setup.world.dataDir, date), '{损坏');
  }
  const root = await setup.mount('today');
  assert.ok(dateControl(root, todayDate), '默认浏览今天');
  assert.ok(!setup.invocations.some((call) => call.method === 'calendar'), '日期未展开时不取整月数据');
  const toggle = root.querySelector('.feast-timeline-toggle');
  assert.ok(toggle && /展开/.test(toggle.textContent), '完整时间线初始折叠');
  openCalendar(root);
  const cardCell = await waitFor(() => latestCall(setup.invocations, 'calendar')?.result
    && calendarCell(root, day4)?.getAttribute('aria-label')?.includes('有纪念卡') && calendarCell(root, day4), '月历当前月标记就绪');
  assert.ok(root.querySelector('.feast-calendar')?.querySelector('.feast-calendar-grid'), '日期条展开真实月历网格');
  assert.equal(calendarCell(root, todayDate).getAttribute('aria-pressed'), 'true', '初次打开月历选中今天');
  assert.equal(cardCell.getAttribute('aria-pressed'), 'false');
  const call = latestCall(setup.invocations, 'calendar');
  assert.deepEqual(call.args, ['2026-11']);
  assert.equal(call.result.ok, true); assert.equal(call.result.month, '2026-11'); assert.equal(call.result.today, todayDate);
  const [calendarYear, calendarMonth] = call.args[0].split('-').map(Number);
  const expectedMonthDays = new Date(Date.UTC(calendarYear, calendarMonth, 0)).getUTCDate();
  assert.equal(call.result.days.length, expectedMonthDays);
  const day = (date) => call.result.days.find((item) => item.date === date);
  assert.deepEqual([day(day3).hasActual, day(day3).hasCards], [true, false]);
  assert.deepEqual([day(day4).hasActual, day(day4).hasCards], [true, true]);
  assert.deepEqual([day(unknown).hasActual, day(unknown).hasCards], [null, null]);
  assert.ok(day(unknown).issues.length >= 2);
  assert.deepEqual(day(future), { date: future, hasActual: null, hasCards: null, issues: [] });
  const cellCopy = (cell) => cell.findAll(() => true).map((n) => `${n.textContent} ${n.title ?? ''} ${n.getAttribute('aria-label') ?? ''}`).join(' ');
  assert.match(cellCopy(calendarCell(root, day3)), /实际|实录/);
  assert.doesNotMatch(cellCopy(calendarCell(root, day3)), /有纪念卡|已有纪念卡/);
  assert.match(cellCopy(cardCell), /实际|实录/); assert.match(cellCopy(cardCell), /纪念卡/);
  assert.match(cellCopy(calendarCell(root, unknown)), /未知|不可读|读取失败|损坏|部分记录暂时无法读取/);
  const disabled = calendarCell(root, future);
  assert.equal(disabled.disabled, true); disabled.click();
  assert.ok(!setup.invocations.some((call) => call.method === 'review' && call.args[0] === future));
  openCalendar(root);
  const requests = setup.invocations.filter((entry) => entry.method === 'calendar').length;
  const timer = setup.intervals.find((entry) => entry.ms === 60_000);
  assert.ok(timer); timer.fn();
  await waitFor(() => setup.invocations.filter((entry) => entry.method === 'list').length >= 2 && latestCall(setup.invocations, 'list')?.result, '关闭月历后今天快照走一拍');
  await endTurn();
  assert.equal(setup.invocations.filter((entry) => entry.method === 'calendar').length, requests, '关闭后不轮询月历');
});

test('历史阅读链：计划、实际与纪念卡独立，失败保留旧日期，快照、刷新和跨面板还原阅读位置', async () => {
  const clock = testClock();
  let fail = false;
  const setup = await mountPanels({ clock, storage: memoryStorage(), invokeHook: (call, next) => {
    if (fail && call.method === 'review' && call.args[0] === day3) return { ok: false, message: '目标日期读取暂时失败' };
    return next();
  } });
  await seedPast(setup, day4, '历史星期三', true);
  const root = await setup.mount('today');
  assert.ok(root.querySelector('.feast-current-plan'));
  previousDay(root);
  const card = await waitFor(() => root.querySelector('.feast-memory-card'), '昨日的纪念卡');
  assert.match(card.textContent, /历史星期三纪念卡/);
  card.open = true; card.fire('toggle');
  assert.match(root.querySelector('.feast-journal').textContent, /历史星期三的实录/);
  assert.ok(root.querySelectorAll('.feast-tl-row').some((row) => row.textContent.includes('历史星期三的安排')));
  assert.equal(root.querySelector('.feast-current-plan'), null, '历史日期不能混今天的此刻');
  assert.equal(root.querySelector('.feast-reminders'), null, '历史日期不能混今天的接下来');
  assert.equal(root.querySelector('.feast-tl-row.is-now'), null);
  const scroll = root.querySelector('.feast-seen')?.parentNode ?? root;
  readPosition(root, 175);
  if (scroll !== root) readPosition(scroll, 120);
  fail = true; previousDay(root);
  await waitFor(() => latestCall(setup.invocations, 'review')?.result?.ok === false && toastMatching(root, /暂未刷新.*原内容已保留/), '局部历史读取明确失败');
  assert.equal(root.querySelector('.feast-memory-card'), card, '失败留在今日之前的已读日期，不替换旧内容');
  clock.now += 86_400_000;
  setup.intervals.find((entry) => entry.ms === 60_000)?.fn();
  await endTurn();
  assert.equal(root.querySelector('.feast-memory-card'), card, '跨天后台更新不应挤掉正在看的历史');
  assert.equal(root.scrollTop, 175);
  await setup.mount('history');
  await setup.mount('today', { freshBundle: true });
  assert.match(root.querySelector('.feast-memory-card')?.textContent ?? '', /历史星期三纪念卡/);
  assert.equal(root.querySelector('.feast-memory-card').open, true, '刷新后保留正在展开阅读的纪念卡');
  assert.equal(latestCall(setup.invocations, 'review').args[0], day4);
  assert.equal(root.scrollTop, 175, '刷新或跨面板后还原历史阅读位置');
  nextDay(root);
  await waitFor(() => latestCall(setup.invocations, 'review')?.args[0] === todayDate && latestCall(setup.invocations, 'review')?.result, '从历史日期走下一天');
  returnToday(root);
  await waitFor(() => dateControl(root, '2026-11-06') && root.querySelector('.feast-seen') === null, '回到服务端今天');
});

test('日期快速切换：晚到的 review、list、calendar 不能覆盖较新的日期选择', async () => {
  let delay = false;
  const reads = deferInvocations((call) => delay && ['review', 'list', 'calendar'].includes(call.method));
  const setup = await mountPanels({ invokeHook: reads.hook });
  await seedPast(setup, day3, '第三天'); await seedPast(setup, day4, '第四天');
  const root = await setup.mount('today');
  delay = true;
  const timer = setup.intervals.find((entry) => entry.ms === 60_000);
  timer.fn();
  const background = await reads.take((call) => call.method === 'list', '今天后台读正在等待');
  openCalendar(root);
  const november = await reads.take((call) => call.method === 'calendar' && call.args[0] === '2026-11', '11 月月历正在等待');
  clickButton(root, /上一月|上一个月|上个月/);
  const october = await reads.take((call) => call.method === 'calendar' && call.args[0] === '2026-10', '已切至 10 月');
  october.resolve(await october.next());
  await waitFor(() => calendarCell(root, '2026-10-31'), '最新月历显示');
  november.resolve(await november.next());
  await endTurn();
  assert.ok(calendarCell(root, '2026-10-31'), '晚到的 11 月月历不能覆盖 10 月');
  assert.ok(!calendarCell(root, day3));
  openCalendar(root);
  // calendar 关上后用日期条启动旧 review，再用日历点选另一日，以免依赖相对日期计算的实现。
  previousDay(root);
  const older = await reads.take((call) => call.method === 'review' && call.args[0] === day4, '旧日期 review 正在等待');
  delay = false;
  openCalendar(root);
  if (!calendarCell(root, day3)) clickButton(root, /下一月|下一个月|下个月/);
  const cell = await waitFor(() => calendarCell(root, day3), '切换到包含目标日期的月历');
  cell.click();
  await waitFor(() => root.querySelector('.feast-journal')?.textContent.includes('第三天的实录'), '新日期 review 显示');
  const shown = nodeSnapshot(root);
  older.resolve(await older.next()); background.resolve(await background.next());
  await endTurn();
  assertUnchanged(root, shown, '旧 review/list 都不能覆盖新选中的历史日期');
});

test('局部快照：更新此刻、提醒和实际时不换输入节点，保护焦点、IME 和跨天未提交草稿', async () => {
  const clock = testClock();
  const setup = await mountPanels({ clock, cfg: { mealSlots: '18:00' } });
  await seedActual(setup.world);
  const root = await setup.mount('today');
  draftInputs(root); selectActual(root, 0);
  const title = root.querySelector('.feast-journal-title');
  const card = root.querySelector('.feast-card-title');
  const thread = threadInputOf(root);
  const form = changeFormOf(root);
  title.focus(); title.fire('compositionstart'); title.value = '正在组词的未定稿';
  title.setSelectionRange(2, 3); title.fire('input', { isComposing: true });
  clock.now += 2 * 60_000;
  await setup.world.tools().find(({ name }) => name === 'feast_skip').handler({});
  await setup.world.tools().find(({ name }) => name === 'feast_eat').handler({ dish: '东坡肉' });
  const timer = setup.intervals.find((entry) => entry.ms === 60_000);
  timer.fn();
  await waitFor(() => root.querySelector('.feast-current-plan')?.textContent.includes('12:07')
    && root.querySelector('.feast-reminders')?.textContent.includes('她说今天不吃了')
    && root.querySelector('.feast-journal')?.textContent.includes('东坡肉'), '草稿期间三块快照都局部更新');
  assert.equal(root.querySelector('.feast-journal-title'), title);
  assert.equal(root.querySelector('.feast-card-title'), card);
  assert.equal(threadInputOf(root), thread); assert.equal(changeFormOf(root), form);
  assert.equal(document.activeElement, title); assert.deepEqual([title.selectionStart, title.selectionEnd], [2, 3]);
  assert.equal(title.value, '正在组词的未定稿');
  const selected = root.querySelectorAll('.feast-actual-row').filter((row) => row.querySelector('input')?.checked);
  assert.equal(selected.length, 1);
  assert.match(selected[0].textContent, /读了一章书/, '更新实际流后仍保留原记录的选择');
  title.fire('compositionend');
  clock.now += 86_400_000; timer.fn();
  await waitFor(() => latestCall(setup.invocations, 'list')?.result?.date === '2026-11-06', '跨日快照返回');
  await endTurn();
  assert.ok(root.contains(title), '跨天有未提交草稿时不能切走整页');
  assert.equal(title.value, '正在组词的未定稿');
  assert.equal(card.value, '还没保存的卡标题');
});

test('Today 卸载时取消定时器，晚到的日期响应与快照不再写回 DOM', async () => {
  let delay = false;
  const reads = deferInvocations((call) => delay && ['list', 'review'].includes(call.method));
  const setup = await mountPanels({ invokeHook: reads.hook });
  await seedPast(setup, day4, '卸载前的历史');
  const root = await setup.mount('today');
  delay = true;
  setup.intervals.find((entry) => entry.ms === 60_000).fn();
  previousDay(root);
  const snapshot = await reads.take((call) => call.method === 'list', '卸载前 list 信号');
  const review = await reads.take((call) => call.method === 'review', '卸载前 review 信号');
  setup.panels.lastHandle.dispose();
  assert.ok(setup.intervals.every((entry) => entry.disposed));
  const detached = nodeSnapshot(root);
  snapshot.resolve(await snapshot.next()); review.resolve(await review.next());
  await endTurn();
  assertUnchanged(root, detached, '卸载后的 list/review 不能改写宿主树');
});

test('动作回执链：端菜、纪念卡和预设各有具体反馈，不能统一报「已保存」', async () => {
  const setup = await mountPanels({ persist: async () => {} });
  const root = await setup.mount('menu');
  await openDishCard(root, '麻婆豆腐');
  await waitFor(() => root.findByText('端给她'), '端菜按钮');
  root.findByText('端给她').click();
  await waitFor(() => latestCall(setup.invocations, 'feed')?.result?.ok && toastMatching(root, /端.*麻婆豆腐|麻婆豆腐.*(?:端|上桌)/), '端菜反馈点名菜品');
  await seedActual(setup.world);
  await setup.mount('today');
  selectActual(root, 0);
  setInput(root.querySelector('.feast-card-title'), '可核对的纪念卡');
  root.findByText('保存纪念卡').click();
  await waitFor(() => latestCall(setup.invocations, 'journal')?.result?.ok && root.querySelector('.feast-memory-card')
    && toastMatching(root, /纪念卡.*(?:保存|已)|保存.*纪念卡/), '明确反馈保存的是纪念卡');
  presetChoice(root, 'quiet'); root.findByText('预览修改').click();
  await waitFor(() => root.findByText('确认应用这套设置'), '预设预览');
  root.findByText('确认应用这套设置').click();
  await waitFor(() => latestCall(setup.invocations, 'style')?.args[0]?.action === 'apply' && latestCall(setup.invocations, 'style').result?.ok
    && toastMatching(root, /已应用安静陪伴|安静陪伴.*(?:已应用|已保存)/), '明确反馈应用的是预设');
});

test('写入成功但读取失败：纪念卡明确已完成且暂未更新，恢复读取不能重发写入', async () => {
  let rejectRead = false;
  const setup = await mountPanels({ invokeHook: async (call, next) => {
    if (rejectRead && ['list', 'review'].includes(call.method)) throw new Error('刷新期间断线');
    const result = await next();
    if (call.method === 'journal' && call.args[0]?.action === 'card' && result.ok) rejectRead = true;
    return result;
  } });
  await seedActual(setup.world);
  const root = await setup.mount('today');
  selectActual(root, 0); setInput(root.querySelector('.feast-card-title'), '已经写入的一张卡');
  const originalJournal = root.querySelector('.feast-journal');
  root.findByText('保存纪念卡').click();
  const status = await waitFor(() => toastMatching(root, /已完成.*(?:显示)?暂未更新|已保存.*(?:显示)?暂未更新/), '区分写入成功与读取失败');
  assert.doesNotMatch(status.textContent, /保存失败|写入失败/);
  assert.equal(root.querySelector('.feast-journal'), originalJournal, '刷新失败保留原内容和恢复入口');
  let stored = await setup.decl.invoke('today', 'review', [todayDate]);
  assert.equal(stored.journal.cards.length, 1); assert.equal(stored.journal.cards[0].title, '已经写入的一张卡');
  rejectRead = false;
  const retry = labeledButton(status, /重试|重新读取|刷新/);
  if (retry) retry.click();
  else setup.intervals.find((entry) => entry.ms === 60_000).fn();
  await waitFor(() => root.querySelector('.feast-memory-card')?.textContent.includes('已经写入的一张卡'), '只重读即可显示已完成的写入');
  assert.equal(setup.invocations.filter((entry) => entry.method === 'journal' && entry.args[0].action === 'card').length, 1);
  stored = await setup.decl.invoke('today', 'review', [todayDate]);
  assert.equal(stored.journal.cards.length, 1, '重试刷新不能产生第二张卡');
});

test('菜单端菜已完成但列表读取失败：明确显示暂未更新，重试只能读取不能重复投喂', async () => {
  let rejectRead = false;
  const setup = await mountPanels({ invokeHook: async (call, next) => {
    if (rejectRead && call.method === 'list') throw new Error('列表暂不可读');
    const result = await next();
    if (call.method === 'feed' && result.ok) rejectRead = true;
    return result;
  } });
  const root = await setup.mount('menu');
  await openDishCard(root, '麻婆豆腐');
  await waitFor(() => root.findByText('端给她'), '详情可端菜');
  root.findByText('端给她').click();
  const receipt = await waitFor(() => toastMatching(root, /已完成.*暂未更新/), '端菜完成且显示暂未更新');
  assert.doesNotMatch(receipt.textContent, /端菜失败|保存失败/);
  assert.equal((await setup.decl.invoke('menu', 'list', [{}])).pending.name, '麻婆豆腐');
  rejectRead = false;
  clickButton(receipt, /重试|刷新|重新读取/);
  await waitFor(() => root.querySelector('.feast-strip')?.textContent.includes('麻婆豆腐'), '只重读出已端菜品');
  assert.equal(setup.invocations.filter((call) => call.method === 'feed').length, 1);
});

test('套餐保存失败保留名字与勾选；成功后读失败明确已完成且仅重试读取', async () => {
  let failure = 'write';
  const setup = await mountPanels({ invokeHook: async (call, next) => {
    if (call.method === 'save' && failure === 'write') return { ok: false, message: '套餐写入失败，请保留草稿' };
    if (call.method === 'list' && failure === 'read') throw new Error('套餐列表暂不可读');
    const result = await next();
    if (call.method === 'save' && result.ok) failure = 'read';
    return result;
  } });
  const root = await setup.mount('combo');
  comboChips(root).find((chip) => chip.textContent.includes('麻婆豆腐')).click();
  const nameInput = () => root.findAll((n) => n.tagName === 'INPUT').find((n) => n.placeholder.includes('名字'));
  const save = () => root.querySelector('.feast-build').findByText('攒一桌');
  setInput(nameInput(), '失败也留住的一桌');
  save().click();
  await waitFor(() => latestCall(setup.invocations, 'save')?.result?.ok === false && toastMatching(root, /套餐写入失败/), '真实失败反馈');
  assert.equal(nameInput().value, '失败也留住的一桌');
  assert.ok(root.querySelectorAll('.feast-chip.is-on').some((chip) => chip.textContent.includes('麻婆豆腐')));
  failure = null;
  save().click();
  const receipt = await waitFor(() => toastMatching(root, /已完成.*暂未更新/), '写入已完成但显示暂未更新');
  assert.doesNotMatch(receipt.textContent, /保存失败|写入失败/);
  const stored = await setup.decl.invoke('combo', 'list', [{ resolve: false }]);
  assert.equal(stored.custom.filter((card) => card.name === '失败也留住的一桌').length, 1);
  failure = null;
  clickButton(receipt, /重试|刷新|重新读取/);
  await waitFor(() => root.querySelectorAll('.feast-set').some((card) => card.textContent.includes('失败也留住的一桌')), '刷新显示保存完成的套餐');
  assert.equal(setup.invocations.filter((call) => call.method === 'save').length, 2, '一次失败、一次成功，后续刷新不得重复写入');
});

test('菜单详情读取失败：保留原 grid、筛选与滚动，重试读取成功才切换详情', async () => {
  let failDish = true;
  const setup = await mountPanels({ invokeHook: (call, next) => {
    if (call.method === 'dish' && failDish) throw new Error('详情服务暂时不可用');
    return next();
  } });
  const root = await setup.mount('menu');
  const cuisine = root.querySelectorAll('select')[1];
  cuisine.value = '川菜'; cuisine.fire('change');
  await waitFor(() => latestCall(setup.invocations, 'list')?.result
    && root.querySelectorAll('.feast-card').length === lib.dishes.filter((dish) => dish.cuisine === '川菜').length, '分类列表就绪');
  setInput(root.findAll((node) => node.tagName === 'INPUT').find((node) => node.placeholder.includes('搜菜名')), '麻婆豆腐');
  await waitFor(() => latestCall(setup.invocations, 'list')?.args[0]?.query === '麻婆豆腐'
    && latestCall(setup.invocations, 'list')?.result && root.querySelectorAll('.feast-card').length === 1, '搜索最终结果就绪');
  const grid = root.querySelector('.feast-grid');
  const originalCards = nodeSnapshot(grid);
  const search = root.findAll((node) => node.tagName === 'INPUT').find((node) => node.placeholder.includes('搜菜名'));
  const selectedCuisine = root.querySelectorAll('select')[1];
  readPosition(root, 118);
  grid.querySelector('.feast-card').click();
  const failure = await waitFor(() => latestCall(setup.invocations, 'dish')?.error
    && toastMatching(root, /详情服务暂时不可用/), '详情读取失败反馈');
  assert.ok(root.querySelector('.feast-grid') === grid, '读取失败不摘除正在浏览的 grid');
  assertUnchanged(grid, originalCards, '原菜卡节点与内容均保留');
  assert.ok(root.contains(search) && root.contains(selectedCuisine), '失败后保留原筛选节点');
  assert.equal(search.value, '麻婆豆腐'); assert.equal(selectedCuisine.value, '川菜');
  assert.equal(root.scrollTop, 118); assert.equal(root.querySelector('.feast-detail'), null);
  const lists = setup.invocations.filter((call) => call.method === 'list').length;
  failDish = false;
  clickButton(failure, /重试|重新读取/);
  await waitFor(() => latestCall(setup.invocations, 'dish')?.result?.ok
    && root.querySelector('.feast-detail-n')?.textContent === '麻婆豆腐', '只读重试成功后打开详情');
  assert.equal(setup.invocations.filter((call) => call.method === 'dish').length, 2);
  assert.equal(setup.invocations.filter((call) => call.method === 'list').length, lists, '重试详情不重拉和重置列表');
  assert.ok(!setup.invocations.some((call) => ['feed', 'bite', 'take'].includes(call.method)), '读取失败或重试不触发投喂');
  clickButton(root, /回菜单|返回菜单/);
  await waitFor(() => root.querySelector('.feast-grid') && !root.querySelector('.feast-detail'), '详情返回原筛选');
  assert.equal(root.querySelectorAll('select')[1].value, '川菜');
  assert.equal(root.findAll((node) => node.tagName === 'INPUT').find((node) => node.placeholder.includes('搜菜名')).value, '麻婆豆腐');
  assert.equal(root.scrollTop, 118);
});

try {
  await report();
} finally {
  for (const panel of activePanels) panel.dispose();
  await Promise.allSettled(panelWorlds.map((world) => world.stop()));
  // panelRun只来自本次mkdtemp，清理范围不触碰其他测试或用户数据。
  await rm(panelRun, { recursive: true, force: true });
  Date.now = realTime;
  if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument); else delete globalThis.document;
  if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow); else delete globalThis.window;
  restoreGlobal('localStorage', originalStorage);
  restoreGlobal('getComputedStyle', originalComputedStyle);
}