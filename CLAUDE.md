# Web Access Study

本项目用于研究 [eze-is/web-access](https://github.com/eze-is/web-access) 仓库。

## 项目简介

Web Access — 给 Claude Code 装上完整联网能力的 skill：三层通道调度 + 浏览器 CDP + 并行分治。

- **语言**: JavaScript
- **Stars**: 5,313
- **更新**: 2026-04-20

## 目录结构

```
web-access-study/
├── web-access/       # 源码（来自 GitHub 浅克隆）
│   ├── SKILL.md      # Skill 定义文件（核心）
│   ├── scripts/      # 源码脚本（cdp-proxy / check-deps / find-url / match-site）
│   ├── references/   # 参考文档
│   └── .claude-plugin/ # 插件配置
├── explorer/         # 成体系笔记（Survey 模式产物，→ 教程）
│   ├── README.md     # 阅读路径索引
│   ├── cheatsheet/   # 速查手册（Cheat Sheet）
│   ├── output/       # 外发产物（技术展示文章、对外发布内容）
│   ├── practices/    # 探索/实操（工具能力扩展、实战演练）
│   └── ...           # 系统调研笔记
├── notes/            # 零散问答（Incremental 模式产物）
│   └── ...           # 增量深入笔记
├── demos/            # 独立 demo 工程（蒸馏产物）
├── .study-meta.json  # 项目元数据（topics + backlog + demos）
└── CLAUDE.md         # 本文件
```

## 研究主题

- [x] 架构与核心机制（三层通道调度 + CDP Proxy + 并行分治 + 站点经验）
- [x] CDP Proxy 实现细节（端口发现、WebSocket 管理、HTTP API、反风控）
- [x] 本地资源检索与站点经验系统（Chrome 书签/历史、经验匹配）
- [x] SKILL.md Prompt Engineering 设计模式（tradeoff 决策、四步框架、经验注入）
- [x] cdp-proxy.mjs 逐行精读（完整代码走读、HTTP API 端点、Pending Map）
- [x] 辅助脚本实现分析（check-deps + find-url + match-site）
- [x] 端到端数据流分析（完整请求链路、组件通信、CDP API 清单）
- [x] Skills 技能探索（Prompt 词速查、脚本映射、实测验证、缺口分析）

## 写作规范

### Frontmatter 必填字段

所有笔记文件（`notes/` 和 `explorer/`）的 YAML frontmatter 必须包含以下字段：

```yaml
---
title: "文章标题"
article_id: OBA-xxxxxxxx    # 唯一标识，格式：OBA-{8位随机字符}
date: "YYYY-MM-DD"
tags: ["标签1", "标签2"]
---
```

- **article_id**：每篇文章的唯一标识，格式为 `OBA-` + 8 位随机字母数字。新建笔记时生成，不可与已有文章重复。
- 其他字段（`source_notes`、`article_id` 等）按需添加。

## 笔记索引

> 阅读顺序详见 [explorer/README.md](explorer/README.md)。以下按 7 层阅读路径排列。

### 第零层：环境准备

0. [00-web-access-environment-setup.md](explorer/00-web-access-environment-setup.md) — 环境准备（Node.js 安装、Chrome 调试配置、Skill 安装、调试指南、常见问题）

### 第一层：先用起来（入口）

1. [01-web-access-how-to-use-guide.md](explorer/01-web-access-how-to-use-guide.md) — 实战教程：从安装到精通（5 章实操，含实测数据）

### 第二层：建立全景认知

2. [02-web-access-guide.md](explorer/02-web-access-guide.md) — 项目导读指南（产品形态、核心概念、设计决策）
3. [03-architecture-overview.md](explorer/03-architecture-overview.md) — 架构全貌（设计哲学、四层调度、CDP 实现、并行分治）

### 第三层：核心实现链路

4. [04-end-to-end-data-flow.md](explorer/04-end-to-end-data-flow.md) — 端到端数据流（完整请求链路、三层调度、组件通信协议、CDP API 清单）
5. [05-cdp-proxy-implementation.md](explorer/05-cdp-proxy-implementation.md) — CDP Proxy 完整实现详解（端口发现、WebSocket 管理、HTTP API 端点、反风控）
6. [06-cdp-proxy-code-walkthrough.md](explorer/06-cdp-proxy-code-walkthrough.md) — cdp-proxy.mjs 逐行精读（⑤的深化版，完整代码走读）

### 第四层：辅助组件

7. [07-supporting-scripts-analysis.md](explorer/07-supporting-scripts-analysis.md) — 辅助脚本分析（check-deps 环境检查、find-url 本地检索、match-site 站点匹配）
8. [08-local-resource-and-experience.md](explorer/08-local-resource-and-experience.md) — 本地资源检索与经验系统（书签/历史检索、SQLite 查询、经验匹配）

### 第五层：Skill 设计思想（进阶）

9. [09-skill-prompt-engineering.md](explorer/09-skill-prompt-engineering.md) — SKILL.md Prompt Engineering 分析（tradeoff 决策、四步框架、经验注入、约束引导）
10. [skill-design-tradeoff-based.md](notes/skill-design-tradeoff-based.md) — Tradeoff-based Prompt 范式（技术事实驱动的高阶 prompt 设计模式）
11. [skill-exploration.md](notes/skill-exploration.md) — Skill→Script 映射验收（Prompt 词速查、脚本映射、逐个实测验证）

### 第六层：速查手册

12. [prompt-cheat-sheet.md](explorer/cheatsheet/prompt-cheat-sheet.md) — Prompt 速查（所有触发词、三层通道选择、示例 Prompt）
13. [cdp-cheat-sheet.md](explorer/cheatsheet/cdp-cheat-sheet.md) — CDP 命令速查（API 列表、HTTP 端点、操作对照、使用示例）

### 第七层：外发产物

14. [web-access-article.md](explorer/output/web-access-article.md) — 技术展示文章（掘金/知乎风格，6 段式叙事）
15. [web-access-author-article/](web-access-author-article/) — 作者原文存档（一泽Eze 微信公众号文章，含图片）
16. [bilibili-video-extraction.md](explorer/practices/bilibili-video-extraction.md) — 实战演练：用 Web Access 提取 B 站 UP 主全部投稿视频数据（DOM 探索、SPA 翻页、183 个视频提取）
17. [capability-exploration.md](explorer/practices/capability-exploration.md) — 能力全景图（核心能力矩阵、实战案例库、扩展畅想、技能封装建议）
18. [juejin-booklet-extraction.md](explorer/practices/juejin-booklet-extraction.md) — 实战演练：掘金小册全文提取（API 逆向、Cookie 自动提取、图片本地化、免费+付费支持、Skill 封装）

## Demos

独立 demo 工程，每个都是可独立运行的项目。用于验证和复现研究笔记中的核心技术点。

| Demo | 验证知识点 | 运行方式 |
|------|-----------|---------|
| [sqlite-crud](demos/sqlite-crud/) | better-sqlite3 同步 API、预编译语句、事务批量操作 | `cd demos/sqlite-crud && npm install && node index.mjs` |
| [websocket-pending-map](demos/websocket-pending-map/) | WebSocket 异步请求-响应匹配、Pending Map 模式、并发乱序、超时处理 | `cd demos/websocket-pending-map && npm install && node index.mjs` |
