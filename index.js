const ReadyResource = require('ready-resource')
const Autobase = require('autobase')
const IdEnc = require('hypercore-id-encoding')
const ProtomuxRPC = require('protomux-rpc')
const cenc = require('compact-encoding')

const RpcDiscoveryDb = require('./lib/db')
const { resolveStruct } = require('./spec/hyperschema')
const opEncoding = resolveStruct('@rpc-discovery/op')
const PutServiceRequest = resolveStruct('@rpc-discovery/put-service-request')

const ops = {
  ADD_WRITER: 0,
  REMOVE_WRITER: 1,
  ADD_SERVICE: 2
}

class RpcDiscovery extends ReadyResource {
  static OPS = ops
  static VALUE_ENCODING = opEncoding

  constructor (store, swarm, { bootstrap = null } = {}) {
    super()

    this.swarm = swarm
    this.store = store

    this.base = new Autobase(this.store, bootstrap, {
      valueEncoding: opEncoding,
      open: this._openAutobase.bind(this),
      apply: this._apply.bind(this),
      close: this._closeAutobase.bind(this)
    })
  }

  get view () {
    return this.base.view
  }

  get serverPublicKey () {
    return this.swarm.keyPair.publicKey
  }

  async _open () {
    await this.base.ready()
    await this.view.ready()

    this.swarm.on('connection', (conn) => {
      this.store.replicate(conn)

      const rpc = new ProtomuxRPC(conn, {
        id: this.swarm.keyPair.publicKey,
        valueEncoding: cenc.none
      })
      rpc.respond(
        'put-service',
        { requestEncoding: PutServiceRequest, responseEncoding: cenc.none },
        this._onPutService.bind(this, conn)
      )
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
        const { serviceKey } = node.value

        if (await view.has(serviceKey)) continue
        await view.insert(serviceKey)
      } else if (node.value.op === ops.ADD_WRITER) {
        await base.addWriter(node.value.writerKey, { isIndexer: true })
      }
    }
  }

  async _onPutService (stream, req) {
    await this.addService(req.publicKey)
  }

  async addService (serviceKey) {
    serviceKey = IdEnc.decode(serviceKey)
    await this.base.append({ op: ops.ADD_SERVICE, serviceKey })
  }

  getKeys ({ limit = 100 } = {}) {
    return this.view.list({ limit })
  }
}

module.exports = RpcDiscovery
