const c = require('compact-encoding')
const IdEnc = require('hypercore-id-encoding')
const ProtomuxRpcClient = require('protomux-rpc-client')

const { resolveStruct } = require('../spec/hyperschema')
const PutServiceRequest = resolveStruct('@rpc-discovery/put-service-request')

class RpcDiscoveryRegisterClient extends ProtomuxRpcClient {
  async putService (publicKey) {
    publicKey = IdEnc.decode(publicKey)
    await this._makeRequest(
      'put-service',
      { publicKey },
      { requestEncoding: PutServiceRequest, responseEncoding: c.none }
    )
  }
}

module.exports = RpcDiscoveryRegisterClient
