#!/usr/bin/env node
/**
 * 从 Chrome 本地 Cookie 数据库提取指定域名的 Cookie
 * 仅支持 macOS + Chrome（Chromium 内核）
 *
 * 原理：
 * 1. Chrome 将 Cookie 存储在 SQLite 数据库中（~/Library/Application Support/Google/Chrome/Default/Cookies）
 * 2. Cookie 值通过 AES-128-CBC 加密
 * 3. 加密密钥存储在 macOS Keychain 中（"Chrome Safe Storage"）
 * 4. 通过 security CLI 获取密钥 → PBKDF2 派生 AES key → 解密 Cookie
 *
 * 用法：node get-chrome-cookie.mjs <domain> [--profile <name>]
 * 示例：node get-chrome-cookie.mjs juejin.cn
 */

import { execSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// ========== 配置 ==========

const CHROME_COOKIE_PATH = path.join(
  os.homedir(),
  'Library/Application Support/Google/Chrome'
);

const SAFE_STORAGE_KEYCHAIN = 'Chrome Safe Storage';
const PBKDF2_SALT = 'saltysalt';
const PBKDF2_ITERATIONS = 1003;
const KEY_LENGTH = 16; // AES-128

// ========== 步骤 1：获取 Chrome Safe Storage 密钥 ==========

function getSafeStorageKey() {
  try {
    const result = execSync(
      `security find-generic-password -w -s "${SAFE_STORAGE_KEYCHAIN}"`,
      { encoding: 'utf8' }
    ).trim();
    return result;
  } catch (e) {
    throw new Error(
      '无法从 macOS Keychain 获取 Chrome Safe Storage 密钥。\n' +
      '请确保允许终端访问 Keychain（系统偏好设置 → 隐私与安全 → 辅助功能）。\n' +
      `原始错误: ${e.message}`
    );
  }
}

// ========== 步骤 2：派生 AES 解密密钥 ==========

function deriveAESKey(password) {
  return crypto.pbkdf2Sync(password, PBKDF2_SALT, PBKDF2_ITERATIONS, KEY_LENGTH, 'sha1');
}

// ========== 步骤 3：解密 Cookie 值 ==========

function decryptCookieValue(encryptedBytes, aesKey) {
  // Chrome Cookie 加密格式：
  // v10: AES-128-CBC，IV 为 16 个空格（0x20）
  // v20: AES-128-GCM，12 字节 nonce + 密文 + 16 字节 auth tag

  const prefix = encryptedBytes.toString('utf8', 0, 3);

  if (prefix === 'v10') {
    // v10 格式：3 字节前缀 + 加密数据，IV = 16 * 0x20
    // Chrome 在 cookie 值前加了 32 字节（2 AES blocks）的元数据
    const iv = Buffer.alloc(16, 0x20);
    const encryptedData = encryptedBytes.subarray(3);
    const decipher = crypto.createDecipheriv('aes-128-cbc', aesKey, iv);
    const decrypted = Buffer.concat([decipher.update(encryptedData), decipher.final()]);
    // 跳过 32 字节元数据前缀，返回实际 cookie 值
    return decrypted.subarray(32);
  }

  if (prefix === 'v20') {
    // v20 格式：3 字节前缀 + 12 字节 nonce + 密文 + 16 字节 auth tag
    const nonce = encryptedBytes.subarray(3, 15);
    const authTag = encryptedBytes.subarray(-16);
    const ciphertext = encryptedBytes.subarray(15, -16);
    const decipher = crypto.createDecipheriv('aes-128-gcm', aesKey, nonce);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  }

  // 未加密的 Cookie（旧版本或非敏感 Cookie）
  return encryptedBytes;
}

// ========== 步骤 4：从 SQLite 数据库读取 Cookie ==========

function readCookiesFromDB(dbPath, domain) {
  // 使用 sqlite3 CLI 工具查询（避免依赖 better-sqlite3）
  const query = `
    SELECT name, encrypted_value, host_key, path, is_httponly, is_secure
    FROM cookies
    WHERE host_key LIKE '%${domain}%'
    ORDER BY host_key, name
  `;

  try {
    // 以 hex 格式输出 encrypted_value
    const hexQuery = `
      SELECT name, hex(encrypted_value) as enc_hex, host_key, path
      FROM cookies
      WHERE host_key LIKE '%${domain}%'
      ORDER BY host_key, name
    `;

    const output = execSync(`sqlite3 "${dbPath}" "${hexQuery}"`, {
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
    });

    if (!output.trim()) return [];

    return output.trim().split('\n').map(line => {
      const parts = line.split('|');
      return {
        name: parts[0],
        encHex: parts[1],
        hostKey: parts[2],
        path: parts[3],
      };
    });
  } catch (e) {
    throw new Error(`无法读取 Cookie 数据库: ${e.message}`);
  }
}

// ========== 步骤 5：查找 Chrome Profile ==========

function findCookieDB(profile = 'Default') {
  const dbPath = path.join(CHROME_COOKIE_PATH, profile, 'Cookies');
  if (fs.existsSync(dbPath)) return dbPath;

  // 尝试 Profile 1, 2, 3...
  if (profile === 'Default') {
    const profilesDir = CHROME_COOKIE_PATH;
    const entries = fs.readdirSync(profilesDir);
    for (const entry of entries) {
      if (entry.startsWith('Profile')) {
        const candidate = path.join(profilesDir, entry, 'Cookies');
        if (fs.existsSync(candidate)) return candidate;
      }
    }
  }

  throw new Error(`找不到 Chrome Cookie 数据库: ${dbPath}`);
}

// ========== 主逻辑 ==========

function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help')) {
    console.log('用法: node get-chrome-cookie.mjs <domain> [--profile <name>]');
    console.log('');
    console.log('从 Chrome Cookie 数据库提取指定域名的所有 Cookie');
    console.log('');
    console.log('参数:');
    console.log('  <domain>       域名关键词，如 juejin.cn');
    console.log('  --profile      Chrome Profile 名称（默认 Default）');
    console.log('');
    console.log('示例:');
    console.log('  node get-chrome-cookie.mjs juejin.cn');
    console.log('  node get-chrome-cookie.mjs juejin.cn --profile "Profile 1"');
    process.exit(0);
  }

  const domain = args[0];
  let profile = 'Default';
  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--profile' && args[i + 1]) {
      profile = args[++i];
    }
  }

  console.log(`🔑 提取 ${domain} 的 Cookie from Chrome (${profile})...\n`);

  // 1. 查找 Cookie 数据库
  const dbPath = findCookieDB(profile);
  console.log(`📂 Cookie 数据库: ${dbPath}`);

  // 2. 获取加密密钥
  const safeStorageKey = getSafeStorageKey();
  const aesKey = deriveAESKey(safeStorageKey);
  console.log('🔐 已获取解密密钥');

  // 3. 读取并解密 Cookie
  const rawCookies = readCookiesFromDB(dbPath, domain);
  console.log(`🍪 找到 ${rawCookies.length} 个 Cookie\n`);

  const cookies = [];
  for (const raw of rawCookies) {
    try {
      if (!raw.encHex) continue;
      const encryptedBytes = Buffer.from(raw.encHex, 'hex');
      const decrypted = decryptCookieValue(encryptedBytes, aesKey);
      const value = decrypted.toString('utf8').replace(/\0+$/, ''); // 去掉尾部 null 字节
      cookies.push({
        name: raw.name,
        value,
        hostKey: raw.hostKey,
        path: raw.path,
      });
    } catch (e) {
      // 某些 Cookie 可能解密失败（如空值），跳过
    }
  }

  if (cookies.length === 0) {
    console.log('❌ 没有找到可解密的 Cookie');
    console.log('可能原因：未登录该网站，或 Chrome 版本不兼容');
    process.exit(1);
  }

  // 4. 输出结果
  console.log('===== Cookie 列表 =====');
  for (const c of cookies) {
    const preview = c.value.length > 40 ? c.value.substring(0, 40) + '...' : c.value;
    console.log(`  ${c.name}: ${preview}`);
  }

  // 5. 输出合并后的 Cookie 字符串（可直接用于 HTTP 请求）
  const cookieString = cookies.map(c => `${c.name}=${c.value}`).join('; ');
  console.log('\n===== Cookie 字符串 =====');
  console.log(cookieString);
}

main();
