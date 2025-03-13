const ReadyResource = require('ready-resource')
const Autobase = require('autobase')
const IdEnc = require('hypercore-id-encoding')

const RpcDiscoveryDb = require('./lib/db')
const { resolveStruct } = require('./spec/hyperschema')
const opEncoding = resolveStruct('@rpc-discovery/op')

const ops = {
  ADD_WRITER: 0,
  REMOVE_WRITER: 1,
  ADD_SERVICE: 2
}

class RpcDiscovery extends ReadyResource {
  static OPS = ops
  static VALUE_ENCODING = opEncoding

  constructor (store, swarm, { bootstrap = null, maxParallel = 256 } = {}) {
    super()

    this.swarm = swarm
    this.store = store

    this.base = new Autobase(this.store, bootstrap, {
      valueEncoding: opEncoding,
      open: this._openAutobase.bind(this),
      apply: this._apply.bind(this),
      close: this._closeAutobase.bind(this)
    })

    this._maxParallel = maxParallel
  }

  get view () {
    return this.base.view
  }

  async _open () {
    await this.base.ready()
    await this.view.ready()
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

  async addService (serviceKey) {
    serviceKey = IdEnc.decode(serviceKey)
    await this.base.append({ op: ops.ADD_SERVICE, serviceKey })
  }

  getKeys ({ limit = 100 } = {}) {
    return this.view.list({ limit })
  }
}

module.exports = RpcDiscovery
