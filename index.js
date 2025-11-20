const { once } = require('events')
const ReadyResource = require('ready-resource')
const Autobase = require('autobase')
const IdEnc = require('hypercore-id-encoding')
const ProtomuxRPC = require('protomux-rpc')
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

/*
Architectural priorities:
 - Low complexity
    - all middleware is sync, to avoid complex state
    - put checks at the correct part of the stack (e.g. connection limit does not belong in protomux-rpc-server, but should refuse connections higher up the stack)
 - Simple API to use:
   - It should be easy/trivial to migrate to from an existing protomux-rpc service
   - limited set of available middleware, configured through simple parameters passed in the constructor
   - not extensible with user-defined middleware (to be discussed whether we would want something extensible or not. Probably makes sense long-term, so probably worth it to verify it could be extensible in the future)

Overall idea:
- protomux-rpc exposes an onrequest callback, guaranteed to be called for every request. It passes on the method and a id unique to the request
- protomux-rpc exposes an onrequestdone callback, guaranteed to be called for every request, regardless of whether it errored. It is passed the same id, and an error object if there was an error
- onrequest can throw to short-circuit a request (for example when rate limited)
- onrequestdone is not allowed to throw
*/

class ProtomuxRpcServer {
  constructor (rpcId, concurrentLimit = 4, rateLimit = { capacity: 10, tokensPerInterval: 10, intervalMs: 100 }, logger = null) {
    this.concurrentLimit = new ConcurrentLimit(concurrentLimit)
    this.rateLimit = new RateLimit(rateLimit)
    this.logger = logger
    this.rpcId = rpcId

    if (this.logger) {
      // should also be tracked in stats, so we can get alerted when many rate limits etc occur
      this.concurrentLimit.on('trigger', (conn) => {
        this.logger.warn('Concurrent limit triggered for ...')
      })
      // etc for others
    }

    // I don't think we should support these until there's a specific need,
    // but this is how I would implement them (likewise for other per-method limits)
    this.endpointSpecificRateLimitters = new Map()

    this.endpoints = []
  }

  createRpc (conn) {
    const rpc = new ProtomuxRPC(conn, {
      id: this.rpcId,
      valueEncoding: cenc.none,
      onrequest: ({ id, method, value }) => this._onrequest({ id, method, value }, conn),
      onrequestdone: ({ id, method, value, error }) => this.rpcMiddleware._onrequestdone({ id, method, value }, conn, error) // for logging, connection timings and concurrent request book keeping
    })
    for (endpoint of this.endpoints) {
      endpoint(rpc)
    }
  }

  registerEndpoint (name, { requestEncoding, responseEncoding }, cb, { rateLimit = null } = {}) {
    if (rateLimit) this.endpointSpecificRateLimitters.set(name, new RateLimitter(rateLimit)) // rateLimit = the opts to create a ratelimitter
    // Likewise for other endpoint-specific limits

    this.endpoints.push((rpc) => {
      rpc.respond(
        name, { requestEncoding, responseEncoding }, cb
      )
    })
  }

  _onrequest ({ id, method, value }, conn) {
    if (this.logger) this.logger.info(`${method} request received (${id}) from...`)

    this.rateLimit.check(conn) // sync check, throws if too many requests

    // I think it's cleaner to put the concurrent limiter directly in protomux-rpc, because
    // then we don't need to worry about tracking which connections are using the concurrent limit
    // But I'm sketching here the approach outside of protomux-rpc, so we can discuss all options
    this.concurrentLimit.check(conn, id) // sync check, throws if too many requests. Stores the id in its state as 'pending'

    // request-specific ones
    const limiter = this.endpointSpecificRateLimitters.get(method)
    if (limiter) limiter.check(conn, id)
  }

  _onrequestdone ({ id, method, value }) {
    // this method as a whole is not allowed to throw

    // rate limiting is stateless, so no action required for that

    this.concurrentLimit.uncheck(conn, id) // frees up 1 from the concurrent limit, if the id was checked

    // request-specific ones
    const limiter = this.endpointSpecificRateLimitters.get(method)
    if (limiter) limiter.uncheck(conn, id)

    if (this.logger) {
      if (error) this.logger.info(`Request error for ${id} from ... (error: ${error.message})`)
      else this.logger.info(`Finished request ${id} from...`)
    }
  }
}

class Autodiscovery extends ReadyResource {
  static OPS = ops
  static VALUE_ENCODING = opEncoding

  constructor (store, swarm, rpcAllowedPublicKey, { bootstrap = null, connectionLimit = 10, concurrentLimit, rateLimit = { capacity: 10, tokensPerInterval: 10, intervalMs: 100 } } = {}) {
    super()

    this.swarm = swarm
    this.store = store
    this.rpcAllowedPublicKey = IdEnc.decode(rpcAllowedPublicKey)

    this.rpcServer = new ProtomuxRpcServer(this.swarm.keyPair.publicKey, { concurrentLimit, rateLimit })
    this.rpcServer.registerEndpoint(
      'put-service',
      { requestEncoding: PutServiceRequest, responseEncoding: cenc.none },
      this._onPutService.bind(this, conn)
    )
    this.rpcServer.registerEndpoint(
      'delete-service',
      { requestEncoding: DeleteServiceRequest, responseEncoding: cenc.none },
      this._onDeleteService.bind(this, conn),
      { rateLimit: { capacity: 1, tokensPerInterval: 1, intervalMs: 1000 } } // additional endpoint-specific rate limit
    )

    // not a protomux-rpc-server concern: this limit should reject connections before they're established.
    // It should probably live in hyperdht or hyperswarm (there is already firewall logic there), but for now it can live in the connection handler
    this.connectionLimitter = new ConnectionLimitter(connectionLimit)

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

  get dbKey () {
    return this.view.db.core.key
  }

  get dbDiscoveryKey () {
    return this.view.db.core.discoveryKey
  }

  async _open () {
    await this.base.ready()
    await this.view.ready()

    // Hack to ensure our db key does not update after the first
    // entry is added (since we add it ourselves)
    if (this.base.isIndexer && this.view.db.core.length === 0) {
      await Promise.all([
        once(this.view.db.core, 'append'),
        this.addService('f'.repeat(64), 'dummy-service')
      ])
    }

    this.swarm.on('connection', (conn) => {
      this.connectionLimitter.check(conn) // sync method, throws if too many connections (not related to protomux-rpc)

      this.store.replicate(conn)

      // We only set up RPC to trusted peers (who know the secret seed)
      if (!b4a.equals(conn.remotePublicKey, this.rpcAllowedPublicKey)) return
      this.emit('rpc-session')

      this.rpcServer.createRpc(conn)
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
