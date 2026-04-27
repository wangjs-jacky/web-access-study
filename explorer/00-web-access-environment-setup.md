---
article_id: OBA-k4m9w7px
title: "Web Access 环境准备"
tags: [study-note, setup]
type: note
created_at: 2026-04-27
updated_at: 2026-04-27
---

# Web Access 环境准备

> **定位**：这篇笔记解决"怎么把 Web Access 装好、配好"的问题。所有环境配置集中在这里，其他笔记不再重复。
>
> **完成后继续阅读**：[实战教程](01-web-access-how-to-use-guide.md) | [项目导读](02-web-access-guide.md)

---

## 一、你需要准备什么

| 工具 | 要求 | 说明 |
|------|------|------|
| Node.js | 22+ | CDP Proxy 使用原生 WebSocket，需要 22+ 的内置支持 |
| Chrome | 开启远程调试 | 让 Proxy 能通过 CDP 协议控制浏览器 |
| sqlite3 | 可选 | 用于 `find-url.mjs` 的历史记录检索功能 |

## 二、安装 Node.js 22+

> **为什么需要它？** CDP Proxy 是一个 Node.js 脚本，它需要 Node.js 22+ 因为这个版本内置了原生 WebSocket 支持，不需要额外安装依赖。

### 2.1 检查当前版本

```bash
node --version
```

如果输出 >= v22.0.0，跳过本节。

### 2.2 安装或升级

```bash
# 使用 nvm 安装（推荐）
nvm install 22
nvm use 22

# 或直接从官网下载：https://nodejs.org/
```

### 2.3 验证

```bash
node --version
# 输出应 >= v22.0.0
```

## 三、安装 web-access Skill

### 3.1 克隆仓库

```bash
git clone https://github.com/eze-is/web-access.git /tmp/web-access
```

### 3.2 链接到 Claude Code skills 目录

```bash
# 创建 skills 目录（如果不存在）
mkdir -p ~/.claude/skills/

# 链接（symlink 方式，方便后续更新）
ln -sf /tmp/web-access ~/.claude/skills/web-access
```

### 3.3 验证

```bash
ls ~/.claude/skills/web-access/SKILL.md
# 应输出该文件路径
```

## 四、开启 Chrome 远程调试

> **为什么需要这一步？** Chrome 默认不允许外部程序控制它。开启远程调试后，Chrome 会在一个本地端口上监听指令。CDP Proxy 就是连这个端口来操控浏览器的。

1. 在 Chrome 地址栏输入：
   ```
   chrome://inspect/#remote-debugging
   ```

2. 勾选 **"Allow remote debugging for this browser instance"**

3. 可能需要重启 Chrome

### 验证

```bash
cat ~/Library/Application\ Support/Google/Chrome/DevToolsActivePort
# 应输出两行：第一行是端口号，第二行是 WebSocket 路径
```

## 五、安装 sqlite3（可选）

用于 Chrome 历史记录检索功能。不安装不影响核心 CDP 功能。

> **为什么 sqlite3 不影响 CDP 核心功能？**
>
> `sqlite3` 是"本地资源检索"模块的一部分，具体用于 `find-url.mjs` 脚本来查询 Chrome 历史记录数据库（History 文件）。它与 CDP Proxy 是完全独立的两个模块：
>
> - **CDP Proxy** (`cdp-proxy.mjs`)：负责 HTTP→WebSocket 翻译，控制浏览器，不需要 sqlite3
> - **本地资源检索** (`find-url.mjs`)：负责搜索 Chrome 书签/历史，需要 sqlite3 查询 History 数据库
>
> 因此即使不安装 sqlite3，所有 CDP 操作（浏览、点击、截图等）都能正常工作，只是无法使用本地历史记录搜索功能。

```bash
# macOS
brew install sqlite3

# 或使用系统自带版本
which sqlite3
```

## 六、运行环境检查

所有准备工作完成后，运行 web-access 自带的环境检查脚本：

```bash
node ~/.claude/skills/web-access/scripts/check-deps.mjs
```

脚本会依次检查：
- `node: ok` — Node.js 版本
- `chrome: ok (port XXXX)` — Chrome 调试端口
- `proxy: ready` — CDP Proxy 自动启动并连接

## 七、调试指南

### 各组件调试入口

| 组件 | 打开方式 | 说明 |
|------|---------|------|
| CDP Proxy | `curl http://127.0.0.1:3333/targets` | 查看 Chrome 连接状态 |
| Chrome 端口 | `cat ~/Library/Application Support/Google/Chrome/DevToolsActivePort` | 查看调试端口号 |
| 站点经验 | `ls references/site-patterns/` | 查看已有经验文件 |

### 常见问题排查

**问题：Proxy 启动后连接超时**
- 原因：Chrome 未开启远程调试端口
- 排查：检查 `chrome://inspect/#remote-debugging` 是否勾选

**问题：页面检测到自动化操作**
- 原因：网站通过探测 CDP 端口检测自动化
- 排查：确认 `portGuard` 逻辑是否生效（拦截 127.0.0.1:{port} 请求）

**问题：find-url.mjs 无法读取历史**
- 原因：Chrome 运行时锁定 History 文件
- 排查：脚本会自动复制到临时目录，确认 sqlite3 已安装

---

## 配置完成检查清单

```bash
# 逐项验证
node --version                                           # ☐ 版本 >= 22
ls ~/.claude/skills/web-access/SKILL.md                  # ☐ Skill 已安装
cat ~/Library/Application\ Support/Google/Chrome/DevToolsActivePort  # ☐ Chrome 调试已开启
which sqlite3                                            # ☐ sqlite3 可用（可选）
node ~/.claude/skills/web-access/scripts/check-deps.mjs  # ☐ 三项全部 ok
```

**全部打勾 → 配置完成，开始使用！**

> 继续阅读：[实战教程](01-web-access-how-to-use-guide.md) | [项目导读](02-web-access-guide.md)
