# 本地资源检索与站点经验系统

> 深入分析 Chrome 书签/历史检索机制和站点经验匹配系统

## 背景问题

web-access 如何从用户本地 Chrome 中检索书签和历史记录？如何按域名积累和复用站点操作经验？

## 核心发现

### 1. Chrome Profile 发现

`getChromeDataDir()` + `listProfiles()`（行 61-81）：

| 平台 | Chrome 数据目录 |
|------|----------------|
| macOS | `~/Library/Application Support/Google/Chrome` |
| Linux | `~/.config/google-chrome` |
| Windows | `%LOCALAPPDATA%/Google/Chrome/User Data` |

- 读取 `Local State` 文件获取所有 Profile 列表
- 解析失败时降级返回 Default Profile

### 2. 书签检索

`searchBookmarks()`（行 84-108）：

**Chrome Bookmarks JSON 结构**：
```json
{
  "roots": {
    "bookmark_bar": { "type": "folder", "children": [...] },
    "other": { ... },
    "synced": { ... }
  }
}
```

**关键算法**：
- 递归遍历书签树，`trail` 参数追踪文件夹路径
- 多关键词 AND 匹配：`needles.every(n => hay.includes(n))`
- 无关键词时返回空（书签无时间维度，海量数据无意义）

### 3. 历史检索

`searchHistory()`（行 113-149）：

**核心技术挑战：SQLite 运行时锁定**
- Chrome 始终锁定 History 文件
- 解决方案：`fs.copyFileSync(src, tmp)` 复制到临时目录再查询
- 临时文件命名：`chrome-history-${process.pid}-${Date.now()}.sqlite`（避免并发冲突）

**WebKit 时间戳魔法**：
```javascript
// Chrome 使用 WebKit 时间戳（微秒，从 1601-01-01 开始）
// Unix 时间戳（毫秒，从 1970-01-01 开始）
// 差值 = 11644473600000000 微秒
const WEBKIT_EPOCH_DIFF_US = 11644473600000000n;
const webkitUs = BigInt(since.getTime()) * 1000n + WEBKIT_EPOCH_DIFF_US;
```

**SQL 注入防护**：
```javascript
const esc = kw.toLowerCase().replace(/'/g, "''");  // 单引号转义
```

**参数支持**：
| 参数 | 说明 | 示例 |
|------|------|------|
| `--since 7d` | 时间窗（d/h/m） | 最近 7 天 |
| `--sort visits` | 按访问次数排序 | 高频网站 |
| `--limit 20` | 结果数量限制 | 0 表示不限制 |
| `--only history` | 只搜索历史 | 跳过书签 |

**跨 Profile 合并**：
- 多 Profile 结果合并后统一排序
- 智能标注：仅当存在多个 Profile 时才显示 `@profileName`

### 4. 站点经验系统

#### 4.1 文件格式
```markdown
---
domain: example.com
aliases: [示例, Example]
updated: 2026-03-19
---
## 平台特征
## 有效模式
## 已知陷阱
```

#### 4.2 匹配逻辑（match-site.mjs）
```
遍历 references/site-patterns/*.md
  → 提取 domain + aliases
  → 构建正则：domain|alias1|alias2
  → 匹配用户输入
  → 跳过 frontmatter，输出正文
```

**关键设计**：
- 正则转义避免 `.` 被当通配符
- 大小写不敏感匹配
- Frontmatter 跳过：用 `^---$` 定位 YAML 块边界

#### 4.3 启动时列表输出（check-deps.mjs 第 158-167 行）
```javascript
const sites = fs.readdirSync(patternsDir).filter(f => f.endsWith('.md'));
console.log(`site-patterns: ${sites.join(', ')}`);
```

### 5. 并发安全设计

| 机制 | 说明 |
|------|------|
| 临时文件命名 | `process.pid` + `Date.now()` 避免冲突 |
| CDP Proxy 单实例 | 端口占用检测 + 健康检查 |
| 字段分隔符冲突 | `\|` 替换为全角竖线 `│` |
| SQL 注入防护 | 单引号转义 |

## 关键代码位置

- `find-url.mjs:61-81` — Chrome Profile 发现
- `find-url.mjs:84-108` — 书签递归检索
- `find-url.mjs:111` — WebKit 时间戳常量
- `find-url.mjs:113-149` — 历史记录 SQLite 查询
- `find-url.mjs:151-160` — 参数解析（--since --sort --limit）
- `match-site.mjs:18-46` — 站点经验正则匹配
- `check-deps.mjs:158-167` — 启动时经验列表输出

## 可复用模式

1. **临时文件读取锁定的 SQLite**：复制到临时目录再查询，避免运行时锁定
2. **WebKit 时间戳转换**：`BigInt(unixMs) * 1000n + 11644473600000000n`
3. **跨 Profile 合并 + 智能标注**：仅在多 Profile 时显示来源
4. **Frontmatter 分离 + 正则别名匹配**：机器可读 + 人类可编辑的经验文件
5. **降级回退**：Local State 解析失败 → Default Profile
