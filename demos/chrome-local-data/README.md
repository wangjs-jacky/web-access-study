# Chrome 本地数据访问 Demo

## 学习目的

演示如何**跨平台读取 Chrome 本地数据**（Profile 发现、书签检索、历史记录查询），这是 web-access 实现本地资源检索的底层技术。

这个模式来自 [web-access](https://github.com/eze-is/web-access) 项目的 find-url.mjs（完整 214 行）。

## 验证的知识点

- **跨平台 Chrome 数据目录发现**：macOS / Linux / Windows 不同路径
- **Profile 枚举**：解析 Chrome `Local State` 文件获取所有用户 Profile
- **WebKit 时间戳转换**：Chrome 使用 1601 年起始的微秒数，需用 `BigInt` 精确转换
- **SQLite 锁文件处理**：Chrome 运行时锁定数据库，必须复制到临时文件再查询
- **书签树递归遍历**：Chrome 书签是嵌套 JSON 树，使用 DFS 遍历
- **SQL 注入防护**：手动转义单引号（`execFileSync` 不支持参数化查询）

## 功能清单

| 功能 | 必要性 | 说明 |
|------|--------|------|
| Chrome 数据目录发现 | MUST | 跨平台路径映射 |
| Profile 枚举 | MUST | 从 Local State 解析所有 Profile |
| WebKit 时间戳转换 | MUST | BigInt 精确转换（1601→1970 微秒差） |
| SQLite 复制查询 | MUST | 复制到临时文件避免锁冲突 |
| 书签递归检索 | MUST | DFS 遍历 + 多关键词 AND 匹配 |
| SQL 注入防护 | SHOULD | 单引号转义 `replace(/'/g, "''")` |
| 多 Profile 合并 | COULD | 跨 Profile 结果合并排序 |

## 运行方式

```bash
cd demos/chrome-local-data && node index.mjs
```

> 无需 `npm install`，无外部依赖。需要系统已安装 `sqlite3` 命令（macOS/Linux 通常自带）。

## 预期输出

```
Chrome 本地数据访问 Demo

✓ Chrome 数据目录: ~/Library/Application Support/Google/Chrome
✓ 发现 1 个 Profile: 用户1

=== WebKit 时间戳转换 ===
  当前时间: 2026-04-26T12:00:00.000Z
  WebKit 值: 13421678400000000
  反向转换: 2026-04-26T12:00:00.000Z

=== 书签搜索（关键词: github）===
  搜索到的书签标题
    URL: https://github.com/...
    文件夹: 书签栏 / ...

=== 历史记录（最近 5 条）===
  页面标题
    URL: https://...
    访问: 2026-04-26T11:30:00.000Z (3次)

✓ Demo 完成
```

## 核心代码

### WebKit 时间戳转换（3 行）

```javascript
const WEBKIT_EPOCH_DIFF_US = 11644473600000000n; // 1601→1970 微秒差
function webkitToISO(webkitUs) {
  return new Date(Number(BigInt(webkitUs) - WEBKIT_EPOCH_DIFF_US) / 1000);
}
function isoToWebkit(date) {
  return BigInt(date.getTime()) * 1000n + WEBKIT_EPOCH_DIFF_US;
}
```

### SQLite 复制查询模式

```javascript
const tmp = path.join(os.tmpdir(), `chrome-history-${process.pid}-${Date.now()}.sqlite`);
try {
  fs.copyFileSync(src, tmp);            // 复制避免锁文件
  const raw = execFileSync('sqlite3', ['-separator', '\t', tmp, sql]);
  // 解析结果...
} finally {
  try { fs.unlinkSync(tmp); } catch {}  // 清理临时文件
}
```

### 书签递归遍历

```javascript
function walk(node, trail) {
  if (node.type === 'url') {
    const hay = `${node.name} ${node.url}`.toLowerCase();
    if (needles.every(n => hay.includes(n))) out.push({ ... });
  }
  if (Array.isArray(node.children)) {
    for (const c of node.children) walk(c, [...trail, node.name]);
  }
}
```

## 适用场景

- 浏览器自动化工具的用户数据访问
- 个人浏览数据分析和统计
- 自动化测试中的浏览器状态检查
- 安全审计中的浏览器取证
