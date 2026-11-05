/**
 * add-two.mjs —— 补两道菜，让 anglo-american 和 korean 回到 12 道。
 * 一次性脚本，写完即删。
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, '..', 'src', 'data');

const NEW = {
  'anglo-american': {
    id: 'buffalo-wings',
    name: '布法罗鸡翅',
    alias: 'Buffalo Wings',
    cuisine: '英美菜',
    category: '小吃',
    region: '美国纽约州布法罗',
    ingredients: ['鸡翅中', '美式辣椒酱', '黄油', '白醋', '蓝纹奶酪酱', '芹菜条'],
    method: '鸡翅中八百克，翅根翅中分开，用厨房纸把表面吸到发干，撒盐和一点泡打粉抓匀，摊在架子上冷藏两小时风干。油温一百八十度下锅炸十分钟捞出，升到二百度复炸三分钟逼脆。酱是辣椒酱一百二十毫升配化开的黄油五十克，加白醋一勺、蒜粉半勺搅匀。热翅倒进大碗，淋酱翻到每根都裹上，配蓝纹奶酪酱和芹菜条立刻上桌。',
    serving: '白瓷碗里堆着，酱是橙红发亮的，指腹一蹭就沾上，旁边一小碟蓝纹奶酪酱和一截截芹菜。',
    taste: { 辣: 58, 麻: 0, 咸: 62, 鲜: 42, 甜: 14, 酸: 30, 苦: 2, 油: 66, 香: 72 },
    texture: '外壳脆得响，咬开肉还在出汁；裹到酱的地方已经回软，指头黏。',
    aroma: '辣椒酱的酸辣先冲上来，接着是黄油融进去的奶香，底下垫着一点蒜。',
    finish: '咽下去舌侧还辣着，得咬根芹菜压一压，蓝纹奶酪的咸味在鼻腔后头留一会儿。',
    prose: '端上来的时候酱还在往下淌，先捏一根翅根，指尖立刻沾红了。第一口是脆，酸辣冲进鼻腔，甜很浅，只负责把辣托住。吃到第三根嘴唇开始发麻，只能停下来啃芹菜条，奶酪酱的咸把辣拉平。最后几根酱已经渗进肉里，外壳软了，反倒更像在吃炖过的鸡。收在黄油和醋上，手指还留着辣。',
    keywords: ['复炸', '辣椒酱配黄油', '蓝纹奶酪', '手抓'],
  },
  korean: {
    id: 'dak-galbi',
    name: '春川辣炒鸡排',
    alias: 'Dak Galbi',
    cuisine: '韩式',
    category: '热菜',
    region: '韩国春川',
    ingredients: ['去骨鸡腿肉', '韩式辣酱', '辣椒粉', '卷心菜', '红薯', '年糕条'],
    method: '鸡腿肉七百克切三厘米块，用辣酱两大勺、辣椒粉一勺、酱油、蒜末、姜末、一点糖和香油抓匀，冷藏腌一小时。铁锅烧热，鸡肉连同酱一起摊平，中火煎到两面变色，加切块的红薯、卷心菜和年糕条，倒半杯水，盖盖焖八分钟。开盖转大火收到汁发亮，撒紫苏叶和葱花，边炒边吃；剩下那点酱汁加一碗米饭和海苔碎炒成锅巴饭。',
    serving: '铁锅直接端上桌，红酱咕嘟着，红薯边角已经透亮，年糕条在锅边烤得微微鼓起来。',
    taste: { 辣: 72, 麻: 0, 咸: 58, 鲜: 48, 甜: 34, 酸: 12, 苦: 2, 油: 52, 香: 70 },
    texture: '鸡肉嫩得能撕开，年糕外软内韧，红薯一压就成泥，卷心菜还留着一点脆。',
    aroma: '辣酱炒热的甜辣味最重，混着蒜和香油，紫苏叶下去时又冒出一股青气。',
    finish: '辣在喉咙后头堆着，甜和蒜留在舌根，得喝口冰水；最后那碗锅巴饭把剩下的酱刮得干干净净。',
    prose: '锅一上桌还在响，酱汁在鸡肉缝里冒泡，先夹一块红薯——已经吸饱了辣酱，甜得发闷。第二口换年糕，外面软、里面要嚼，辣从舌根往上压。肉吃到一半才想起卷菜叶，紫苏包着鸡肉和蒜片一起塞进去，油腻被顶回去一层。最后把剩下的酱和米饭炒在一起，锅底那层锅巴用勺子刮下来，是最咸最香的一口。',
    keywords: ['铁板现炒', '辣酱腌入味', '加炒饭', '紫苏叶'],
  },
};

for (const [slug, dish] of Object.entries(NEW)) {
  const file = join(dataDir, `${slug}.json`);
  const arr = JSON.parse(await readFile(file, 'utf8'));
  if (arr.some((d) => d.id === dish.id)) {
    console.log(`· ${slug}.json 里已有 ${dish.id}，跳过`);
    continue;
  }
  arr.push(dish);
  await writeFile(file, `${JSON.stringify(arr, null, 2)}\n`, 'utf8');
  console.log(`✓ ${slug}.json ${arr.length - 1} → ${arr.length}`);
}
