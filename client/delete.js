const c = require('compact-encoding')
const IdEnc = require('hypercore-id-encoding')
const ProtomuxRpcClient = require('protomux-rpc-client')
const HyperDHT = require('hyperdht')

const { resolveStruct } = require('../spec/hyperschema')
const DeleteServiceRequest = resolveStruct('@autodiscovery/delete-service-request')

class RpcDiscoveryDeleteClient extends ProtomuxRpcClient {
  constructor (serverKey, dht, accessSeed, opts = {}) {
    const keyPair = HyperDHT.keyPair(IdEnc.decode(accessSeed))

    super(serverKey, dht, { ...opts, keyPair })
  }

  async deleteService (publicKey) {
    publicKey = IdEnc.decode(publicKey)
    await this._makeRequest(
      'delete-service',
      { publicKey },
      { requestEncoding: DeleteServiceRequest, responseEncoding: c.none }
    )
  }
}

module.exports = RpcDiscoveryDeleteClient
