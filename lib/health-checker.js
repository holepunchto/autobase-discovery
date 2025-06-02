const { EventEmitter } = require('events')
const rrp = require('resolve-reject-promise')
const debounce = require('debounceify')
const IdEnc = require('hypercore-id-encoding')

class HealthChecker extends EventEmitter {
  constructor (target, dht, { frequency = 60_000 * 15, maxTime = 10_000 } = {}) {
    super()

    this.target = IdEnc.decode(target)
    this.dht = dht
    this.maxTime = maxTime
    this.frequency = frequency
    if (this.maxTime > this.interval) throw new Error('Max wait time must be lower than the interval')

    this.healthy = null
    this._currentTimeout = null

    this.check = debounce(this._checkUndebounced.bind(this))
  }

  ready () {
    this.interval = setInterval(
      this.check, // Does not throw
      this.frequency
    )
    this.check() // run first check
  }

  close () {
    if (this._currentTimeout) clearTimeout(this._currentTimeout)
    if (this._currentSocket && !this._currentSocket.destroyed) this._currentSocket.destroy()
    if (this.interval) clearInterval(this.interval)
  }

  async _checkUndebounced () {
    const { resolve, promise } = rrp()

    let nowHealthy = false

    this._currentTimeout = setTimeout(() => {
      resolve()
    }, this.maxTime)

    this._currentSocket = this.dht.connect(this.target)
    const onOpen = () => {
      nowHealthy= true
      resolve()
    }
    const onError = () => {
      nowHealthy = false
      resolve()
    }
    // TODO: can the socket start opened?
    this._currentSocket.once('open', onOpen)
    this._currentSocket.once('error', onError)

    await promise

    // cleanup
    if (!this._currentSocket.destroyed) this._currentSocket.destroy()
    if (this._currentTimeout) clearTimeout(this._currentTimeout)
    this._currentSocket.off('open', onOpen)

    this._setHealthy(nowHealthy)
  }

  _setHealthy (newHealthy) {
    const changed = newHealthy !== this.healthy
    this.healthy = newHealthy
    if (!changed) return
    if (this.healthy) {
      this.emit('healthy')
    } else {
      this.emit('unhealthy')
    }
  }
}

module.exports = HealthChecker
