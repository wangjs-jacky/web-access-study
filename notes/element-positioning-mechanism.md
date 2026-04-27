---
title: "Web Access 元素定位机制：CSS Selector 而非截图"
article_id: OBA-xlgyacwu
date: "2026-04-27"
tags: ["web-access", "cdp", "element-positioning", "css-selector"]
---

# Web Access 元素定位机制：CSS Selector 而非截图

> 关联教程：explorer/03-architecture-overview.md、explorer/05-cdp-proxy-implementation.md

## 问题

Web Access 如何实现"点击页面中间的搜索框"？当页面存在多个搜索框时，它如何精确定位到目标元素？与截图识别方式（如字节 Midscene）有何本质区别？

## 核心机制

Web Access **不使用截图来定位元素**。它的定位方式是 **CSS Selector + DOM 结构分析**，通过 CDP（Chrome DevTools Protocol）实现。

整个定位流程分两步：

### 第一步：「看」— 用 `/eval` 了解页面结构

```bash
# Claude 先执行一段 JS 来扫描页面 DOM，了解有哪些元素
curl -s -X POST "http://localhost:3456/eval?target=ID" -d '
  // 递归遍历 DOM，提取页面结构
  document.querySelectorAll("input, button, [role=searchbox]")
'
```

这一步相当于 Claude 的「眼睛」— 先搞清楚页面上有什么、在哪里。

SKILL.md 的设计哲学是：**先了解页面结构，再决定下一步动作。不需要提前规划所有步骤。**

### 第二步：「做」— 用精确的 CSS Selector 点击目标元素

Web Access 提供两种点击方式，都基于 CSS 选择器：

**`/click` — JS 层面点击（简单快速）**

```bash
curl -s -X POST "http://localhost:3456/click?target=ID" -d 'input.search-box'
```

底层实现（cdp-proxy.mjs）：
```javascript
const el = document.querySelector(selector);
el.scrollIntoView({ block: 'center' });
el.click();
```

**`/clickAt` — CDP 浏览器级真实鼠标点击**

```bash
curl -s -X POST "http://localhost:3456/clickAt?target=ID" -d 'button.upload'
```

底层实现（cdp-proxy.mjs）：
```javascript
const el = document.querySelector(selector);
el.scrollIntoView({ block: 'center' });
const rect = el.getBoundingClientRect();
// 计算元素中心坐标
const x = rect.x + rect.width / 2;
const y = rect.y + rect.height / 2;
// 通过 CDP 派发真实鼠标事件
await sendCDP('Input.dispatchMouseEvent', {
  type: 'mousePressed', x, y, button: 'left', clickCount: 1
});
await sendCDP('Input.dispatchMouseEvent', {
  type: 'mouseReleased', x, y, button: 'left', clickCount: 1
});
```

## 多个相似元素的区分策略

Web Access 依靠 **CSS 选择器的精确度** 来区分。Claude（大模型）负责分析 DOM 结构后写出精确的选择器：

| 场景 | 选择器策略 | 示例 |
|------|-----------|------|
| 有唯一 ID | ID 选择器 | `#main-search` |
| 有 class 区分 | class 选择器 | `input.hero-search` vs `input.nav-search` |
| 按容器区分 | 后代选择器 | `.main-content input[type=search]` |
| 按序号区分 | 伪类选择器 | `input[type=search]:nth-of-type(2)` |
| 按层级关系 | 子选择器 | `.search-bar > input` |
| 按属性区分 | 属性选择器 | `[placeholder="搜索"]` |

关键点：**Claude（大模型）在理解了 DOM 结构后自己编写 CSS 选择器**。Web Access 本身不提供「智能定位」— 它只提供执行能力（`document.querySelector` + `el.click()`）。

## 与截图识别方式的对比

| 维度 | Web Access（CSS Selector） | Midscene 等（截图识别） |
|------|---------------------------|---------------------|
| **定位方式** | DOM 结构 + CSS 选择器 | 视觉截图 + AI 图像识别 |
| **精度** | 精确到像素级（DOM 节点） | 依赖模型识别能力，可能偏差 |
| **速度** | 快（毫秒级 JS 执行） | 慢（截图 + 图像推理） |
| **隐身元素** | 能操作 DOM 中存在但不可见的元素 | 只能看到屏幕上的内容 |
| **动态内容** | 直接读取 DOM 状态 | 需要等渲染完成再截图 |
| **多相似元素** | 依赖选择器精确度 | 依赖视觉描述精确度 |
| **成本** | 低（纯 JS 执行） | 高（每次截图消耗图像推理 token） |
| **Shadow DOM / iframe** | eval 递归遍历可穿透 | 截图看不到这些内容 |

## Web Access 的截图能力用途

Web Access 确实有 `/screenshot` 端点，但它**不用于元素定位**，而是用于：

- **阅读图片/视频内容**（验证码识别、图表数据提取、视频帧分析）
- **视觉确认**（看看页面实际长什么样，确认加载完成）
- **处理非文本内容**（Canvas 渲染的内容、SVG 图形）

## 关键发现

1. **定位哲学**：先读 DOM 理解结构（eval），再精准操作（CSS Selector）。Claude 是「大脑」负责理解页面和写选择器，CDP 是「手」负责执行
2. **截图是辅助的「眼睛」**，用于读图而非定位元素
3. **依赖大模型能力**：选择器的质量取决于 Claude 对 DOM 结构的理解能力，不是框架提供的固定定位策略
