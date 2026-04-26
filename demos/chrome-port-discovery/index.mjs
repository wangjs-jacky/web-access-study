#!/usr/bin/env node
// Chrome 调试端口发现 Demo
// 验证知识点：DevToolsActivePort 多路径发现、跨平台适配、TCP 探测、端口扫描回退

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';

// ============================================
// 1. TCP 端口探测（避免触发 Chrome 安全弹窗）
// ============================================
function checkPort(port, host = '127.0.0.1', timeoutMs = 2000) {
  return new Promise((resolve) => {
    const socket = net.createConnection(port, host);
    const timer = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, timeoutMs);
    socket.once('connect', () => {
      clearTimeout(timer);
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

// ============================================
// 2. 跨平台 DevToolsActivePort 文件路径
// ============================================
function getActivePortFiles() {
  const home = os.homedir();
  const localAppData = process.env.LOCALAPPDATA || '';
  switch (os.platform()) {
    case 'darwin':
      return [
        path.join(home, 'Library/Application Support/Google/Chrome/DevToolsActivePort'),
        path.join(home, 'Library/Application Support/Google/Chrome Canary/DevToolsActivePort'),
        path.join(home, 'Library/Application Support/Chromium/DevToolsActivePort'),
      ];
    case 'linux':
      return [
        path.join(home, '.config/google-chrome/DevToolsActivePort'),
        path.join(home, '.config/chromium/DevToolsActivePort'),
      ];
    case 'win32':
      return [
        path.join(localAppData, 'Google/Chrome/User Data/DevToolsActivePort'),
        path.join(localAppData, 'Chromium/User Data/DevToolsActivePort'),
      ];
    default:
      return [];
  }
}

// ============================================
// 3. 第一层：从 DevToolsActivePort 文件读取
// ============================================
async function discoverFromFile() {
  console.log('=== 第一层：DevToolsActivePort 文件发现 ===');
  const files = getActivePortFiles();
  for (const filePath of files) {
    try {
      const content = fs.readFileSync(filePath, 'utf-8').trim();
      const lines = content.split('\n');
      const port = parseInt(lines[0], 10);
      if (port > 0 && port < 65536) {
        const wsPath = lines[1] || null;
        console.log(`  ✓ 文件: ${filePath}`);
        console.log(`    端口: ${port}`);
        console.log(`    WebSocket 路径: ${wsPath || '(无)'}`);
        const ok = await checkPort(port);
        if (ok) {
          console.log(`    TCP 探测: 端口开放`);
          return { port, wsPath, source: 'file' };
        }
        console.log(`    TCP 探测: 端口未响应（文件可能过期）`);
      }
    } catch {
      console.log(`  ✗ 文件不存在: ${path.basename(path.dirname(filePath))}/DevToolsActivePort`);
    }
  }
  return null;
}

// ============================================
// 4. 第二层：常见端口扫描
// ============================================
async function discoverByScan() {
  console.log('\n=== 第二层：常见端口扫描 ===');
  const ports = [9222, 9229, 9333];
  for (const port of ports) {
    process.stdout.write(`  扫描端口 ${port}...`);
    const ok = await checkPort(port);
    console.log(ok ? ' ✓ 开放' : ' ✗ 关闭');
    if (ok) {
      return { port, wsPath: null, source: 'scan' };
    }
  }
  return null;
}

// ============================================
// 5. 主流程：两级回退策略
// ============================================
async function main() {
  console.log('Chrome 调试端口发现 Demo');
  console.log(`平台: ${os.platform()} (${os.arch()})\n`);

  // 第一层
  const fromFile = await discoverFromFile();
  if (fromFile) {
    console.log(`\n★ 发现成功（来源: 文件）: 端口 ${fromFile.port}`);
    console.log(`  WebSocket URL: ws://127.0.0.1:${fromFile.port}${fromFile.wsPath || '/devtools/browser'}`);
    return;
  }

  // 第二层
  const fromScan = await discoverByScan();
  if (fromScan) {
    console.log(`\n★ 发现成功（来源: 扫描）: 端口 ${fromScan.port}`);
    console.log(`  WebSocket URL: ws://127.0.0.1:${fromScan.port}/devtools/browser`);
    return;
  }

  console.log('\n✗ 未发现 Chrome 调试端口');
  console.log('  请确保 Chrome 已开启 --remote-debugging-port');
  console.log('  访问 chrome://inspect/#remote-debugging 勾选允许远程调试');
}

await main();
