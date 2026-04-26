# 辅助脚本深度分析（check-deps + find-url + match-site）

> 深入分析 web-access 三个辅助脚本的实现逻辑、协作关系和编程技巧。

## 定位

- **给谁看**：想理解 web-access 前置检查、本地资源检索、站点匹配如何工作的人
- **解决什么问题**：回答「每个脚本做了什么、怎么做的、三个脚本如何协作」
- **前置笔记**：[architecture-overview.md](architecture-overview.md)（架构概述），本篇是脚本级实现细节

## 一、check-deps.mjs — 环境守门员（171行）

### 1.1 核心职责

```
Node.js 版本检查 → Chrome 调试端口发现 → CDP Proxy 启动/检查 → 站点经验列表输出
```

### 1.2 分层检查机制

**第一层：Node.js 版本**（第17-25行）

```javascript
function checkNode() {
  const major = Number(process.versions.node.split('.')[0]);
  if (major >= 22) {
    console.log(`node: ok (${version})`);
  } else {
    console.log(`node: warn (${version}, 建议升级到 22+)`);
  }
}
```

- 推荐 22+（原生 WebSocket 支持）
- 低于 22 仅警告不阻塞（可配合 ws 模块运行）

**第二层：Chrome 调试端口发现**（第40-83行）

多路径 DevToolsActivePort 文件探测 + 常用端口扫描：

```javascript
// 优先读取 DevToolsActivePort 文件
const possiblePaths = activePortFiles();  // 跨平台路径列表
for (const p of possiblePaths) {
  const content = fs.readFileSync(p, 'utf-8');
  const port = parseInt(content.split('\n')[0]);
  if (port > 0 && port < 65536 && await checkPort(port)) return port;
}

// 回退：扫描常用端口
for (const port of [9222, 9229, 9333]) {
  if (await checkPort(port)) return port;
}
```

**跨平台路径映射**：

| 平台 | 路径 |
|------|------|
| macOS | `~/Library/Application Support/Google/Chrome/DevToolsActivePort` |
| Linux | `~/.config/google-chrome/DevToolsActivePort` |
| Windows | `%LOCALAPPDATA%\Google\Chrome\User Data\DevToolsActivePort` |

**TCP 探测技巧**（第29-36行）：

```javascript
function checkPort(port, host = '127.0.0.1', timeoutMs = 2000) {
  return new Promise((resolve) => {
    const socket = net.createConnection(port, host);
    const timer = setTimeout(() => { socket.destroy(); resolve(false); }, timeoutMs);
    socket.once('connect', () => { clearTimeout(timer); socket.destroy(); resolve(true); });
    socket.once('error', () => { clearTimeout(timer); resolve(false); });
  });
}
```

为什么用 TCP 而不是 WebSocket？——避免触发 Chrome 的调试授权弹窗。

**第三层：CDP Proxy 启动**（第95-139行）

**分离式守护进程**：

```javascript
function startProxyDetached() {
  const child = spawn(process.execPath, [PROXY_SCRIPT], {
    detached: true,    // 进程独立于父进程
    stdio: ['ignore', logFd, logFd],
  });
  child.unref();       // 解除引用，允许父进程退出
}
```

- `detached: true` + `unref()` 实现真正的后台守护进程
- 日志输出到系统临时目录 `os.tmpdir()/cdp-proxy.log`

**就绪状态轮询**：

```javascript
async function ensureProxy() {
  // 快速路径：先检查是否已运行
  const targets = await httpGetJson('http://127.0.0.1:3456/targets');
  if (Array.isArray(targets)) { console.log('proxy: ready'); return true; }

  // 未运行则启动并等待
  startProxyDetached();
  await new Promise(r => setTimeout(r, 2000));  // 初始等待 2 秒

  for (let i = 1; i <= 15; i++) {              // 最多轮询 15 次（15秒）
    const result = await httpGetJson(targetsUrl, 8000);
    if (Array.isArray(result)) { console.log('proxy: ready'); return true; }
    if (i === 1) console.log('⚠️ Chrome 可能有授权弹窗，请点击「允许」...');
    await new Promise(r => setTimeout(r, 1000));
  }
}
```

设计模式：**快速路径优化** + **渐进式等待**（总计 17 秒超时）

**第四层：站点经验列表**（第158-167行）

```javascript
const patternsDir = path.join(ROOT, 'references', 'site-patterns');
const sites = fs.readdirSync(patternsDir)
  .filter(f => f.endsWith('.md'))
  .map(f => f.replace(/\.md$/, ''));
if (sites.length) console.log(`\nsite-patterns: ${sites.join(', ')}`);
```

### 1.3 编程技巧

| 技巧 | 实现 |
|------|------|
| 守护进程 | `detached: true` + `unref()` |
| 两级回退 | 文件探测 → 端口扫描 |
| TCP 探测 | 避免触发安全弹窗 |
| 快速路径 | 先检查后启动 |
| 渐进等待 | 初始 2s + 轮询 15 次 |

## 二、find-url.mjs — 本地资源检索引擎（214行）

### 2.1 核心职责

```
关键词解析 → Chrome Profile 枚举 → 书签检索 + 历史检索 → 合并排序输出
```

### 2.2 参数解析引擎（第26-56行）

```bash
node find-url.mjs [关键词...] [--only bookmarks|history] [--limit N] [--since 1d|7h|YYYY-MM-DD] [--sort recent|visits]
```

**时间窗口解析**：

```javascript
function parseSince(s) {
  const m = s.match(/^(\d+)([dhm])$/);
  if (m) {
    const ms = { d: 86400000, h: 3600000, m: 60000 }[m[2]];
    return new Date(Date.now() - n * ms);  // 支持 1d、7h、30m
  }
  return new Date(s);  // 也支持绝对日期 YYYY-MM-DD
}
```

### 2.3 Chrome Profile 枚举（第73-81行）

```javascript
function listProfiles(dataDir) {
  const state = JSON.parse(fs.readFileSync(path.join(dataDir, 'Local State'), 'utf-8'));
  const info = state?.profile?.info_cache || {};
  return Object.keys(info).map(dir => ({ dir, name: info[dir].name || dir }));
  // 失败时回退到 Default
  return [{ dir: 'Default', name: 'Default' }];
}
```

**设计亮点**：读取 Chrome 内部 `Local State` 文件获取所有 profile，优雅降级到 Default。

### 2.4 书签检索（第84-108行）

**递归遍历 Chrome 书签树**：

```javascript
function walk(node, trail) {
  if (node.type === 'url') {
    const hay = `${node.name || ''} ${node.url || ''}`.toLowerCase();
    if (needles.every(n => hay.includes(n))) {  // 多关键词 AND 匹配
      out.push({ profile, name, url, folder: trail.join(' / ') });
    }
  }
  if (Array.isArray(node.children)) {
    for (const c of node.children) walk(c, [...trail, node.name]);
  }
}
```

- 深度优先遍历（DFS）
- `trail` 参数追踪从根到当前节点的文件夹路径
- 大小写不敏感匹配

### 2.5 历史记录检索（第111-149行）

**SQLite 数据库处理挑战**：
- Chrome 的 History 文件运行时被锁定
- 必须先复制到临时目录

```javascript
const tmp = path.join(os.tmpdir(), `chrome-history-${process.pid}-${Date.now()}.sqlite`);
try {
  fs.copyFileSync(src, tmp);  // 复制到临时文件
  // 构建查询 SQL
  const conds = ['last_visit_time > 0'];
  for (const kw of keywords) {
    const esc = kw.toLowerCase().replace(/'/g, "''");  // SQL 注入防护
    conds.push(`LOWER(title || ' ' || url) LIKE '%${esc}%'`);
  }
  if (since) {
    const webkitUs = BigInt(since.getTime()) * 1000n + WEBKIT_EPOCH_DIFF_US;
    conds.push(`last_visit_time >= ${webkitUs}`);
  }
  const raw = execFileSync('sqlite3', ['-separator', '\t', tmp, sql], {
    encoding: 'utf-8',
    maxBuffer: 50 * 1024 * 1024  // 50MB 缓冲区
  });
} finally {
  try { fs.unlinkSync(tmp); } catch {}  // 清理临时文件
}
```

**关键技术点**：

| 挑战 | 解决方案 |
|------|---------|
| 文件锁定 | 复制到临时文件再查询 |
| WebKit 时间戳 | `BigInt` + `WEBKIT_EPOCH_DIFF_US` 精确转换 |
| SQL 注入 | `replace(/'/g, "''")` 单引号转义 |
| 大结果集 | `maxBuffer: 50MB` |

**WebKit 时间戳转换**（第111行）：

```javascript
const WEBKIT_EPOCH_DIFF_US = 11644473600000000n;
// Chrome 使用 1601年起始的微秒数，需精确计算差值
const webkitUs = BigInt(since.getTime()) * 1000n + WEBKIT_EPOCH_DIFF_US;
```

### 2.6 输出格式化

**管道符处理**：

```javascript
const clean = s => String(s ?? '').replaceAll('|', '│').trim();
```

用全宽竖线 `│` 替换字段内的 `|`，避免解析歧义。

**智能 Profile 标注**：

```javascript
const showProfile = seenProfiles.size > 1;  // 仅多 profile 时标注
```

## 三、match-site.mjs — 站点经验匹配（46行）

### 3.1 核心职责

遍历 `references/site-patterns/*.md`，匹配文件名和别名，返回经验内容。

### 3.2 别名解析和动态正则构建（第24-36行）

```javascript
// 解析 frontmatter 中的 aliases
const aliasesLine = raw.split(/\r?\n/).find(l => l.startsWith('aliases:')) || '';
const aliases = aliasesLine
  .replace(/^aliases:\s*/, '').replace(/^\[/, '').replace(/\]$/, '')
  .split(',').map(v => v.trim()).filter(Boolean);

// 构建匹配正则
const escaped = t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const pattern = [domain, ...aliases].map(escaped).join('|');
if (!new RegExp(pattern, 'i').test(query)) continue;
```

**编程技巧**：
- 自动转义域名中的正则元字符
- 大小写不敏感匹配（`i` 标志）
- 多别名支持（`aliases: [GitHub, 吉特哈勃]`）

### 3.3 Frontmatter 提取（第38-42行）

```javascript
const fences = [...raw.matchAll(/^---\s*$/gm)];
const body = fences.length >= 2
  ? raw.slice(fences[1].index + fences[1][0].length).replace(/^\r?\n/, '')
  : raw;
```

- 自动识别 `---` 分隔的 YAML Frontmatter
- 无 Frontmatter 时返回全部内容（兼容降级）

## 四、三个脚本的协作关系

### 4.1 调用链路

```
SKILL.md（统一入口）
    │
    │ 启动时
    ▼
check-deps.mjs
├─ Node.js 版本检查
├─ Chrome 端口发现
├─ CDP Proxy 启动/检查
└─ 输出 site-patterns 列表
    │
    │ 任务执行时
    ├──────────────────┐
    ▼                  ▼
find-url.mjs        match-site.mjs
├─ 书签检索          ├─ 站点经验匹配
├─ 历史检索          ├─ 别名扩展
└─ 多 Profile 支持   └─ Frontmatter 提取
    │                  │
    └────────┬─────────┘
             │
             ▼
    cdp-proxy.mjs（HTTP API 层）
```

### 4.2 共享的资源

| 资源 | 使用者 |
|------|--------|
| Chrome 数据目录路径 | check-deps + find-url + cdp-proxy |
| `references/site-patterns/` | check-deps（列出）+ match-site（匹配） |
| `CDP_PROXY_PORT` 环境变量 | check-deps + cdp-proxy |

### 4.3 被 SKILL.md 引用的方式

```bash
# 前置检查
node "${CLAUDE_SKILL_DIR}/scripts/check-deps.mjs"

# 本地资源检索
node "${CLAUDE_SKILL_DIR}/scripts/find-url.mjs" [关键词...]

# 站点匹配
node "${CLAUDE_SKILL_DIR}/scripts/match-site.mjs" "用户输入"
```

## 五、编程技巧总结

| 技巧 | 脚本 | 应用 |
|------|------|------|
| 守护进程模式 | check-deps | `detached: true` + `unref()` |
| 两级回退策略 | check-deps | 文件探测 → 端口扫描 |
| TCP 轻量探测 | check-deps | 避免触发安全弹窗 |
| 递归树遍历 | find-url | Chrome 书签 DFS |
| BigInt 时间戳 | find-url | WebKit 精确转换 |
| SQLite 复制查询 | find-url | 避免文件锁冲突 |
| SQL 注入防护 | find-url | 单引号转义 |
| 动态正则构建 | match-site | 自动转义元字符 |
| Frontmatter 兼容 | match-site | 有则提取，无则全文 |
| 优雅降级 | 全部 | 失败不阻塞，继续执行 |
| 跨平台适配 | 全部 | macOS/Linux/Windows 三端支持 |
