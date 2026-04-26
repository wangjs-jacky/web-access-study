# Web Access Study Notes

> 从零开始，先用起来，再理解为什么。

## 阅读路径

```
第一站：用起来
  │  目标：5 分钟内用 curl 控制你的浏览器
  ▼
  web-access-how-to-use-guide.md
  │
  │  "我跑通了，但为什么 curl 能控制浏览器？"
  ▼
第二站：理解原理
  │  目标：搞懂 CDP Proxy 是怎么把 HTTP 翻译成浏览器操作的
  ▼
  web-access-guide.md（"核心概念"部分）
  │
  │  "我想看看具体是怎么实现的"
  ▼
第三站：深入细节
  │  按需选读，每篇独立
  ▼
  cdp-proxy-implementation.md    ← 端口发现、会话管理、反风控的完整实现
  local-resource-and-experience.md ← Chrome 书签/历史检索
```

## 笔记定位

| 文件 | 给谁看 | 解决什么问题 |
|------|--------|------------|
| `web-access-how-to-use-guide.md` | **所有人（入口）** | 怎么安装、怎么用、curl 能做什么 |
| `web-access-guide.md` | 用过之后想理解原理的人 | 四层调度是什么、为什么需要 Proxy、设计决策 |
| `cdp-proxy-implementation.md` | 想看源码实现的人 | 端口发现、WebSocket 管理、HTTP API 完整映射 |
| `local-resource-and-experience.md` | 想了解本地数据检索的人 | 书签/历史检索、SQLite 锁文件处理 |

## 阅读原则

1. **先跑通再看原理** — 如果你还没用 curl 控制过浏览器，先别看后面的
2. **按需深入** — 不是每篇都要看，取决于你想理解到哪一层
3. **带着问题读** — 每篇笔记开头都有"你为什么会在这"的铺垫
