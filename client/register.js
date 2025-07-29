const cenc = require('compact-encoding')
const IdEnc = require('hypercore-id-encoding')
const ProtomuxRpcClient = require('protomux-rpc-client')
const ReadyResource = require('ready-resource')

const { resolveStruct } = require('../spec/hyperschema')
const HyperDHT = require('hyperdht')
const PutServiceRequest = resolveStruct('@autodiscovery/put-service-request')

class RpcDiscoveryRegisterClient extends ReadyResource {
  constructor (serverKey, dht, accessSeed) {
    super()

    this.keyPair = HyperDHT.keyPair(IdEnc.decode(accessSeed))
    this.rpcClient = new ProtomuxRpcClient(dht, { keyPair: this.keyPair })
    this.key = IdEnc.decode(serverKey)
  }

  async _open () {}

  async _close () {
    await this.rpcClient.close()
  }

  async putService (publicKey, service) {
    if (!this.opened) await this.ready()

    publicKey = IdEnc.decode(publicKey)
    await this.rpcClient.makeRequest(
      this.key,
      'put-service',
      { publicKey, service },
      { requestEncoding: PutServiceRequest, responseEncoding: cenc.none }
    )
  }
}

module.exports = RpcDiscoveryRegisterClient
