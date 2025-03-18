const HyperDB = require('hyperdb')
const ReadyResource = require('ready-resource')
const DBLock = require('db-lock')
const IdEnc = require('hypercore-id-encoding')

const spec = require('../spec/hyperdb')

class RpcDiscoveryDb extends ReadyResource {
  constructor (core, { maxParallel = 256, extension = true } = {}) {
    super()

    const db = HyperDB.bee(core, spec, { extension, autoUpdate: true })
    this.db = db
    this._lock = new DBLock({
      // Sanity check so we always flush at some point,
      // even with a continuous stream of put requests
      maxParallel,
      enter () {
        return db.transaction()
      },
      async exit (tx) {
        await tx.flush()
      }
    })
  }

  get key () {
    return this.db.core.key
  }

  get discoveryKey () {
    return this.db.core.discoveryKey
  }

  async _open () {
    await this.db.ready()
  }

  async _close () {
    await this.db.close()
  }

  async insert (publicKey) {
    publicKey = IdEnc.decode(publicKey)
    if (!this.opened) await this.ready()

    const tx = await this._lock.enter()
    try {
      await tx.insert(
        '@autodiscovery/service-entry',
        { publicKey }
      )
    } finally {
      await this._lock.exit(tx)
    }
  }

  async get (publicKey) {
    publicKey = IdEnc.decode(publicKey)
    if (!this.opened) await this.ready()

    const entry = await this.db.get(
      '@autodiscovery/service-entry',
      { publicKey }
    )
    return entry
  }

  async has (publicKey) {
    return (await this.get(publicKey)) !== null
  }

  list ({ limit = 100 } = {}) {
    const query = {}
    return this.db.find('@autodiscovery/service-entry', query, { limit })
  }
}

module.exports = RpcDiscoveryDb
