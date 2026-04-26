# Web Access Study Notes

> 从零开始，先用起来，再理解为什么，最后深入设计思想。

## 阅读路径

```
第一层：先用起来（入口）
  │  目标：5 分钟内用 curl 控制你的浏览器
  ▼
  ① 01-web-access-how-to-use-guide.md
  │
  │  "我跑通了，但为什么 curl 能控制浏览器？"
  ▼
第二层：建立全景认知
  │  目标：理解产品形态、核心概念、架构全貌
  ▼
  ② 02-web-access-guide.md              ← 导读指南：产品形态 + 核心概念
  ③ 03-architecture-overview.md          ← 架构全貌：四层调度 + CDP + 并行分治
  │
  │  "整体我理解了，想看具体数据是怎么流转的"
  ▼
第三层：核心实现链路
  │  目标：搞懂一个请求从发起到返回的完整链路
  ▼
  ④ 04-end-to-end-data-flow.md           ← 端到端数据流：完整请求链路 + 组件通信协议
  ⑤ 05-cdp-proxy-implementation.md       ← CDP Proxy 完整实现（端口发现 / 会话 / API）
  ⑥ 06-cdp-proxy-code-walkthrough.md     ← 逐行精读 cdp-proxy.mjs（⑤的深化版）
  │
  │  "CDP 我懂了，其他脚本呢？"
  ▼
第四层：辅助组件
  │  目标：理解围绕 CDP Proxy 的辅助系统
  ▼
  ⑦ 07-supporting-scripts-analysis.md    ← check-deps / find-url / match-site 三个脚本
  ⑧ 08-local-resource-and-experience.md  ← Chrome 书签/历史检索 + SQLite 查询
  │
  │  "我想理解它的 Prompt 设计思路"
  ▼
第五层：Skill 设计思想（进阶）
  │  目标：学习如何设计一个高质量的 AI Skill
  ▼
  ⑨ 09-skill-prompt-engineering.md       ← SKILL.md Prompt Engineering 分析
  ⑩ skill-design-tradeoff-based.md    ← Tradeoff-based Prompt 范式（认知颠覆点）
  ⑪ skill-exploration.md              ← Skill→Script 映射验收 + 实测
  │
  │  "我想写篇技术文章分享"
  ▼
第六层：外发产物（独立阅读）
  │  目标：对外分享的技术内容
  ▼
  ⑫ web-access-article.md             ← 技术展示文章（掘金/知乎风格）
  ⑬ web-access-author-article/        ← 作者原文存档（参考）
```

## 笔记定位

| # | 文件 | 给谁看 | 解决什么问题 |
|---|------|--------|------------|
| ① | `01-web-access-how-to-use-guide.md` | **所有人（入口）** | 怎么安装、怎么用、curl 能做什么 |
| ② | `02-web-access-guide.md` | 用过之后想理解原理的人 | 产品形态、核心概念、设计决策 |
| ③ | `03-architecture-overview.md` | 想看架构全貌的人 | 四层调度、CDP Proxy 角色、并行分治 |
| ④ | `04-end-to-end-data-flow.md` | 想追踪完整请求链路的人 | 三层调度数据流、组件通信协议、CDP API 清单 |
| ⑤ | `05-cdp-proxy-implementation.md` | 想看源码实现的人 | 端口发现、WebSocket 管理、HTTP API 完整映射 |
| ⑥ | `06-cdp-proxy-code-walkthrough.md` | 想逐行读源码的人 | cdp-proxy.mjs 完整代码走读（⑤的深化） |
| ⑦ | `07-supporting-scripts-analysis.md` | 想了解辅助工具的人 | check-deps 环境检查、find-url 检索、match-site 匹配 |
| ⑧ | `08-local-resource-and-experience.md` | 想了解本地数据检索的人 | 书签/历史检索、SQLite 锁文件处理、经验匹配 |
| ⑨ | `09-skill-prompt-engineering.md` | 想学 Prompt 设计的人 | SKILL.md 的四步框架、tradeoff 决策、约束引导 |
| ⑩ | `skill-design-tradeoff-based.md` | 想学高阶 Prompt 范式的人 | "技术事实"驱动的 Prompt 设计模式 |
| ⑪ | `skill-exploration.md` | 想验证 Skill 可用性的人 | Prompt 词速查、脚本映射、逐个实测 |
| ⑫ | `web-access-article.md` | 想对外分享的人 | 掘金/知乎风格技术展示文章 |
| ⑬ | `web-access-author-article/` | 想看作者原文的人 | 一泽Eze 微信公众号原文存档 |

## 阅读原则

1. **先跑通再看原理** — 如果你还没用 curl 控制过浏览器，从 ① 开始
2. **按层级深入** — 每一层解决一类问题，不需要每篇都看
3. **带着问题读** — 每篇笔记开头都有"你为什么会在这"的铺垫
4. **⑤→⑥ 是深化关系** — ⑥ 是 ⑤ 的逐行精读版，可二选一
5. **⑨→⑩→⑪ 是递进关系** — 从 Prompt 分析 → 设计范式 → 实测验证
