const { EventEmitter } = require('events')
const rrp = require('resolve-reject-promise')
const IdEnc = require('hypercore-id-encoding')
const ReadyResource = require('ready-resource')
const safetyCatch = require('safety-catch')

class HealthChecker extends ReadyResource {
  constructor (dht, { frequency = 60_000 * 15, maxTime = 10_000 } = {}) {
    super()

    this.dht = dht
    this.maxTime = maxTime
    this.frequency = frequency
    if (this.maxTime > this.interval) throw new Error('Max wait time must be lower than the interval')

    this._targets = new Map()
    this._scheduleLoopProm = null
  }

  async _open () {
    this._scheduleLoopProm = this._runScheduleLoop()
    this._scheduleLoopProm.catch(safetyCatch)
  }

  async _close () {
    if (this._resolveScheduleLoop) this._resolveScheduleLoop()
    await this._scheduleLoopProm

    const closeProms = []
    for (const target of this._targets.values()) {
      closeProms.push(target.close())
    }
    await Promise.all(closeProms)
  }

  async _runScheduleLoop () {
    while (!this.closing) {
      const targets = [...this._targets.values()]
      const interval = targets.length === 0
        ? this.frequency
        : this.frequency / targets.length

      const wait = async () => {
        // Wait to launch next
        const { promise, resolve } = rrp()
        this._resolveScheduleLoop = resolve
        const timeout = setTimeout(resolve, interval)
        await promise
        this.off('close', resolve)
        clearTimeout(timeout)
      }

      await wait()
      for (const target of targets) {
        if (this.closing) break
        target.check(this.maxTime).catch(safetyCatch)
        await wait()
      }
    }
  }

  getOverview () {
    const res = new Map()
    for (const [id, checker] of this._targets) {
      res.set(id, checker.healthy)
    }

    return res
  }

  addTarget (key) {
    const bufferId = IdEnc.decode(key)
    const id = IdEnc.normalize(key)
    const target = new HealthCheck(key, this.dht)
    this._targets.set(id, target)
    target.on('change', (healthy) => {
      this.emit('change', bufferId, healthy)
    })
    target.check().catch(safetyCatch) // run initial health check
  }

  deleteTarget (key) {
    const id = IdEnc.normalize(key)
    const target = this._targets.get(key)
    if (!target) return
    this._targets.delete(id)
    target.close().catch(safetyCatch)
  }
}

class HealthCheck extends EventEmitter {
  constructor (target, dht) {
    super()

    this.target = IdEnc.decode(target)
    this.dht = dht

    this.healthy = null
    this._currentPromise = null
    this._currentResolve = null
    this.closing = false
  }

  async close () {
    this.closing = true
    if (this._currentResolve) this._currentResolve()
    if (this._currentPromise) await this._currentPromise
  }

  async check (maxTime) {
    // So we never run multiple checks in parallel
    if (this._currentResolve) this._currentResolve()
    const oldProm = this._currentPromise
    const { resolve, promise } = rrp()
    this._currentResolve = resolve
    this._currentPromise = promise

    // Let the resolve call finish the previous run
    if (oldProm) await this._currentPromise

    let newHealthy = false

    const timeout = setTimeout(() => {
      resolve()
    }, maxTime)

    const socket = this.dht.connect(this.target)
    const onOpen = () => {
      newHealthy = true
      resolve()
    }
    const onError = () => {
      newHealthy = false
      resolve()
    }
    // TODO: can the socket start opened?
    socket.once('open', onOpen)
    socket.once('error', onError)

    // Contract is that the promise will always resolve (never reject)
    await promise

    // cleanup
    if (!socket.destroyed) socket.destroy()
    if (timeout) clearTimeout(timeout)

    if (this.closing) return

    const changed = newHealthy !== this.healthy
    this.healthy = newHealthy
    if (changed) this.emit('change', this.healthy)
  }
}

module.exports = HealthChecker
