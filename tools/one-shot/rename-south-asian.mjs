/**
 * rename-south-asian.mjs —— `indian` → `south-asian`，菜系「印度菜」→「南亚菜」。
 *
 * 为什么要改：这一组扩到 500 道时会收巴基斯坦、斯里兰卡、孟加拉的菜，
 * 再叫「印度菜」就不老实了。和 0.4.0 把「南欧菜」改成「欧洲菜」是同一个理由。
 */
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const DATA = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'data');

const arr = JSON.parse(await readFile(join(DATA, 'indian.json'), 'utf8'));
console.log(`indian.json: ${arr.length} 道`);
for (const d of arr) d.cuisine = '南亚菜';

await writeFile(join(DATA, 'south-asian.json'), `${JSON.stringify(arr, null, 2)}\n`, 'utf8');
await unlink(join(DATA, 'indian.json'));
console.log('✓ south-asian.json 已写，indian.json 已删');
console.log('· ' + arr.map((d) => d.name).join('、'));