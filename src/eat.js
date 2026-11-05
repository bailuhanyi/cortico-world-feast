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
 *   2. 当下层：温度、这一回该用哪个角度、状态、配的那口，按 (菜 id, 第几次吃, 日期) 播种
 *      从变体池里抽，所以连着吃三次麻婆豆腐，三次的话不一样，而同一个第几次重放又是稳定的。
 *      角度是按「第几回」分档硬绑的（见 ANGLE）：第一回说第一印象，第二回说吃了一半怎么变，
 *      第三回起说熟客的例行——同一道菜连着吃两次也不会撞词。
 */

// 种子算法在 rand.js：「这一桌」也要用同一份，两边重一份实现迟早会漂。
import { hashSeed, makeRng } from './rand.js';

const pick = (arr, rng) => arr[Math.floor(rng() * arr.length) % arr.length];

/**
 * 温度档：这道菜是滚烫的、冰的，还是常温的。
 * 档案里没有单独的字段，就从类别 + 关键词 + 名字推——推错了也只是"这口"的一句话，
 * 事实层（texture/aroma）不受影响。
 *
 * `warm` 和 `warmSweet` 的句子必须分开：前者照饮品写的（"就喝掉了""杯子握在手里"），
 * 端给舒芙蕾、巴克拉瓦、热蛋挞就全错了——那是用勺子吃的东西，不是喝的。
 */
/** 关键词里真正说明"这道菜是凉的"的：冷藏、冷冻、冰凉、冰镇、冷食。 */
const COLD_KW = /^(冷藏|冷冻|冰凉|冰镇|冷食|冰)$/;
/** 关键词说的是**旁边那口**，不是这道菜本身的温度（「配冰淇淋」）。 */
const SIDE_KW = /^配/;

export function tempClass(dish) {
  const name = `${dish.name}${dish.alias}`;
  const cat = dish.category;
  const kws = dish.keywords ?? [];

  // 冷档分两处看，都不看"整串拼起来"的那段文字——拼起来就会误伤：
  //   · 苹果派关键词写着「配冰淇淋」，那是旁边那球，派本身是烫的；
  //   · 官渡粑粑「凉了更韧」、番茄蒜香烤面包「冷番茄」，说的是别的事；
  //   · 奇拉基莱斯「解宿醉」里的"醉"字也不是凉。
  // 名字带凉意的（冰沙、刨冰、雪糕、凉面、刺身、寿司、醉蟹…）照旧算凉。
  if (/冰|雪糕|冰淇淋|刨冰|冰镇|凉面|凉皮|凉粉|冷面|冷汤|刺身|寿司|沙拉|醉蟹|醉虾|凉拌|气泡/.test(name)) return 'cold';
  if (kws.some((k) => !SIDE_KW.test(k) && COLD_KW.test(k))) return 'cold';

  const hay = name + kws.join('');
  if (cat === '饮品') return /热|煮|拿铁|可可|茶(?!饮)|汤/.test(hay) ? 'warm' : 'cold';
  if (cat === '凉菜') return 'cold';
  if (/常温|室温|不烫/.test(hay)) return 'room';
  if (cat === '甜品') {
    return /舒芙蕾|熔岩|可颂|司康|泡芙|巴斯克|酥|挞|派|布丁|塔|现烤|热食/.test(hay) ? 'warmSweet' : 'room';
  }
  if (cat === '小吃' && /寿司|玉子|大福|麻薯/.test(name)) return 'room';
  return 'hot';
}

/**
 * 怎么配着吃：正餐、喝的、甜的，还是本来就带汤水的。
 *
 * `soup` 单独一档是因为「吃到一半先喝了口汤」这类句子只对汤羹/火锅成立：
 * 一份布法罗鸡翅、一串烤肉念出"先喝了口汤"就是错的（原先把这句放在 food 池里，
 * 全库抽样 2457 次里有 345 次落在没有汤的菜上）。
 */
function kindOf(dish) {
  if (dish.category === '饮品') return 'drink';
  if (dish.category === '汤羹' || dish.category === '火锅') return 'soup';
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
  // 热的固体甜点：用勺子挖，不是喝的。
  warmSweet: [
    '端上来还是烫的，勺子先搁了一会儿才敢碰。',
    '外皮刚出炉，一碰就烫指尖，得先撕开一角散散热气。',
    '中间还是温的，边上一圈已经凉下来，一口里两个温度。',
    '趁热挖，凉了以后它会塌下去，样子就不一样了。',
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
    '吃完舔了下手指，才想起来找纸巾。',
  ],
  soup: [
    '空口喝的，一勺接一勺。',
    '就着一碗白饭，汤比饭先见底。',
    '喝到一半停了一下，先夹了口别的菜。',
    '配了一口热茶，嘴里那层油被刮干净。',
    '端着碗喝到最后一口，碗底那点料也刮干净了。',
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

/**
 * 同一道菜按「吃过几回」换角度说。
 *
 * 撞词最容易发生在这里：第一口和第一口总是像的，所以第二回不能再写"第一印象"，
 * 得换到另一层去说——第二回写"吃了一半怎么变"，第三回起写"熟客的例行"。
 * 档位是硬绑的（第 1 回只能从 ANGLE[0] 抽），不是随机抽池子，否则第二次仍可能
 * 落到第一次那套话上；每档给足句子，同一天连吃两回也不会挑到同一句。
 *
 * 变的是角度，不是事实层（prose / texture / aroma / finish 原样不动）。
 */
const ANGLE = [
  // 第 1 回：这是第一次，只有整体印象。
  [
    '第一口先吃原味，什么也没蘸，就是想先知道它本身是什么味。',
    '刚端上来，什么都不了解，一勺下去才知道自己吃的是什么。',
    '第一次吃，吃得比平时慢，每一口都在心里对一下。',
    '先挑最普通的那一块尝，留着最好的那部分在盘子里。',
    '第一口是最烫的（也是最不敢下大口的），凉一点以后才是它真正的样子。',
    '不知道量够不够，第一口吃得挺节省。',
    '第一次吃，说不清喜不喜欢，只记得几个很具体的点。',
  ],
  // 第 2 回：开头什么样已经知道了，这回才留意中间怎么变。
  [
    '这回专门看它吃了一半以后变成什么样——刚入口那点印象不算数。',
    '第二次吃，注意力从"什么味"挪到了"哪儿在变"。',
    '上回只顾着尝新，这回才注意到它从入口到咽下去是有顺序的。',
    '又吃一回，这次是看着它凉了一半才开始认真吃。',
    '第二次点它，才知道自己上回记住的其实只是一半。',
    '这次吃到底，才尝出底下和上面不是一个味。',
    '上回记住的是开头，这回记的是后面那段。',
  ],
  // 第 3 回起：熟的，写"例行和准确"，不再有第一印象。
  [
    '第三回了，不用挑，手自己就伸过去了。',
    '吃过几回以后它不再是个新东西，变成一个坐得很稳的位置。',
    '点了这么多次，这一口只是确认它还跟记忆里一样。',
    '又点它——不是想尝新的，就是今天只想吃准的那一口。',
    '点的时候没犹豫，因为知道它端来是什么样子；吃的时候还是要认真。',
    '这道菜现在闭着眼也背得出来，所以注意力全跑到别的细节上去了。',
    '吃熟到第三回以后，每次都是同一个味道，只有几处小地方会有差别。',
    '再来一盘也还是它；不是惊喜，是准确。',
  ],
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

  // 角度按次数分档：第几回就只说第几回该说的话，免得第二次仍在写第一印象。
  const here = [pick(TEMP[temp] ?? TEMP.hot, rng)];
  here.push(pick(ANGLE[nth < 2 ? nth : 2], rng));
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
export const POOLS = { TEMP, MOOD, WITH, ANGLE, MISS };
