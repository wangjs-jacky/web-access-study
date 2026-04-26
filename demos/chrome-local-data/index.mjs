#!/usr/bin/env node
// Chrome 本地数据访问 Demo
// 验证知识点：跨平台 Profile 发现、SQLite 复制查询、WebKit 时间戳转换、书签递归遍历

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

// ============================================
// 1. 跨平台 Chrome 数据目录
// ============================================
function getChromeDataDir() {
  const home = os.homedir();
  switch (os.platform()) {
    case 'darwin': return path.join(home, 'Library/Application Support/Google/Chrome');
    case 'linux':  return path.join(home, '.config/google-chrome');
    case 'win32':  return path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/User Data');
    default: return null;
  }
}

// ============================================
// 2. Profile 枚举（读取 Local State）
// ============================================
function listProfiles(dataDir) {
  try {
    const state = JSON.parse(fs.readFileSync(path.join(dataDir, 'Local State'), 'utf-8'));
    const info = state?.profile?.info_cache || {};
    const list = Object.keys(info).map(dir => ({ dir, name: info[dir].name || dir }));
    if (list.length) return list;
  } catch { /* 回退 */ }
  return [{ dir: 'Default', name: 'Default' }];
}

// ============================================
// 3. WebKit 时间戳转换
// ============================================
const WEBKIT_EPOCH_DIFF_US = 11644473600000000n; // 1601→1970 微秒差

function webkitToISO(webkitUs) {
  const epochMs = Number(BigInt(webkitUs) - WEBKIT_EPOCH_DIFF_US) / 1000;
  return new Date(epochMs).toISOString();
}

function isoToWebkit(date) {
  return BigInt(date.getTime()) * 1000n + WEBKIT_EPOCH_DIFF_US;
}

// ============================================
// 4. 书签递归遍历
// ============================================
function searchBookmarks(profileDir, keywords) {
  const file = path.join(profileDir, 'Bookmarks');
  if (!fs.existsSync(file)) return [];
  let data;
  try { data = JSON.parse(fs.readFileSync(file, 'utf-8')); } catch { return []; }

  const needles = keywords.map(k => k.toLowerCase());
  const out = [];
  function walk(node, trail) {
    if (!node) return;
    if (node.type === 'url') {
      const hay = `${node.name || ''} ${node.url || ''}`.toLowerCase();
      if (needles.every(n => hay.includes(n))) {
        out.push({ name: node.name, url: node.url, folder: trail.join(' / ') });
      }
    }
    if (Array.isArray(node.children)) {
      for (const c of node.children) walk(c, node.name ? [...trail, node.name] : trail);
    }
  }
  for (const root of Object.values(data.roots || {})) walk(root, []);
  return out;
}

// ============================================
// 5. 历史记录查询（SQLite 复制到临时文件）
// ============================================
function searchHistory(profileDir, keywords, limit = 10) {
  const src = path.join(profileDir, 'History');
  if (!fs.existsSync(src)) return [];
  const tmp = path.join(os.tmpdir(), `chrome-history-${process.pid}-${Date.now()}.sqlite`);
  try {
    fs.copyFileSync(src, tmp); // 复制避免锁文件冲突
    const conds = ['last_visit_time > 0'];
    for (const kw of keywords) {
      const esc = kw.toLowerCase().replace(/'/g, "''"); // SQL 注入防护
      conds.push(`LOWER(title || ' ' || url) LIKE '%${esc}%'`);
    }
    const sql = `SELECT title, url, last_visit_time, visit_count
      FROM urls WHERE ${conds.join(' AND ')}
      ORDER BY last_visit_time DESC LIMIT ${limit};`;
    const raw = execFileSync('sqlite3', ['-separator', '\t', tmp, sql], {
      encoding: 'utf-8',
      maxBuffer: 50 * 1024 * 1024,
    });
    return raw.trim().split('\n').filter(Boolean).map(line => {
      const [title, url, wkit, visits] = line.split('\t');
      return { title, url, visit: webkitToISO(wkit), visits: parseInt(visits, 10) };
    });
  } catch {
    return [];
  } finally {
    try { fs.unlinkSync(tmp); } catch {} // 清理临时文件
  }
}

// ============================================
// 主流程
// ============================================
async function main() {
  console.log('Chrome 本地数据访问 Demo\n');

  // 1. 发现 Chrome 数据目录
  const dataDir = getChromeDataDir();
  if (!dataDir || !fs.existsSync(dataDir)) {
    console.log('✗ 未找到 Chrome 数据目录');
    return;
  }
  console.log(`✓ Chrome 数据目录: ${dataDir}`);

  // 2. 枚举 Profile
  const profiles = listProfiles(dataDir);
  console.log(`✓ 发现 ${profiles.length} 个 Profile: ${profiles.map(p => p.name).join(', ')}\n`);

  // 3. WebKit 时间戳转换演示
  console.log('=== WebKit 时间戳转换 ===');
  const now = new Date();
  const webkitNow = isoToWebkit(now);
  console.log(`  当前时间: ${now.toISOString()}`);
  console.log(`  WebKit 值: ${webkitNow}`);
  console.log(`  反向转换: ${webkitToISO(webkitNow)}`);

  // 4. 书签搜索（关键词：github）
  console.log('\n=== 书签搜索（关键词: github）===');
  const defaultProfile = path.join(dataDir, profiles[0].dir);
  const bookmarks = searchBookmarks(defaultProfile, ['github']);
  if (bookmarks.length) {
    for (const b of bookmarks.slice(0, 5)) {
      console.log(`  ${b.name}`);
      console.log(`    URL: ${b.url}`);
      console.log(`    文件夹: ${b.folder}`);
    }
    if (bookmarks.length > 5) console.log(`  ... 共 ${bookmarks.length} 条`);
  } else {
    console.log('  未找到匹配的书签');
  }

  // 5. 历史记录查询
  console.log('\n=== 历史记录（最近 5 条）===');
  const history = searchHistory(defaultProfile, [], 5);
  if (history.length) {
    for (const h of history) {
      console.log(`  ${h.title || '(无标题)'}`);
      console.log(`    URL: ${h.url}`);
      console.log(`    访问: ${h.visit} (${h.visits}次)`);
    }
  } else {
    console.log('  未找到历史记录（可能 sqlite3 未安装）');
  }

  console.log('\n✓ Demo 完成');
}

await main();
