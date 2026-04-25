# Web Access Study

> [eze-is/web-access](https://github.com/eze-is/web-access) 深度研究笔记与实战教程

Web Access — 给 Claude Code 装上完整联网能力的 Skill：三层通道调度 + 浏览器 CDP + 并行分治。

## 研究内容

| 主题 | 笔记 | 说明 |
|------|------|------|
| 项目导读 | [web-access-guide.md](notes/web-access-guide.md) | 产品认知、架构、核心概念、本地搭建 |
| 架构与核心机制 | [architecture-overview.md](notes/architecture-overview.md) | 设计哲学、四层调度、CDP 实现 |
| CDP Proxy 实现细节 | [cdp-proxy-deep-dive.md](notes/cdp-proxy-deep-dive.md) | 端口发现、WebSocket、HTTP API、反风控 |
| 本地资源与经验系统 | [local-resource-and-experience.md](notes/local-resource-and-experience.md) | 书签/历史检索、SQLite 查询、经验匹配 |
| **实战教程** | [web-access-how-to-use-guide.md](notes/web-access-how-to-use-guide.md) | 环境配置 + 5 章实操（含实测数据） |

## 项目结构

```
web-access-study/
├── web-access/          # 源码（来自 GitHub）
│   ├── SKILL.md         # Skill 定义文件（核心）
│   ├── scripts/         # cdp-proxy / check-deps / find-url / match-site
│   └── references/      # CDP API 参考 + 站点经验模板
├── notes/               # 研究笔记与教程
├── scripts/             # 辅助脚本
└── .study-meta.json     # 项目元数据
```

## 核心概念速览

- **四层工具调度**：WebSearch → WebFetch/curl → Jina → CDP 浏览器，按场景选最小代价
- **CDP Proxy**：HTTP → WebSocket 翻译层，直连用户日常 Chrome（天然携带登录态）
- **并行分治**：多目标时分发子 Agent 并行执行，共享一个 Proxy
- **站点经验积累**：按域名存储操作经验，跨 session 复用

## 许可证

本仓库为研究笔记，源码版权归 [eze-is/web-access](https://github.com/eze-is/web-access) 原作者所有。
