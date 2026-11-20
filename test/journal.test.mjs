import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, report } from './harness.mjs';
import {
  actualForDate, cleanJournal, journalPath, memoryCardText, readJournal,
  withJournalTitle, withMemoryCard, writeJournal,
} from '../src/life/journal.js';

const DATE = '2026-11-19';
const NOW = Date.parse('2026-11-19T12:00:00Z');
const AT = Date.parse('2026-11-19T04:00:00Z');
const TZ = 'Asia/Shanghai';
const empty = (date = DATE) => ({ version: 1, date, title: '', cards: [] });
const meal = (extra = {}) => ({ id: 'noodles', name: '热汤面', at: AT, by: 'self', miss: false, bite: false, ...extra });
const play = (extra = {}) => ({ date: DATE, done: [{ at: AT + 1000, activity: '在窗边读书', note: '读到第三章' }], ...extra });
const actuals = () => actualForDate([meal()], play(), DATE);
const makeCard = (journal = empty(), options = {}) => withMemoryCard(journal, {
  title: '平常的一天', selectedIds: [actuals()[0].id], actual: actuals(), nowMs: NOW, id: 'card-1', ...options,
});

async function withDir(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'feed-world-journal-'));
  try { await fn(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}

function freeze(value) {
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) freeze(item);
    Object.freeze(value);
  }
  return value;
}

test('journalPath：目录固定，接受真实闰日并拒绝日期穿越和不存在日期', () => {
  assert.equal(journalPath('data', '2024-02-29'), join('data', 'feast', 'journal', '2024-02-29.json'));
  for (const date of [undefined, null, 20261119, '', '../state', '2026-11-19/../../state',
    '..\\state', '2026-11-19.json', '2026-1-01', '2026-11-19\n', '0000-01-01',
    '2025-02-29', '2026-02-30', '2026-04-31', '2026-00-01', '2026-13-01', '2026-11-00']) {
    assert.throws(() => journalPath('data', date), /合法.*YYYY-MM-DD/);
  }
});

test('readJournal：缺失返回独立空回顾，不创建目录', async () => {
  await withDir(async (dir) => {
    const first = await readJournal(dir, DATE);
    const second = await readJournal(dir, DATE);
    assert.deepEqual(first, empty());
    first.cards.push('changed');
    assert.deepEqual(second, empty());
    assert.deepEqual(await readdir(dir), []);
  });
});

test('actualForDate：按请求日期和时区过滤，不用 play.date 或当前日期替代', () => {
  const before = Date.parse('2026-11-18T15:59:59Z');
  const after = Date.parse('2026-11-18T16:00:00Z');
  const eaten = [meal({ at: before, name: '前一天' }), meal({ at: after, name: '当天零点' })];
  const records = { date: '1999-01-01', done: [
    { at: before, activity: '前一天活动', note: '' },
    { at: after, activity: '当天活动', note: '如实记录' },
  ] };
  assert.deepEqual(actualForDate(eaten, records, DATE, TZ).map((entry) => [entry.text, entry.hm]), [
    ['当天零点', '00:00'], ['当天活动', '00:00'],
  ]);
  assert.deepEqual(actualForDate(eaten, records, '2026-11-18', TZ).map((entry) => entry.text), ['前一天', '前一天活动']);
  assert.equal(actualForDate(eaten, records, DATE, 'UTC').length, 0);
  assert.equal(actualForDate(eaten, records, '2026-11-18', 'UTC').length, 4);
});

test('actualForDate：空记录也是空，不用日程、饭点或待做条目生成事实', () => {
  const plan = { date: DATE, title: '去海边', items: [{ start: '08:00', end: '10:00', activity: '去海边' }],
    fired: { '10:00': AT }, skippedSlots: { '12:00': { at: AT, doing: '上班' } } };
  assert.deepEqual(actualForDate(undefined, undefined, DATE), []);
  assert.deepEqual(actualForDate([], plan, DATE), []);
  assert.deepEqual(actualForDate([], { ...plan, done: plan.items }, DATE), []);
  assert.deepEqual(actualForDate([null, {}, meal({ at: NaN }), meal({ at: '123' }), meal({ id: '' })],
    { done: [null, {}, { at: AT, activity: '' }, { at: Infinity, activity: '坏时间' }] }, DATE), []);
});

test('actualForDate：即使无记录也严格拒绝非法日期和时区', () => {
  assert.throws(() => actualForDate([], null, '2026-02-30'), /日期/);
  for (const timezone of ['', null, {}, 'Not/AZone']) {
    assert.throws(() => actualForDate([], null, DATE, timezone), /时区/);
  }
});

test('actualForDate：字段完整，meal 明确区分尝了一口与吃过', () => {
  const actual = actualForDate([meal({ bite: true }), meal({ id: 'tea', name: '', bite: false })], play(), DATE);
  assert.deepEqual(Object.keys(actual[0]), ['id', 'at', 'hm', 'kind', 'text', 'note']);
  assert.deepEqual(actual.map(({ kind, text, note }) => ({ kind, text, note })), [
    { kind: 'meal', text: '热汤面', note: '尝了一口' },
    { kind: 'meal', text: 'tea', note: '吃过' },
    { kind: 'activity', text: '在窗边读书', note: '读到第三章' },
  ]);
  assert.equal(actual[0].hm, '12:00');
});

test('actualForDate：同毫秒不同记录及完全重复项都有确定且唯一的 ID', () => {
  const eaten = [meal(), meal(), meal({ by: 'owner' }), meal({ bite: true }), meal({ id: 'rice' })];
  const records = { done: [
    { at: AT, activity: '读书', note: '第一章' },
    { at: AT, activity: '读书', note: '第二章' },
    { at: AT, activity: '读书', note: '第一章' },
  ] };
  const first = actualForDate(eaten, records, DATE);
  assert.equal(new Set(first.map((entry) => entry.id)).size, 8);
  assert.deepEqual(first, actualForDate(structuredClone(eaten), structuredClone(records), DATE));
  assert.match(first[0].id, /^meal-[a-f0-9]{64}-1$/);
  assert.equal(first[1].id, first[0].id.replace(/-1$/, '-2'));
});

test('actualForDate：裁剪无关旧项不会改变现存记录 ID，不依赖保留列表全局索引', () => {
  const keptMeals = [meal(), meal({ id: 'soup' })];
  const keptPlay = play();
  const withOldMeals = [meal({ at: AT - 86_400_000 }), meal({ at: AT - 1000, id: 'old' }), ...keptMeals];
  const withOldPlay = { done: [{ at: AT - 1000, activity: '此前活动', note: '' }, ...keptPlay.done] };
  const full = actualForDate(withOldMeals, withOldPlay, DATE);
  const cropped = actualForDate(keptMeals, keptPlay, DATE);
  const identities = new Set(cropped.map((entry) => entry.id));
  assert.deepEqual(full.filter((entry) => identities.has(entry.id)), cropped);
});

test('actualForDate：按 at 正序稳定排序，同毫秒保留各源内顺序', () => {
  const eaten = [meal({ at: AT + 2000, name: '稍后' }), meal({ name: '同刻一' }), meal({ name: '同刻二' })];
  const records = { done: [{ at: AT, activity: '同刻活动一', note: '' },
    { at: AT - 1000, activity: '最早', note: '' }, { at: AT, activity: '同刻活动二', note: '' }] };
  assert.deepEqual(actualForDate(eaten, records, DATE).map((entry) => entry.text),
    ['最早', '同刻一', '同刻二', '同刻活动一', '同刻活动二', '稍后']);
});

test('actualForDate：不修改输入，活动备注保留，源记录无额外字段混入快照', () => {
  const eaten = freeze([meal({ internal: 'do not persist' })]);
  const records = freeze(play());
  const result = actualForDate(eaten, records, DATE);
  assert.equal(result[1].note, '读到第三章');
  assert.equal('internal' in result[0], false);
  result[1].note = 'modified';
  assert.equal(records.done[0].note, '读到第三章');
});

test('withJournalTitle：设置/清空手动标题，深拷贝且不修改旧回顾', () => {
  const journal = freeze(makeCard());
  const next = withJournalTitle(journal, { title: '  认真吃饭的一天  ' });
  assert.equal(next.title, '认真吃饭的一天');
  assert.equal(journal.title, '');
  assert.deepEqual(next.cards, journal.cards);
  next.cards[0].entries[0].text = 'later mutation';
  assert.equal(journal.cards[0].entries[0].text, '热汤面');
  assert.equal(withJournalTitle(next, { title: '  ' }).title, '');
  assert.equal(withJournalTitle(next, { title: '' }).title, '');
});

test('标题：最多 60 个 Unicode 字符，不静默裁剪或接受非文字/控制字符', () => {
  assert.equal(withJournalTitle(empty(), { title: '鱼'.repeat(60) }).title.length, 60);
  assert.equal([...withJournalTitle(empty(), { title: '🐟'.repeat(60) }).title].length, 60);
  for (const title of [undefined, null, 3, {}, [], '鱼'.repeat(61), '🐟'.repeat(61), '第一行\n第二行', 'a\tb', 'a\u0000b']) {
    assert.throws(() => withJournalTitle(empty(), { title }), /标题/);
  }
  for (const title of [null, 42, '字'.repeat(61), 'a\nb']) {
    assert.throws(() => makeCard(empty(), { title }), /标题/);
  }
  assert.equal(makeCard(empty(), { title: undefined }).cards[0].title, '');
  assert.equal(makeCard(empty(), { title: ' ' }).cards[0].title, '');
});

test('withMemoryCard：主动选取 1–2 条，字段完整，按时间保存可信独立快照', () => {
  const actual = actuals();
  const original = freeze(empty());
  const next = makeCard(original, { selectedIds: [actual[1].id, actual[0].id], actual });
  assert.deepEqual(next.cards[0], { id: 'card-1', createdAt: NOW, title: '平常的一天', entries: actual });
  assert.deepEqual(original, empty());
  actual[0].text = '源列表被改';
  actual[1].note = '源备注被改';
  actual.splice(0);
  assert.equal(next.cards[0].entries[0].text, '热汤面');
  assert.equal(next.cards[0].entries[1].note, '读到第三章');
});

test('withMemoryCard：拒绝空选、选错、重复、超量和非文字 ID', () => {
  const [a, b] = actuals();
  for (const selectedIds of [undefined, null, [], [a.id, a.id], [a.id, b.id, 'third'],
    ['not-current'], [a.id, 'stale'], [''], [null], [123], 'not-array']) {
    assert.throws(() => makeCard(empty(), { selectedIds }), /实际记录|ID|请选择/);
  }
});

test('withMemoryCard：空实际记录、歧义 ID 与自由编写 entries 均明确拒绝', () => {
  for (const actual of [undefined, null, [], {}]) {
    assert.throws(() => makeCard(empty(), { actual }), /实际记录为空/);
  }
  const actual = actuals();
  assert.throws(() => makeCard(empty(), { actual: [actual[0], actual[0]] }), /ID 重复/);
  assert.throws(() => makeCard(empty(), { entries: actual }), /不能自由编写 entries/);
  assert.throws(() => withMemoryCard(empty(), { entries: actual }), /不能自由编写 entries/);
  assert.throws(() => makeCard(empty(), { actual: [{ ...actual[0], plan: 'invented' }] }), /字段或结构/);
});

test('withMemoryCard：默认随机 UUID，可注入 ID，重复卡 ID 不覆盖原卡', () => {
  const first = makeCard(empty(), { id: undefined });
  const second = makeCard(empty(), { id: undefined });
  assert.match(first.cards[0].id, /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
  assert.notEqual(first.cards[0].id, second.cards[0].id);
  const journal = makeCard();
  assert.throws(() => makeCard(journal), /纪念卡 ID 不能重复/);
  assert.equal(journal.cards.length, 1);
  for (const id of ['', null, 123, 'x'.repeat(129), 'card\n2']) {
    assert.throws(() => makeCard(empty(), { id }), /纪念卡 ID/);
  }
});

test('withMemoryCard：实际记录日期必须匹配回顾，不能用标签或展示时刻伪装日期', () => {
  const wrongDate = actualForDate([meal({ at: AT - 86_400_000 })], null, '2026-11-18');
  assert.throws(() => makeCard(empty(), { selectedIds: [wrongDate[0].id], actual: wrongDate }), /日期与回顾日期不一致/);
  const actual = actuals();
  actual[0].hm = '13:00';
  assert.throws(() => makeCard(empty(), { actual }), /时刻与指定时区不一致/);
});

test('withMemoryCard：拒绝未来记录及未来日期，不因选中列表中存在而放行', () => {
  const future = actualForDate([meal({ at: NOW + 1 })], null, DATE);
  assert.throws(() => makeCard(empty(), { selectedIds: [future[0].id], actual: future }), /未来记录/);
  const tomorrow = '2026-11-20';
  const tomorrowActual = actualForDate([meal({ at: NOW + 86_400_000 })], null, tomorrow);
  assert.throws(() => makeCard(empty(tomorrow), { selectedIds: [tomorrowActual[0].id], actual: tomorrowActual }), /未来日期/);
  for (const nowMs of [NaN, Infinity, '123', null, 8_640_000_000_000_001, 1.1]) {
    assert.throws(() => makeCard(empty(), { nowMs }), /当前时间/);
  }
  assert.throws(() => makeCard(empty(), { timezone: 'Not/AZone' }), /时区/);
});

test('withMemoryCard：时区参数同时决定日期、未来日期和实际时刻', () => {
  const timezone = 'America/New_York';
  const at = Date.parse('2026-11-19T01:00:00Z');
  const nowMs = Date.parse('2026-11-19T02:00:00Z');
  const date = '2026-11-18';
  const actual = actualForDate([meal({ at })], null, date, timezone);
  const journal = makeCard(empty(date), { actual, selectedIds: [actual[0].id], nowMs, timezone });
  assert.equal(journal.cards[0].entries[0].hm, '20:00');
  assert.throws(() => makeCard(empty(date), { actual, selectedIds: [actual[0].id], nowMs }), /日期与回顾日期不一致/);
  assert.throws(() => makeCard(empty(DATE), { nowMs, timezone }), /未来日期/);
});

test('withMemoryCard：每日期最多 12 卡，满后明确拒绝而非自动裁剪', () => {
  let journal = empty();
  for (let i = 1; i <= 12; i += 1) journal = makeCard(journal, { id: `card-${i}` });
  const before = structuredClone(journal);
  assert.throws(() => makeCard(journal, { id: 'card-13' }), /已满 12 张/);
  assert.deepEqual(journal, before);
  assert.equal(journal.cards[0].id, 'card-1');
  const oversized = { ...journal, cards: [...journal.cards, { ...journal.cards[0], id: 'card-13' }] };
  assert.throws(() => cleanJournal(oversized), /最多保存 12 张/);
});

test('cleanJournal：严格拒绝版本、结构、重复 ID、坏字段与未来快照，不静默清洗', () => {
  const good = makeCard();
  const card = good.cards[0];
  const entry = card.entries[0];
  const cases = [
    null, [], {}, { ...good, version: 2 }, { ...good, title: null }, { ...good, cards: {} },
    { ...good, planned: [] }, { ...good, date: '2026-02-30' },
    { ...good, cards: [card, card] },
    { ...good, cards: [{ ...card, entries: [] }] },
    { ...good, cards: [{ ...card, entries: [entry, entry] }] },
    { ...good, cards: [{ ...card, entries: [entry, entry, entry] }] },
    { ...good, cards: [{ ...card, createdAt: '123' }] },
    { ...good, cards: [{ ...card, title: '字'.repeat(61) }] },
    { ...good, cards: [{ ...card, entries: [{ ...entry, hm: '24:00' }] }] },
    { ...good, cards: [{ ...card, entries: [{ ...entry, text: '' }] }] },
    { ...good, cards: [{ ...card, entries: [{ ...entry, kind: 'plan' }] }] },
    { ...good, cards: [{ ...card, entries: [{ ...entry, note: '计划吃' }] }] },
    { ...good, cards: [{ ...card, entries: [{ ...entry, at: NOW + 1 }] }] },
  ];
  for (const bad of cases) assert.throws(() => cleanJournal(bad), /生活回顾记录无效/);
  assert.throws(() => cleanJournal(good, '2026-11-18'), /文件日期/);
  assert.deepEqual(cleanJournal(good), good);
});

test('真实存取：首次创建目录，往返快照，二次写入用安全存储备份旧档', async () => {
  await withDir(async (dir) => {
    const actual = actuals();
    const journal = makeCard(empty(), { actual, selectedIds: actual.map((entry) => entry.id) });
    const saved = await writeJournal(dir, journal);
    assert.deepEqual(saved, journal);
    const file = journalPath(dir, DATE);
    const firstContents = await readFile(file, 'utf8');
    assert.deepEqual(await readJournal(dir, DATE), journal);
    journal.cards[0].entries[0].text = '调用方修改';
    actual.length = 0;
    assert.equal(saved.cards[0].entries[0].text, '热汤面');
    assert.equal((await readJournal(dir, DATE)).cards[0].entries[0].text, '热汤面');
    const updated = withJournalTitle(saved, { title: '留住这一天' });
    await writeJournal(dir, updated);
    assert.equal(await readFile(`${file}.bak`, 'utf8'), firstContents);
    assert.deepEqual(await readJournal(dir, DATE), updated);
    assert.deepEqual((await readdir(join(dir, 'feast', 'journal'))).sort(), [`${DATE}.json`, `${DATE}.json.bak`]);
  });
});

test('真实存取：源列表被裁空后，卡的完整饮食/活动快照仍留在独立文件', async () => {
  await withDir(async (dir) => {
    const eaten = [meal({ bite: true })];
    const records = play();
    const actual = actualForDate(eaten, records, DATE);
    const journal = makeCard(empty(), { actual, selectedIds: actual.map((entry) => entry.id) });
    const expected = structuredClone(journal.cards[0].entries);
    await writeJournal(dir, journal);
    eaten.splice(0);
    records.done.splice(0);
    assert.deepEqual(actualForDate(eaten, records, DATE), []);
    assert.deepEqual((await readJournal(dir, DATE)).cards[0].entries, expected);
    assert.equal(expected[0].note, '尝了一口');
    assert.equal(expected[1].note, '读到第三章');
  });
});

test('真实存取：自定义时区卡不会在读回时被默认上海日期误判', async () => {
  await withDir(async (dir) => {
    const date = '2026-11-18';
    const timezone = 'America/New_York';
    const at = Date.parse('2026-11-19T01:00:00Z');
    const actual = actualForDate([meal({ at })], null, date, timezone);
    const journal = makeCard(empty(date), { actual, selectedIds: [actual[0].id], timezone,
      nowMs: Date.parse('2026-11-19T02:00:00Z') });
    await writeJournal(dir, journal);
    assert.deepEqual(await readJournal(dir, date), journal);
  });
});

test('损坏 JSON：读取和写入均抛错，主档和有效备份逐字不动', async () => {
  await withDir(async (dir) => {
    const file = journalPath(dir, DATE);
    await mkdir(join(dir, 'feast', 'journal'), { recursive: true });
    const damaged = '{broken exactly';
    const backup = JSON.stringify(empty());
    await writeFile(file, damaged);
    await writeFile(`${file}.bak`, backup);
    await assert.rejects(readJournal(dir, DATE), /损坏.*原文件已保留/);
    await assert.rejects(writeJournal(dir, empty()), /损坏.*原文件已保留/);
    assert.equal(await readFile(file, 'utf8'), damaged);
    assert.equal(await readFile(`${file}.bak`, 'utf8'), backup);
  });
});

test('语义损坏旧档：有效 JSON 也不能覆盖或污染已有备份', async () => {
  await withDir(async (dir) => {
    const file = journalPath(dir, DATE);
    await mkdir(join(dir, 'feast', 'journal'), { recursive: true });
    const backup = JSON.stringify(makeCard());
    await writeFile(`${file}.bak`, backup);
    const malformed = [
      [], { ...empty(), version: 2 }, { ...empty(), cards: [{ id: 'lost' }] },
      { ...empty(), date: '2026-11-18' }, { ...empty(), title: 'x'.repeat(61) },
      { ...empty(), cards: [makeCard().cards[0], makeCard().cards[0]] },
    ];
    for (const raw of malformed) {
      const original = JSON.stringify(raw, null, 2);
      await writeFile(file, original);
      await assert.rejects(readJournal(dir, DATE), /损坏.*原文件已保留/);
      await assert.rejects(writeJournal(dir, empty()), /损坏.*原文件已保留/);
      assert.equal(await readFile(file, 'utf8'), original);
      assert.equal(await readFile(`${file}.bak`, 'utf8'), backup);
    }
  });
});

test('无效新数据/穿越日期拒写，不影响有效主档和备份，不产生其他文件', async () => {
  await withDir(async (dir) => {
    await writeJournal(dir, empty());
    await writeJournal(dir, withJournalTitle(empty(), { title: '有效标题' }));
    const file = journalPath(dir, DATE);
    const before = await readFile(file, 'utf8');
    const backup = await readFile(`${file}.bak`, 'utf8');
    await assert.rejects(writeJournal(dir, { ...empty(), cards: 'bad' }), /生活回顾记录无效/);
    for (const date of ['../outside', '2026-02-30']) {
      await assert.rejects(readJournal(dir, date), /日期/);
      await assert.rejects(writeJournal(dir, { ...empty(), date }), /日期/);
    }
    assert.equal(await readFile(file, 'utf8'), before);
    assert.equal(await readFile(`${file}.bak`, 'utf8'), backup);
    assert.deepEqual(await readdir(dir), ['feast']);
  });
});

test('I/O 错误不是缺失：主档为目录、备份位置为目录时明确失败且主档不动', async () => {
  await withDir(async (dir) => {
    const file = journalPath(dir, DATE);
    await mkdir(file, { recursive: true });
    await assert.rejects(readJournal(dir, DATE), /读取失败/);
    await assert.rejects(writeJournal(dir, empty()), /读取失败/);
  });
  await withDir(async (dir) => {
    await writeJournal(dir, empty());
    const file = journalPath(dir, DATE);
    const before = await readFile(file, 'utf8');
    await mkdir(`${file}.bak`);
    await assert.rejects(writeJournal(dir, withJournalTitle(empty(), { title: '改名' })), /备份失败/);
    assert.equal(await readFile(file, 'utf8'), before);
  });
});

test('计划/事实边界：手动标题和纪念卡只写 journal，不读取、修改或实化日程', async () => {
  await withDir(async (dir) => {
    const planFile = join(dir, 'feast', 'life', `${DATE}.json`);
    await mkdir(join(dir, 'feast', 'life'), { recursive: true });
    const plan = { date: DATE, title: '计划登月', source: 'manual', items: [{ start: '18:00', end: '19:00', activity: '登月' }] };
    const planContents = JSON.stringify(plan, null, 2);
    await writeFile(planFile, planContents);
    assert.deepEqual(actualForDate([], plan, DATE), []);
    let journal = withJournalTitle(await readJournal(dir, DATE), { title: '自己的手动小标题' });
    journal = makeCard(journal, { title: '计划登月只是我写的标题' });
    await writeJournal(dir, journal);
    assert.equal(await readFile(planFile, 'utf8'), planContents);
    const saved = await readJournal(dir, DATE);
    assert.equal(saved.title, '自己的手动小标题');
    assert.deepEqual(saved.cards[0].entries.map((entry) => entry.text), ['热汤面']);
    assert.equal('items' in saved, false);
    assert.equal('source' in saved, false);
  });
});

test('memoryCardText：可读纯文本，明确区分手动标题、实际饮食/活动及原始备注', () => {
  const actual = actualForDate([meal({ bite: true })], play(), DATE);
  const card = makeCard(empty(), { actual, selectedIds: actual.map((entry) => entry.id), title: '计划登月只是标题' }).cards[0];
  const text = memoryCardText(DATE, card);
  assert.equal(text, `生活纪念卡 · ${DATE}\n手动标题：计划登月只是标题\n实际记录：\n12:00 · 饮食：热汤面（尝了一口）\n12:00 · 活动：在窗边读书（读到第三章）`);
  assert.equal(text.includes('<'), false);
  assert.equal(text.includes('完成了'), false);
  assert.match(memoryCardText(DATE, { ...card, title: '' }), /手动标题：\（未填写\）/);
  assert.throws(() => memoryCardText('../bad', card), /日期/);
  assert.throws(() => memoryCardText(DATE, { ...card, entries: [] }), /1–2 条实际记录/);
});

await report();
