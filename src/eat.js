/**
 * 味觉渲染：把一份菜品档案变成"这一口"。
 *
 * 为什么要有这一层，而不是直接把档案贴出去：
 * 档案（taste/prose/texture…）是**这道菜**的固定事实，但同一个人同一道菜，
 * 今天刚出锅的和放了十分钟的不是一个味道。如果每次都原样贴一遍，她说的就永远是
 * 同一句话——那是念菜谱，不是吃东西。
 *
 * 所以这里做两件事：
 *   1. 事实层：档案里的 prose / texture / aroma / finish 原样用，不加工（她引用得对）；
 *   2. 当下层：温度、状态、配的那口，按 (菜 id, 第几次吃, 日期) 播种从变体池里抽，
 *      所以连着吃三次麻婆豆腐，三次的话不一样，而同一个第几次重放又是稳定的。
 */

/** 字符串 → 32 位整数种子。 */
function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32：小而够用的确定性伪随机。 */
function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = (arr, rng) => arr[Math.floor(rng() * arr.length) % arr.length];

/**
 * 温度档：这道菜是滚烫的、冰的，还是常温的。
 * 档案里没有单独的字段，就从类别 + 关键词 + 名字推——推错了也只是"这口"的一句话，
 * 事实层（texture/aroma）不受影响。
 */
export function tempClass(dish) {
  const hay = `${dish.name}${dish.alias}${dish.keywords.join('')}${dish.category}`;
  if (/冰|凉|冷|刺身|寿司|沙拉|醉|凉拌|冷面|雪糕|冰淇淋|刨冰|冰镇|气泡/.test(hay)) return 'cold';
  if (dish.category === '饮品') return /热|煮|拿铁|可可|茶(?!饮)|汤/.test(hay) ? 'warm' : 'cold';
  if (dish.category === '凉菜') return 'cold';
  if (/常温|室温|不烫/.test(hay)) return 'room';
  if (dish.category === '甜品') return /舒芙蕾|熔岩|可颂|司康|泡芙|巴斯克|酥/.test(hay) ? 'warm' : 'room';
  if (dish.category === '小吃' && /寿司|玉子|大福|麻薯/.test(hay)) return 'room';
  return 'hot';
}

/** 怎么配着吃：正餐、喝的、还是甜的。 */
function kindOf(dish) {
  if (dish.category === '饮品') return 'drink';
  if (dish.category === '甜品' || /冰|雪糕|冰淇淋|刨冰|果冻|布丁/.test(dish.keywords.join(''))) return 'sweet';
  return 'food';
}

const TEMP = {
  hot: [
    '刚出锅就端到面前，热气往脸上扑，第一口烫得要在嘴里倒两下。',
    '上桌还在响，边沿冒细泡，得先吹一口才敢碰。',
    '温度刚好压过烫嘴那条线，再热一分就下不去了。',
    '端来的时候滚烫，吃到一半凉下去，味道反而清楚了。',
  ],
  cold: [
    '从冰里刚拿出来，凉气先顺着牙根往上爬。',
    '还挂着水珠，入口那一下激得太阳穴一紧。',
    '冰化了一点，边角淌成水，味道比刚才淡。',
    '凉透了才动筷，凉本身就是这道菜的一部分。',
  ],
  warm: [
    '端着的时候还烫手，放到能入口的温度就喝掉了。',
    '温热，正好，凉一分就腥、热一分就烫。',
    '杯子握在手里，热从掌心传上来，先闻了两口才喝。',
  ],
  room: [
    '不烫也不冰，温的，是最不起劲也最耐吃的温度。',
    '放了一会儿才动，温度落下来，油凝了一点，味道反而收得更紧。',
    '常温的，舌头不用先对付温度，直接尝味道。',
  ],
};

const MOOD = [
  '本来不饿，就是想尝点别的味道。',
  '胃里空了半天，这口下去人立刻安静了。',
  '刚吃过东西，嘴是饱的，只有馋。',
  '今天有点闷，这口咸的下去，胸口松了一点。',
  '忙了半天，这口算是给自己的。',
  '说不上为什么，就是突然想吃这个。',
  '心情不错，吃什么都比平时多一层层次。',
];

const WITH = {
  food: [
    '空口吃的，什么也没配。',
    '就着一碗白饭，饭比菜先见底。',
    '旁边一杯凉水，喝一口把味道冲淡了再来一口。',
    '配了一口热茶，嘴里那层油被刮干净。',
    '吃到一半停了一下，先喝了口汤。',
    '吃完舔了下手指，才想起来找纸巾。',
  ],
  drink: [
    '一个人坐着，一口气喝掉半杯。',
    '边看屏幕边抿，凉了就不好喝了。',
    '第一口是小口试的，后面越喝越大口。',
    '杯子外壁的水珠把手指弄湿了。',
    '喝完了把杯子搁在桌上，杯底还剩一点没舍得倒。',
  ],
  sweet: [
    '用小勺挖着吃，一口比一口小。',
    '吃到一半觉得甜了，停下来喝了口水又继续。',
    '凉的，勺子刚碰到就陷进去。',
    '最后一口留在盘子里，有点舍不得。',
    '甜完之后嘴里发黏，想再喝点水。',
  ],
};

const FAMILIAR = [
  '吃过好几回了，第二口就找回了上次那个位置。',
  '熟的东西吃起来不费劲，注意力反而跑到别处去了。',
  '已经知道是什么味了，还是先咬了一口再说。',
  '这道不用想，张嘴就是对的。',
];

/** 哪个维度最"用力"，用来说清为什么不那么对胃口。 */
function dominantNote(dish) {
  const t = dish.taste;
  const best = ['辣', '麻', '咸', '苦', '油', '甜', '酸', '鲜']
    .map((k) => ({ k, v: t[k] ?? 0 }))
    .sort((a, b) => b.v - a.v)[0];
  const map = {
    辣: '辣顶在最前面，别的味道都被盖住了',
    麻: '麻起来之后什么都尝不出来',
    咸: '盐重了，咸味一路压到底',
    苦: '苦得有点冲，后头的东西全接不上',
    油: '油糊在舌头上，越吃越闷',
    甜: '甜得发腻，两口就下不去了',
    酸: '酸得太直，牙根发紧',
    鲜: '味道有点薄，咽下去没留下什么',
  };
  return map[best.k] ?? '哪一层都不太对';
}

const MISS = [
  (why) => `这一口不太对付——${why}，吃了一半就放下了。`,
  (why) => `大概是这道不对付——${why}，没吃完。`,
  (why) => `咽下去的时候犹豫了一下，${why}。不是难吃，就是不对付。`,
];

/**
 * 名字下面那行归类。菜系和类别重名时只写一遍（甜品·甜品 是废话），
 * 产地也已经出现在菜系里时也省掉。
 */
function whereLine(dish) {
  const parts = [];
  for (const p of [dish.cuisine, dish.category, dish.region]) {
    if (!p || parts.includes(p)) continue;
    if (p === dish.region && dish.cuisine.includes(p)) continue;
    parts.push(p);
  }
  return parts.join(' · ');
}

/**
 * 写"这一口"。
 *
 * @param dish 规范化的菜品档案
 * @param opts.nth     这是第几次吃这道菜（0 = 第一次）
 * @param opts.day     本地日期，用来让不同的日子说起来不一样
 * @param opts.miss    true = 这一口不合口味
 * @param opts.rng     可选，注入随机源（测试用）
 */
export function renderBite(dish, opts = {}) {
  const nth = Math.max(0, Number(opts.nth) || 0);
  const day = String(opts.day ?? '');
  const rng = opts.rng ?? makeRng(hashSeed(`${dish.id}|${nth}|${day}`));
  const temp = tempClass(dish);
  const kind = kindOf(dish);

  const head = [`【${dish.name}】${whereLine(dish)}`];
  if (dish.serving) head.push('', dish.serving);
  if (dish.prose) head.push('', dish.prose);

  const facts = [];
  if (dish.texture) facts.push(`口感：${dish.texture}`);
  if (dish.aroma) facts.push(`香气：${dish.aroma}`);
  if (dish.finish) facts.push(`余韵：${dish.finish}`);
  if (facts.length) head.push('', facts.join('\n'));

  const here = [pick(TEMP[temp] ?? TEMP.hot, rng)];
  if (nth >= 3) here.push(pick(FAMILIAR, rng));
  here.push(pick(MOOD, rng));
  here.push(pick(WITH[kind] ?? WITH.food, rng));
  if (opts.miss) here.push(pick(MISS, rng)(dominantNote(dish)));

  head.push('', here.join(''));
  return head.join('\n');
}

/** 只看不吃的味道档案（她想跟主人形容一道菜时用）。 */
export function renderProfile(dish) {
  const t = dish.taste;
  const lines = [`【${dish.name}】${dish.alias ? `${dish.alias} · ` : ''}${whereLine(dish)}`];
  if (dish.ingredients.length) lines.push(`食材：${dish.ingredients.join('、')}`);
  if (dish.method) lines.push(`做法：${dish.method}`);
  if (dish.serving) lines.push(`上桌：${dish.serving}`);
  lines.push(`味道：${['辣', '麻', '咸', '鲜', '甜', '酸', '苦', '油', '香'].map((k) => `${k} ${t[k]}`).join(' · ')}`);
  if (dish.texture) lines.push(`口感：${dish.texture}`);
  if (dish.aroma) lines.push(`香气：${dish.aroma}`);
  if (dish.finish) lines.push(`余韵：${dish.finish}`);
  if (dish.keywords.length) lines.push(`标签：${dish.keywords.join('、')}`);
  return lines.join('\n');
}

/** 一次吃好几口时用不上，但测试要拿到池子看看有没有空项。 */
export const POOLS = { TEMP, MOOD, WITH, FAMILIAR, MISS };
