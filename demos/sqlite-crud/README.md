# SQLite CRUD Demo

> **关联 Topic**: `local-resource-and-experience` — 本地资源检索与站点经验系统
> **学习目的**: 验证 better-sqlite3 的同步 API 模式，这是 web-access 读取 Chrome 书签/历史数据库的基础操作

## 这是什么？

web-access 在读取 Chrome History 和 Bookmarks 时，需要用到 SQLite 查询。由于 Chrome 运行时会锁定数据库文件，需要先复制到临时目录再查询。这个 demo 验证的就是这一层基础操作：SQLite 的 CRUD + 安全查询模式。

## 验证的知识点

- **better-sqlite3 同步 API** — 无需 async/await，适合本地文件读取场景
- **预编译语句** — `.prepare()` 防止 SQL 注入，且可复用提升性能
- **事务批量操作** — `db.transaction()` 包裹批量插入，保证原子性
- **临时数据库 + 自动清理** — `os.tmpdir()` 创建临时文件，运行后删除

## 功能清单

| 功能 | 必要性 | 说明 |
|------|--------|------|
| 建表 + 插入数据 | MUST | 基础 CRUD 操作 |
| 预编译语句查询 | MUST | 防 SQL 注入，web-access 的核心安全模式 |
| 事务批量插入 | MUST | 原子操作，Chrome History 批量查询的基础 |
| UPDATE / DELETE | MUST | 完整 CRUD 闭环 |
| 聚合查询（COUNT/AVG/MIN/MAX） | SHOULD | 数据统计模式，了解即可 |

## 运行方式

```bash
cd demos/sqlite-crud
npm install
node index.mjs
```

## 预期输出

程序分 8 个阶段依次执行：
1. 创建数据库 → 临时目录下的 SQLite 文件
2. 建表 → users 表（id, name, email, age）
3. 插入数据 → 3 条用户记录
4. 查询数据 → 打印所有用户
5. 事务批量插入 → 一次性插入 100 条记录
6. 条件查询 → 按年龄范围筛选
7. 更新与删除 → 修改和删除指定记录
8. 聚合查询 → COUNT / AVG / MIN / MAX 统计

运行结束后自动清理临时文件。

## 关联资源

- 研究笔记: [notes/local-resource-and-experience.md](../../notes/local-resource-and-experience.md)
- 源码参考: [web-access/scripts/find-url.mjs](../../web-access/scripts/find-url.mjs) — Chrome History 查询的完整实现
