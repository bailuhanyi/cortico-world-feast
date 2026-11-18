/** Read and safely update persisted JSON records with a recoverable backup. */
import { randomUUID } from 'node:crypto';
import { readFile, open, link, unlink, rename } from 'node:fs/promises';
import { dirname, basename, join } from 'node:path';

function displayError(action, file, err) {
  return new Error(`记录${action}失败：${file}（${err?.message ?? err}）`, { cause: err });
}

function parseRecord(source, file, { allowArray = true } = {}) {
  let value;
  try {
    value = JSON.parse(source);
  } catch (err) {
    throw new Error(`记录损坏：${file}（${err?.message ?? err}）`, { cause: err });
  }
  if (!value || typeof value !== 'object' || (!allowArray && Array.isArray(value))) {
    throw new Error(`记录结构无效：${file}（必须是 JSON 对象${allowArray ? '或数组' : ''}）`);
  }
  return value;
}

async function tempWrite(file, contents) {
  const path = join(dirname(file), `.${basename(file)}.${randomUUID()}.tmp`);
  let handle;
  try {
    handle = await open(path, 'wx', 0o600);
    await handle.writeFile(contents);
    await handle.sync();
    await handle.close();
    handle = null;
    return path;
  } catch (err) {
    await handle?.close().catch(() => {});
    await unlink(path).catch(() => {});
    throw err;
  }
}

async function atomicReplace(file, contents) {
  const temp = await tempWrite(file, contents);
  try {
    await rename(temp, file);
  } catch (err) {
    await unlink(temp).catch(() => {});
    throw err;
  }
}

// link() gives exclusive creation semantics, so an existing backup is never overwritten.
async function atomicCreate(file, contents) {
  const temp = await tempWrite(file, contents);
  try {
    await link(temp, file);
  } catch (err) {
    await unlink(temp).catch(() => {});
    throw err;
  }
  await unlink(temp);
}

async function readExisting(file) {
  try {
    return await readFile(file, 'utf8');
  } catch (err) {
    if (err?.code === 'ENOENT') return null;
    throw err;
  }
}

/** Read persisted JSON without treating damaged or unreadable records as new data. */
export async function readStoredJson(file, { allowArray = false } = {}) {
  let source;
  try {
    source = await readFile(file, 'utf8');
  } catch (err) {
    if (err?.code === 'ENOENT') return null;
    throw displayError('读取', file, err);
  }
  try {
    return parseRecord(source, file, { allowArray });
  } catch (err) {
    throw new Error(`记录损坏，原文件已保留：${file}（${err?.message ?? err}）`, { cause: err });
  }
}

/** Save JSON, backing up a valid previous record before replacing it. */
export async function writeStoredJson(file, value) {
  if (!value || typeof value !== 'object') throw new Error(`记录结构无效：${file}（必须是 JSON 对象或数组）`);
  const contents = `${JSON.stringify(value, null, 2)}\n`;
  let old;
  try {
    old = await readExisting(file);
  } catch (err) {
    throw displayError('读取', file, err);
  }
  if (old !== null) {
    try {
      parseRecord(old, file);
    } catch (err) {
      throw new Error(`拒绝覆盖原文件：${err.message}`, { cause: err });
    }
    try {
      await atomicReplace(`${file}.bak`, old);
    } catch (err) {
      throw displayError('备份', `${file}.bak`, err);
    }
  }
  try {
    await atomicReplace(file, contents);
  } catch (err) {
    throw displayError('写入', file, err);
  }
  return { status: 'ok', backupAvailable: old !== null, message: old === null ? '记录已写入' : '记录已写入，旧记录已备份' };
}

/** Report main-record and backup validity without modifying either file. */
export async function inspectStoredJson(file) {
  let status = 'missing';
  let message = '主记录不存在';
  try {
    const source = await readExisting(file);
    if (source !== null) {
      parseRecord(source, file);
      status = 'ok';
      message = '主记录正常';
    }
  } catch (err) {
    status = 'error';
    message = err.message;
  }

  let backupAvailable = false;
  try {
    const backup = await readExisting(`${file}.bak`);
    if (backup !== null) {
      parseRecord(backup, `${file}.bak`);
      backupAvailable = true;
    }
  } catch (err) {
    if (status !== 'error') {
      status = 'error';
      message = err.message;
    } else {
      message += `；备份检查失败：${err.message}`;
    }
  }
  return { status, backupAvailable, message };
}

/** Restore only the adjacent .bak record; preserve any current main file verbatim. */
export async function restoreStoredJson(file) {
  let backup;
  try {
    backup = await readFile(`${file}.bak`, 'utf8');
  } catch (err) {
    throw displayError('读取备份', `${file}.bak`, err);
  }
  try {
    parseRecord(backup, `${file}.bak`);
  } catch (err) {
    throw new Error(`拒绝恢复：备份无效：${err.message}`, { cause: err });
  }

  let current;
  try {
    current = await readExisting(file);
  } catch (err) {
    throw displayError('读取原记录', file, err);
  }
  if (current !== null) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const preserved = `${file}.corrupt-${stamp}-${randomUUID()}`;
    try {
      await atomicCreate(preserved, current);
    } catch (err) {
      throw displayError('保留原记录', preserved, err);
    }
  }
  try {
    await atomicReplace(file, backup);
  } catch (err) {
    throw displayError('恢复', file, err);
  }
  return { status: 'ok', backupAvailable: true, message: '已从备份恢复；原记录已保留' };
}
