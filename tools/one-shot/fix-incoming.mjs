/**
 * fix-incoming.mjs —— 合并前修掉体检查出来的三类问题。
 *
 * 1. 两组重名（响油鳝糊、烤包子各写了两遍）：删掉后写的那份，补一道真菜补位。
 * 2. 七处 prose 起手句同组撞车：只改起手那一句，后面的原文一字不动。
 * 3. 补位的两道菜（上海炸猪排、新疆椒麻鸡）写好直接塞进对应组的文件。
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const INC = '.incoming';
const read = async (f) => JSON.parse((await readFile(join(INC, f), 'utf8')).replace(/^\uFEFF/, ''));
const write = async (f, arr) => writeFile(join(INC, f), `${JSON.stringify(arr, null, 2)}\n`, 'utf8');

// ── 1. 删重名 ──
for (const [file, name] of [
  ['jiangzhe-hu__2.json', '响油鳝糊'], // 留 __1 那份（上海），删苏州这份
  ['northwest__2.json', '烤包子'], // 留 __1 那份，删这份
]) {
  const arr = await read(file);
  const kept = arr.filter((d) => d.name !== name);
  console.log(`· ${file}：删「${name}」，${arr.length} → ${kept.length} 道`);
  await write(file, kept);
}

// ── 2. 改起手句（只换第一句，后面原样）──
const OPENER = [
  ['northeast__2.json', '延吉烤明太鱼', '手指先沾到酱，舔一下，辣得直吸气。', '盘子刚端来，蒸汽里全是炭火的味。'],
  ['sichuan__4.json', '白油豆腐', '还没入口，盘子已经晃了。', '端上桌时整盘还在微微晃。'],
  ['latin-american__2.json', '古巴三明治', '手指先沾到纸上的油，按下去面包会轻微回弹，', '包着的纸已经透出一片油印，按下去面包会轻微回弹，'],
  ['jiangzhe-hu__3.json', '宁波汤圆', '勺子磕到碗底，汤圆滑得舀不住，得用勺背兜着。', '刚舀起来的汤圆滑得兜不住，得用勺背拦着。'],
  ['hunan__2.json', '湘西社饭', '还没入口，蒿菜的苦味先从鼻子里进来了。', '揭开锅盖，蒿菜的苦味先从鼻子里进来。'],
  ['hunan__2.json', '浏阳蒸豆角', '筷子夹起一根，得先抖掉挂着的豆豉。', '从竹屉里夹一根出来，得先抖掉挂着的豆豉。'],
  ['cantonese__2.json', '榴莲酥', '还没入口，光是指头沾到的那点油就够馋人。', '从纸垫上拿起来，指头先沾到一层油。'],
];

for (const [file, name, from, to] of OPENER) {
  const arr = await read(file);
  const d = arr.find((x) => x.name === name);
  if (!d) { console.log(`✗ ${file} 里没有「${name}」`); continue; }
  if (!d.prose.startsWith(from)) { console.log(`✗ ${name} 的起手句对不上：${d.prose.slice(0, 24)}…`); continue; }
  d.prose = to + d.prose.slice(from.length);
  const n = d.prose.replace(/\s/g, '').length;
  console.log(`· ${name} 起手句改掉，prose ${n} 字`);
  if (n < 100 || n > 160) console.log(`  ⚠ 字数出界`);
  await write(file, arr);
}

// ── 3. 补位两道菜 ──
const SHANGHAI = {
  id: 'shanghai-pork-chop',
  name: '上海炸猪排',
  alias: 'Shanghai Pork Chop',
  cuisine: '江浙沪菜',
  category: '热菜',
  region: '上海黄浦区',
  ingredients: ['猪大排', '粗面包糠', '辣酱油', '鸡蛋', '面粉'],
  method: '猪大排先剔掉边上一圈肥筋，用刀背横竖各拍一遍，把肉拍松到厚薄一致，筋拍断了炸完才不会卷起来。拍好的排先扑一层面粉，再蘸蛋液，最后按进粗面包糠里压实。油六成热下锅，两面各炸一分钟捞出，等油再烧热点复炸二十秒，壳才脆得住。出锅斜刀切成条，趁热蘸辣酱油。',
  serving: '一整块排横在盘里，切好的条还连着，边上一小碟黑褐色的辣酱油。面包糠的金壳上还冒着细油泡，刀口处露出浅粉色的肉芯，盘子边积着刚沥下来的那层油。',
  taste: { 辣: 5, 麻: 0, 咸: 55, 鲜: 50, 甜: 15, 酸: 15, 苦: 2, 油: 72, 香: 70 },
  texture: '壳是酥的，一咬就碎成小粒落在手上；里面的肉还是嫩的，能撕出丝，没剔净的那点肥筋有点韧，得单独嚼两下。',
  aroma: '先闻到热油，紧接着是烤过的面包糠那种焦香，再往里才闻出猪肉本身带甜的味；蘸上辣酱油以后，鼻子先酸了一下。',
  finish: '咽下去油还挂在嘴唇上，辣酱油的酸在舌根留得比咸久，过一会儿嘴里发干，想再切一条。',
  prose: '趁壳还没被盘里的水汽泡软，先咬一分条，咔嚓一声，脆粒掉在盘子上。第一口不蘸酱，先吃壳和肉的原味，肉汁是甜的。吃到中间那条，肥筋边上最香，这时候一定得蘸一下辣酱油，酸冲上来才把油腻切掉。最后几根壳已经软了，索性连酱碟底一起抹干净，嘴里尽是面包糠的渣。',
  keywords: ['面包糠', '配辣酱油'],
};

const XINJIANG = {
  id: 'xinjiang-pepper-chicken',
  name: '新疆椒麻鸡',
  alias: 'Xinjiang Pepper Chicken',
  cuisine: '西北菜',
  category: '凉菜',
  region: '新疆乌鲁木齐',
  ingredients: ['土鸡', '线辣椒', '花椒', '洋葱', '姜'],
  method: '整只土鸡冷水下锅，加姜片和洋葱煮三十分钟，捞出来立刻泡进冰水里，皮才收得紧、切得脆。晾到不烫手再手撕成条，贴着骨的活肉单独留着。线辣椒和花椒用温油泼一遍，泼出红油后连渣一起兑进煮鸡的原汤，浇在鸡肉上拌匀，拌好放半小时让它吃味。',
  serving: '鸡肉堆在白瓷盘里，底下沉着半盘红油汤和碎辣椒，上头撒一层切丝的生洋葱。筷子拨开能看见鸡皮透着一点亮，盘子是凉的，手指碰上去冰一下。',
  taste: { 辣: 62, 麻: 55, 咸: 55, 鲜: 50, 甜: 8, 酸: 12, 苦: 3, 油: 45, 香: 75 },
  texture: '鸡皮是脆的，一咬就断；鸡腿肉撕成粗丝，纤维长，越嚼越有劲。麻不是咬出来的，是嚼完半分钟才从舌面上渗出来。',
  aroma: '先是一股凉气，紧接着花椒的麻香冲上来，压着一层辣椒被热油泼过的糊香，最底下才闻得出鸡本身的味道。',
  finish: '咽下去嘴唇先发麻，麻退得很慢，舌根留一点辣椒的燥，得喝口冰水；手指上的油也滑，要擦两遍。',
  prose: '从冰箱里拿出来直接吃，第一块挑鸡腿上的，皮和肉之间那层冻最香。第一口是咸和油，辣要走两步才上来，等到麻从嘴唇中间散开，人会停一下。中段专挑贴着骨头的活肉，撕得开，筋头有咬劲。吃到后面辣劲叠起来，就一口生洋葱，甜水把辣冲下去，最后把盘底的红油汤拌进面里。',
  keywords: ['手撕', '冰镇'],
};

for (const [file, dish] of [['jiangzhe-hu__3.json', SHANGHAI], ['northwest__2.json', XINJIANG]]) {
  const arr = await read(file);
  if (arr.some((d) => d.id === dish.id || d.name === dish.name)) { console.log(`✗ ${file} 里已有 ${dish.name}`); continue; }
  arr.push(dish);
  const n = dish.prose.replace(/\s/g, '').length;
  const m = dish.method.replace(/\s/g, '').length;
  console.log(`· ${file}：补「${dish.name}」（prose ${n} 字 / method ${m} 字），共 ${arr.length} 道`);
  await write(file, arr);
}

console.log('\n目录：' + (await readdir(INC)).filter((f) => f.endsWith('.json')).length + ' 个文件');
