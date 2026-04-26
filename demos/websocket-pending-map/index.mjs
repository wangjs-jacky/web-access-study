/**
 * WebSocket Pending Map 模式演示
 *
 * 核心问题：通过 WebSocket 发命令，响应异步返回且顺序不确定。
 * 怎么知道哪条响应对应哪条命令？
 *
 * 解法：每条命令分配唯一 ID，发送时把 Promise 的 resolve/reject 存进 Map，
 * 收到响应时按 ID 查找并 resolve。
 */

import { EventEmitter } from 'events'

// ============================================================
// 一、模拟的 WebSocket 连接（不需要真实浏览器）
// ============================================================

class MockWebSocket extends EventEmitter {
  constructor() {
    super()
    this.connected = true
  }

  send(raw) {
    const msg = JSON.parse(raw)
    // 模拟异步响应：不同命令有不同延迟，且顺序不一定和发送一致
    const delay = msg.params?.delay ?? Math.floor(Math.random() * 500 + 50)
    setTimeout(() => {
      if (msg.method === 'fail') {
        // 模拟错误响应
        this.emit('message', JSON.stringify({ id: msg.id, error: { message: '命令执行失败' } }))
      } else {
        // 模拟成功响应
        this.emit('message', JSON.stringify({
          id: msg.id,
          result: { value: `${msg.method} 的执行结果`, elapsed: delay }
        }))
      }
    }, delay)
  }
}

// ============================================================
// 二、Pending Map 核心 —— 请求-响应匹配引擎
// ============================================================

class PendingMap {
  /**
   * @param {object} options
   * @param {number} options.timeout - 超时时间（毫秒），默认 5000
   */
  constructor(options = {}) {
    this._nextId = 0
    this._pending = new Map()  // id → { resolve, reject, timer, method }
    this._timeout = options.timeout ?? 5000
    this._stats = { sent: 0, resolved: 0, rejected: 0, timedOut: 0 }
  }

  /**
   * 注册一个待处理的请求，返回 Promise
   * @param {string} method - 命令名称（用于日志和超时提示）
   * @param {Function} sendFn - 实际发送函数，接收 (id) 参数
   * @returns {Promise} 命令响应
   */
  register(method, sendFn) {
    return new Promise((resolve, reject) => {
      const id = ++this._nextId
      this._stats.sent++

      // 超时保护
      const timer = setTimeout(() => {
        this._pending.delete(id)
        this._stats.timedOut++
        reject(new Error(`命令超时: ${method} (id=${id})`))
      }, this._timeout)

      // 存入 Map，等响应来匹配
      this._pending.set(id, { resolve, reject, timer, method })

      // 发送命令（调用方负责实际传输）
      sendFn(id)
    })
  }

  /**
   * 收到响应时调用，按 id 匹配并 resolve Promise
   * @param {object} msg - 响应消息，必须包含 id 字段
   */
  handleResponse(msg) {
    if (!msg.id || !this._pending.has(msg.id)) return

    const { resolve, reject, timer, method } = this._pending.get(msg.id)
    clearTimeout(timer)
    this._pending.delete(msg.id)

    if (msg.error) {
      this._stats.rejected++
      reject(new Error(msg.error.message))
    } else {
      this._stats.resolved++
      resolve(msg)
    }
  }

  /** 当前等待中的请求数 */
  get pendingCount() {
    return this._pending.size
  }

  /** 统计信息 */
  get stats() {
    return { ...this._stats }
  }
}

// ============================================================
// 三、演示场景
// ============================================================

function log(tag, ...args) {
  const time = new Date().toISOString().slice(11, 23)
  console.log(`[${time}] [${tag}]`, ...args)
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms))
}

async function main() {
  console.log('='.repeat(60))
  console.log('WebSocket Pending Map 模式演示')
  console.log('='.repeat(60))
  console.log()

  // ---------- 场景 1：基本请求-响应 ----------
  console.log('--- 场景 1：基本请求-响应 ---')

  const ws1 = new MockWebSocket()
  const pm1 = new PendingMap({ timeout: 5000 })

  // 监听 WebSocket 消息，转发给 PendingMap
  ws1.on('message', (raw) => {
    const msg = JSON.parse(raw)
    pm1.handleResponse(msg)
  })

  // 发送一条命令
  const result1 = await pm1.register('Page.navigate', (id) => {
    log('发送', `id=${id}, method=Page.navigate`)
    ws1.send(JSON.stringify({ id, method: 'Page.navigate', params: { url: 'https://example.com' } }))
  })
  log('收到', `id=${result1.id}, result=`, result1.result.value)

  console.log()

  // ---------- 场景 2：并发请求，乱序响应 ----------
  console.log('--- 场景 2：并发请求，乱序响应 ---')

  const ws2 = new MockWebSocket()
  const pm2 = new PendingMap({ timeout: 5000 })

  ws2.on('message', (raw) => {
    const msg = JSON.parse(raw)
    pm2.handleResponse(msg)
  })

  // 同时发 5 条命令，响应顺序随机
  const commands = [
    'Target.createTarget',
    'Page.enable',
    'Runtime.evaluate',
    'DOM.getDocument',
    'Network.enable',
  ]

  log('发送', `同时发送 ${commands.length} 条命令...`)

  const promises = commands.map((method) =>
    pm2.register(method, (id) => {
      ws2.send(JSON.stringify({ id, method, params: {} }))
    })
  )

  // 逐个打印完成顺序（证明响应可以乱序到达，但每条都正确匹配）
  for (const p of promises) {
    const r = await p
    log('完成', `id=${r.id}, method=${commands[r.id - 1]}, 响应时间=${r.result.elapsed}ms`)
  }

  console.log()

  // ---------- 场景 3：超时处理 ----------
  console.log('--- 场景 3：超时处理 ---')

  const ws3 = new MockWebSocket()
  const pm3 = new PendingMap({ timeout: 1000 }) // 1 秒超时

  ws3.on('message', (raw) => {
    const msg = JSON.parse(raw)
    pm3.handleResponse(msg)
  })

  // 发一条会超时的命令（delay 设为 2000ms，超过 1s 超时）
  try {
    await pm3.register('超时命令', (id) => {
      log('发送', `id=${id}, 故意延迟 2000ms（超时阈值 1000ms）`)
      ws3.send(JSON.stringify({ id, method: 'slow.command', params: { delay: 2000 } }))
    })
  } catch (err) {
    log('超时', err.message)
  }

  console.log()

  // ---------- 场景 4：错误响应 ----------
  console.log('--- 场景 4：错误响应 ---')

  const ws4 = new MockWebSocket()
  const pm4 = new PendingMap({ timeout: 5000 })

  ws4.on('message', (raw) => {
    const msg = JSON.parse(raw)
    pm4.handleResponse(msg)
  })

  try {
    await pm4.register('fail', (id) => {
      log('发送', `id=${id}, method=fail（模拟失败）`)
      ws4.send(JSON.stringify({ id, method: 'fail', params: {} }))
    })
  } catch (err) {
    log('错误', err.message)
  }

  console.log()

  // ---------- 统计 ----------
  console.log('--- 统计信息 ---')
  const stats = pm2.stats
  console.log(`发送: ${stats.sent}  完成: ${stats.resolved}  超时: ${pm3.stats.timedOut}  错误: ${pm4.stats.rejected}`)

  console.log()
  console.log('='.repeat(60))
  console.log('演示结束')
  console.log('='.repeat(60))
}

main().catch(console.error)
