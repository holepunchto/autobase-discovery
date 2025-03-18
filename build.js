const path = require('path')
const HyperDB = require('hyperdb/builder')
const Hyperschema = require('hyperschema')

const SCHEMA_DIR = path.join(__dirname, 'spec', 'hyperschema')
const DB_DIR = path.join(__dirname, 'spec', 'hyperdb')

function build () {
  const schema = Hyperschema.from(SCHEMA_DIR, { versioned: false })
  const ops = schema.namespace('autodiscovery')

  ops.register({
    name: 'service-entry',
    fields: [
      {
        name: 'publicKey',
        type: 'fixed32',
        required: true
      }
    ]
  })

  ops.register({
    name: 'op',
    fields: [
      {
        name: 'op', // command id
        type: 'uint',
        required: true
      },
      {
        name: 'writerKey',
        type: 'fixed32',
        required: false
      },
      {
        name: 'serviceKey',
        type: 'fixed32',
        required: false
      }
    ]
  })

  ops.register({
    name: 'put-service-request',
    fields: [
      {
        name: 'publicKey',
        type: 'fixed32',
        required: true
      }
    ]
  })

  Hyperschema.toDisk(schema)

  const db = HyperDB.from(SCHEMA_DIR, DB_DIR)
  const rpcDiscoveryDb = db.namespace('autodiscovery')

  rpcDiscoveryDb.collections.register({
    name: 'service-entry',
    schema: '@autodiscovery/service-entry',
    key: ['publicKey']
  })

  HyperDB.toDisk(db)
}

build()
