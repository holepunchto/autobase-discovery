const IdEnc = require('hypercore-id-encoding')
const ReadyResource = require('ready-resource')

const RpcDiscoveryDb = require('../lib/db')

class BaseClient extends ReadyResource {
  constructor (dbKey, swarm, store) {
    super()

    this.dbKey = IdEnc.decode(dbKey)

    // Note: corestore replication is NOT handled here
    this.swarm = swarm
    this.store = store // Normally a namespace (life cycle managed here)

    this.core = this.store.get({ key: this.dbKey })
    this.db = null
  }

  async _open () {
    await this.core.ready()

    this.db = new RpcDiscoveryDb(this.core, { extension: false })
    await this.db.ready()
    this.swarm.join(this.core.discoveryKey, { client: true, server: false })
  }

  async _close () {
    // Note: assumes we're not interested in this core elsewhere in our app
    this.swarm.leave(this.core.discoveryKey)

    await this.db.close()
    await this.store.close()
  }

  async ensureDbLoaded (timeoutMs = 10000) {
    if (this.db.db.core.length > 0) {
      // TODO: smarter
      if (this.db.db.core.peers.length === 0) {
        await this.swarm.flush()
      }

      await this.core.update()
      return
    }
    await new Promise((resolve, reject) => {
      let cancelHandler = null
      let timeout = null

      const cleanup = () => {
        this.removeListener('close', cancelHandler)
        clearTimeout(timeout)
      }

      timeout = setTimeout(
        () => {
          cleanup()
          reject(new Error('Load-db Timeout'))
        },
        timeoutMs
      )
      cancelHandler = () => {
        cleanup()
        reject(new Error('Client closed'))
      }
      this.on('close', cancelHandler)

      this.db.db.core.once('append', () => {
        cleanup()
        resolve()
      })
    })
  }
}

class RpcDiscoveryLookupClient extends BaseClient {
  async list (service, { limit = 3 } = {}) {
    if (!this.opened) await this.ready()
    await this.ensureDbLoaded()

    return this.db.list(service, { limit })
  }
}

module.exports = RpcDiscoveryLookupClient
