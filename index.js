const ReadyResource = require('ready-resource')
const Autobase = require('autobase')
const IdEnc = require('hypercore-id-encoding')
const ProtomuxRPC = require('protomux-rpc')
const cenc = require('compact-encoding')
const b4a = require('b4a')

const RpcDiscoveryDb = require('./lib/db')
const { resolveStruct } = require('./spec/hyperschema')
const HealthChecker = require('./lib/health-checker')
const opEncoding = resolveStruct('@autodiscovery/op')
const PutServiceRequest = resolveStruct('@autodiscovery/put-service-request')
const DeleteServiceRequest = resolveStruct('@autodiscovery/delete-service-request')

const ops = {
  ADD_WRITER: 0,
  REMOVE_WRITER: 1,
  ADD_SERVICE: 2,
  DELETE_SERVICE: 3
}

class Autodiscovery extends ReadyResource {
  static OPS = ops
  static VALUE_ENCODING = opEncoding

  constructor (store, swarm, rpcAllowedPublicKey, { bootstrap = null } = {}) {
    super()

    this.swarm = swarm
    this.store = store
    this.rpcAllowedPublicKey = IdEnc.decode(rpcAllowedPublicKey)

    this.base = new Autobase(this.store, bootstrap, {
      valueEncoding: opEncoding,
      open: this._openAutobase.bind(this),
      apply: this._apply.bind(this),
      close: this._closeAutobase.bind(this)
    })

    this.healthChecker = new HealthChecker(this.swarm.dht, {
      frequency: this.healthCheckFrequency,
      maxTime: this.healthCheckMaxTime
    })
  }

  get view () {
    return this.base.view
  }

  get serverPublicKey () {
    return this.swarm.keyPair.publicKey
  }

  get dbKey () {
    return this.view.db.core.key
  }

  get dbDiscoveryKey () {
    return this.view.db.core.discoveryKey
  }

  async _open () {
    await this.base.ready()
    await this.view.ready()
    this.healthChecker.on('change', (key, healthy) => {
      // TODO: update db
      // console.log('changed', key, healthy)
    })
    await this.healthChecker.ready()

    this._setupChangeWatcher() // Does not throw

    // Hack to ensure our db key does not update after the first
    // entry is added (since we add it ourselves)
    if (this.base.isIndexer && this.view.db.core.length === 0) {
      await this.base.append(null)
    }

    this.swarm.on('connection', (conn) => {
      this.store.replicate(conn)

      // We only set up RPC to trusted peers (who know the secret seed)
      if (!b4a.equals(conn.remotePublicKey, this.rpcAllowedPublicKey)) return
      this.emit('rpc-session')

      const rpc = new ProtomuxRPC(conn, {
        id: this.swarm.keyPair.publicKey,
        valueEncoding: cenc.none
      })
      rpc.respond(
        'put-service',
        { requestEncoding: PutServiceRequest, responseEncoding: cenc.none },
        this._onPutService.bind(this, conn)
      )
      rpc.respond(
        'delete-service',
        { requestEncoding: DeleteServiceRequest, responseEncoding: cenc.none },
        this._onDeleteService.bind(this, conn)
      )
    })

    // DEVNOTE: the caller is responsible for maintaining
    // consistent swarm keypairs across restarts
    await this.swarm.listen()
  }

  async _close () {
    this._changeWatcher.destroy()
    await this.healthChecker.close()
    await this.view.close()
    await this.base.close()
  }

  async _setupChangeWatcher () {
    this._changeWatcher = this.view.createChangeWatcher()
    try {
      for await (const { collection, type, value } of this._changeWatcher) {
        if (collection !== '@autodiscovery/service-entry') continue
        if (type === 'insert') {
          this.healthChecker.addTarget(value.publicKey)
        } else if (type === 'delete') {
          this.healthChecker.deleteTarget(value.publicKey) // TODO: test
        }
      }
    } catch (e) {
      if (this.closing) return // expected (destroys the watcher)
      console.error('changes error', e) // TODO: what? (Should not happen, but should probably crash if it does)
    }
  }

  _openAutobase (store) {
    const core = store.get('view')
    const db = new RpcDiscoveryDb(core, { extension: false })
    return db
  }

  async _closeAutobase (view) {
    await view.close()
  }

  // Must not be called directly, only from the autobase apply
  async _apply (nodes, view, base) {
    if (!view.opened) await view.ready()

    for (const node of nodes) {
      if (node.value.op === ops.ADD_SERVICE) {
        const value = node.value
        if (!value.serviceKey || !value.serviceName) continue // TODO: warning system
        const { serviceKey, serviceName } = node.value

        if (await view.has(serviceKey)) continue
        await view.insert(serviceKey, serviceName)
      } else if (node.value.op === ops.DELETE_SERVICE) {
        if (!node.value.serviceKey) continue
        const { serviceKey } = node.value
        await view.delete(serviceKey)
      } else if (node.value.op === ops.ADD_WRITER) {
        await base.addWriter(node.value.writerKey, { isIndexer: true })
      }
    }
  }

  async _onPutService (stream, req) {
    await this.addService(req.publicKey, req.service)
  }

  async _onDeleteService (stream, req) {
    await this.deleteService(req.publicKey)
  }

  async addService (serviceKey, serviceName) {
    serviceKey = IdEnc.decode(serviceKey)
    await this.base.append({ op: ops.ADD_SERVICE, serviceKey, serviceName })
  }

  async deleteService (serviceKey) {
    serviceKey = IdEnc.decode(serviceKey)
    await this.base.append({ op: ops.DELETE_SERVICE, serviceKey })
  }

  getKeys (service, { limit = 100 } = {}) {
    return this.view.list(service, { limit })
  }
}

module.exports = Autodiscovery
