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
├── notes/            # 研究笔记
├── demos/            # 独立 demo 工程（蒸馏产物）
│   └── sqlite-crud/  # SQLite CRUD 操作 demo
│       ├── package.json
│       ├── index.mjs
│       └── README.md
├── .study-meta.json  # 项目元数据（topics + backlog + demos）
└── CLAUDE.md         # 本文件
```

## 研究主题

- [x] 架构与核心机制（三层通道调度 + CDP Proxy + 并行分治 + 站点经验）
- [x] CDP Proxy 实现细节（端口发现、WebSocket 管理、HTTP API、反风控）
- [x] 本地资源检索与站点经验系统（Chrome 书签/历史、经验匹配）

## 笔记索引

- [web-access-guide.md](notes/web-access-guide.md) — 项目导读指南（产品认知、架构、核心概念、本地搭建）
- [architecture-overview.md](notes/architecture-overview.md) — 架构与核心机制分析（设计哲学、四层调度、CDP 实现）
- [cdp-proxy-deep-dive.md](notes/cdp-proxy-deep-dive.md) — CDP Proxy 实现细节（端口发现、WebSocket、HTTP API 端点、反风控）
- [local-resource-and-experience.md](notes/local-resource-and-experience.md) — 本地资源检索与经验系统（书签/历史检索、SQLite 查询、经验匹配）
- [web-access-how-to-use-guide.md](notes/web-access-how-to-use-guide.md) — 实战教程：从安装到精通（环境配置 + 5 章实操，含实测数据）
- [skill-to-script-mapping.md](notes/skill-to-script-mapping.md) — Skill→Script 映射与验证（4 个脚本的触发路径、核心机制、运行状态）
- [web-access-article.md](notes/web-access-article.md) — 技术展示文章：一个 Skill 如何让 AI Agent 拥有完整联网能力（6 段式叙事）

## Demos

独立 demo 工程，每个都是可独立运行的项目。用于验证和复现研究笔记中的核心技术点。

| Demo | 验证知识点 | 运行方式 |
|------|-----------|---------|
| [sqlite-crud](demos/sqlite-crud/) | better-sqlite3 同步 API、预编译语句、事务批量操作 | `cd demos/sqlite-crud && npm install && node index.mjs` |
| [websocket-pending-map](demos/websocket-pending-map/) | WebSocket 异步请求-响应匹配、Pending Map 模式、并发乱序、超时处理 | `cd demos/websocket-pending-map && npm install && node index.mjs` |
