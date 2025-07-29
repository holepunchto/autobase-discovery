const cenc = require('compact-encoding')
const IdEnc = require('hypercore-id-encoding')
const ProtomuxRpcClient = require('protomux-rpc-client')
const HyperDHT = require('hyperdht')

const { resolveStruct } = require('../spec/hyperschema')
const ReadyResource = require('ready-resource')
const DeleteServiceRequest = resolveStruct('@autodiscovery/delete-service-request')

class RpcDiscoveryDeleteClient extends ReadyResource {
  constructor (serverKey, dht, accessSeed) {
    super()

    this.keyPair = HyperDHT.keyPair(IdEnc.decode(accessSeed))
    this.rpcClient = new ProtomuxRpcClient(dht, { keyPair: this.keyPair })
    this.serverKey = IdEnc.decode(serverKey)
  }

  async _open () {}

  async _close () {
    await this.rpcClient.close()
  }

  async deleteService (publicKey) {
    if (!this.opened) await this.ready()

    publicKey = IdEnc.decode(publicKey)
    await this.rpcClient.makeRequest(
      this.serverKey,
      'delete-service',
      { publicKey },
      { requestEncoding: DeleteServiceRequest, responseEncoding: cenc.none }
    )
  }
}

module.exports = RpcDiscoveryDeleteClient
