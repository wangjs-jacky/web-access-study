#!/usr/bin/env node
/**
 * Demo: SQLite CRUD 基础操作
 * 关联 Topic: local-resource-and-experience
 *
 * 运行: cd demos/sqlite-crud && npm install && node index.mjs
 */

import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// ==================== 一、创建/连接数据库 ====================
console.log('\n【1. 创建数据库】\n');

const dbPath = path.join(os.tmpdir(), 'demo.sqlite');
// 删除旧文件（如果存在）
if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);

// 创建数据库连接
const db = new Database(dbPath);
console.log(`✓ 数据库已创建: ${dbPath}`);

// ==================== 二、创建表 ====================
console.log('\n【2. 创建表】\n');

// 创建一个简单的 users 表
db.exec(`
  CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE,
    age INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);
console.log('✓ 表 users 已创建');

// ==================== 三、插入数据 (INSERT) ====================
console.log('\n【3. 插入数据】\n');

// 方式1：直接执行 SQL（不推荐，有 SQL 注入风险）
db.exec("INSERT INTO users (name, email, age) VALUES ('张三', 'zhangsan@example.com', 25)");
console.log('✓ 插入一条数据（方式1：exec）');

// 方式2：预处理语句（推荐，安全且可复用）
const insertStmt = db.prepare('INSERT INTO users (name, email, age) VALUES (?, ?, ?)');
const info1 = insertStmt.run('李四', 'lisi@example.com', 30);
console.log(`✓ 插入李四，ID: ${info1.lastInsertRowid}`);

const info2 = insertStmt.run('王五', 'wangwu@example.com', 28);
console.log(`✓ 插入王五，ID: ${info2.lastInsertRowid}`);

// 批量插入（使用事务）
const insertMany = db.transaction((users) => {
  for (const user of users) {
    insertStmt.run(user.name, user.email, user.age);
  }
});
insertMany([
  { name: '赵六', email: 'zhaoliu@example.com', age: 22 },
  { name: '孙七', email: 'sunqi@example.com', age: 35 },
]);
console.log('✓ 批量插入 2 条数据（事务）');

// ==================== 四、查询数据 (SELECT) ====================
console.log('\n【4. 查询数据】\n');

// 查询所有数据
const allStmt = db.prepare('SELECT * FROM users');
const allUsers = allStmt.all();
console.log('所有用户：');
console.table(allUsers);

// 查询单条数据
const oneStmt = db.prepare('SELECT * FROM users WHERE id = ?');
const user = oneStmt.get(2);
console.log(`\nID=2 的用户:`, user);

// 带条件的查询
const searchStmt = db.prepare('SELECT * FROM users WHERE age > ? ORDER BY age DESC');
const olderUsers = searchStmt.all(25);
console.log('\n年龄 > 25 的用户（按年龄降序）：');
console.table(olderUsers);

// ==================== 五、更新数据 (UPDATE) ====================
console.log('\n【5. 更新数据】\n');

const updateStmt = db.prepare('UPDATE users SET age = ? WHERE name = ?');
const updateInfo = updateStmt.run(26, '张三');
console.log(`✓ 更新张三的年龄为 26，影响行数: ${updateInfo.changes}`);

// 验证更新
const updatedUser = db.prepare('SELECT * FROM users WHERE name = ?').get('张三');
console.log('更新后的张三:', updatedUser);

// ==================== 六、删除数据 (DELETE) ====================
console.log('\n【6. 删除数据】\n');

const deleteStmt = db.prepare('DELETE FROM users WHERE id = ?');
const deleteInfo = deleteStmt.run(5); // 删除孙七
console.log(`✓ 删除 ID=5 的用户，影响行数: ${deleteInfo.changes}`);

// 验证删除
const remainingUsers = db.prepare('SELECT COUNT(*) as count FROM users').get();
console.log(`剩余用户数: ${remainingUsers.count}`);

// ==================== 七、聚合查询 ====================
console.log('\n【7. 聚合查询】\n');

const stats = db.prepare(`
  SELECT
    COUNT(*) as total,
    AVG(age) as avg_age,
    MIN(age) as min_age,
    MAX(age) as max_age
  FROM users
`).get();
console.log('统计信息：', stats);

// ==================== 八、关闭连接 ====================
console.log('\n【8. 清理】\n');

db.close();
console.log('✓ 数据库连接已关闭');

// 删除演示数据库
fs.unlinkSync(dbPath);
console.log('✓ 演示数据库已删除');

console.log('\n==================== Demo 完成 ====================\n');
