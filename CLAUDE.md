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
│   ├── scripts/      # 脚本工具
│   ├── references/   # 参考文档
│   └── .claude-plugin/ # 插件配置
├── notes/            # 研究笔记
├── scripts/          # 辅助脚本
├── .study-meta.json  # 项目元数据
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
