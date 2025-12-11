const { once } = require('events')
const ReadyResource = require('ready-resource')
const Autobase = require('autobase')
const IdEnc = require('hypercore-id-encoding')
const cenc = require('compact-encoding')
const b4a = require('b4a')

const RpcDiscoveryDb = require('./lib/db')
const { resolveStruct } = require('./spec/hyperschema')
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

  constructor (store, swarm, rpcAllowedPublicKey, router, { bootstrap = null } = {}) {
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

    this.router = router
    this.router.method(
      'put-service',
      { requestEncoding: PutServiceRequest, responseEncoding: cenc.none },
      this._onPutService.bind(this)
    )
    this.router.method(
      'delete-service',
      { requestEncoding: DeleteServiceRequest, responseEncoding: cenc.none },
      this._onDeleteService.bind(this)
    )
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
    await this.router.ready()

    // Hack to ensure our db key does not update after the first
    // entry is added (since we add it ourselves)
    if (this.base.isIndexer && this.view.db.core.length === 0) {
      await Promise.all([
        once(this.view.db.core, 'append'),
        this.addService('f'.repeat(64), 'dummy-service')
      ])
    }

    this.swarm.on('connection', (conn) => {
      this.store.replicate(conn)

      // We only set up RPC to trusted peers (who know the secret seed)
      if (!b4a.equals(conn.remotePublicKey, this.rpcAllowedPublicKey)) return
      this.emit('rpc-session')

      this.router.handleConnection(conn, this.swarm.keyPair.publicKey)
    })

    // DEVNOTE: the caller is responsible for maintaining
    // consistent swarm keypairs across restarts
    await this.swarm.listen()
  }

  async _close () {
    await this.view.close()
    await this.base.close()
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

  async _onPutService (req) {
    await this.addService(req.publicKey, req.service)
  }

  async _onDeleteService (req) {
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
