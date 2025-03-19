const { once } = require('events')
const test = require('brittle')
const Corestore = require('corestore')
const Hyperswarm = require('hyperswarm')
const getTestnet = require('hyperdht/testnet')
const b4a = require('b4a')
const safetyCatch = require('safety-catch')

const RpcDiscovery = require('..')
const RegisterClient = require('../client/register')
const HyperDHT = require('hyperdht')
const RpcDiscoveryLookupClient = require('../client/lookup')

const DEBUG = false

test('registry and lookup flow without RPC', async t => {
  const testnet = await getTestnet(t)
  const { service } = await setup(t, testnet)
  await service.ready()

  const key1 = 'a'.repeat(64)

  await Promise.all([
    waitForNewEntry(service),
    service.addService(key1, 'my-service')
  ])

  const keys = await toList(service.getKeys('my-service'))
  t.alike(keys, [{ publicKey: b4a.from(key1, 'hex'), service: 'my-service' }])
})

test('registry and lookup flow without RPC--multiple services', async t => {
  const testnet = await getTestnet(t)
  const { service } = await setup(t, testnet)
  await service.ready()

  const key1 = 'a'.repeat(64)
  const key2 = 'b'.repeat(64)
  const key3 = 'c'.repeat(64)

  await Promise.all([
    waitForNewEntry(service),
    service.addService(key1, 'my-service')
  ])
  await Promise.all([
    waitForNewEntry(service),
    service.addService(key2, 'my-service')
  ])
  await Promise.all([
    waitForNewEntry(service),
    service.addService(key3, 'other-service')
  ])

  const keys = await toList(service.getKeys('my-service'))
  t.alike(
    keys,
    [
      { publicKey: b4a.from(key1, 'hex'), service: 'my-service' },
      { publicKey: b4a.from(key2, 'hex'), service: 'my-service' }
    ],
    'other-service entry not included'
  )
})

test('registry flow with RPC', async t => {
  t.plan(1)
  const testnet = await getTestnet()
  const { bootstrap } = testnet
  const { service } = await setup(t, testnet)
  await service.ready()
  await service.swarm.flush()

  const dht = new HyperDHT({ bootstrap })
  t.teardown(async () => { await dht.destroy() }, { order: 100 })

  const key1 = 'a'.repeat(64)
  const client = new RegisterClient(
    service.serverPublicKey, dht, { accessSeed: service.accessSeed }
  )

  await client.putService(key1, 'my-service')

  await Promise.all([
    waitForNewEntry(service),
    client.putService(key1, 'my-service')
  ])

  const keys = await toList(service.getKeys('my-service'))
  t.alike(keys, [{ publicKey: b4a.from(key1, 'hex'), service: 'my-service' }])
  await client.close()
})

test('No RPC with incorrect access seed', async t => {
  t.plan(1)
  const testnet = await getTestnet()
  const { bootstrap } = testnet
  const { service } = await setup(t, testnet)
  await service.ready()
  await service.swarm.flush()

  const dht = new HyperDHT({ bootstrap })
  t.teardown(async () => { await dht.destroy() }, { order: 100 })

  const key1 = 'a'.repeat(64)
  const client = new RegisterClient(
    service.serverPublicKey, dht, { accessSeed: 'f'.repeat(64) }
  )

  // TODO: needs timeout option in protomux-rpc-client to do cleanly
  // (we now just verify that it can't connect within 1 sec)
  const putProm = new Promise((resolve, reject) => {
    client.putService(key1, 'my-service').then(resolve).catch(safetyCatch)
    setTimeout(() => reject(new Error('TIMEOUT')), 1000)
  })
  await t.exception(async () => await putProm, /TIMEOUT/)
})

test('lookup flow with lookupClient', async t => {
  t.plan(2)
  const testnet = await getTestnet()
  const { bootstrap } = testnet
  const { service } = await setup(t, testnet)
  await service.ready()

  const key1 = 'a'.repeat(64)

  await Promise.all([
    waitForNewEntry(service),
    service.addService(key1, 'my-service')
  ])

  const keys = await toList(service.getKeys('my-service'))
  t.alike(keys, [{ publicKey: b4a.from(key1, 'hex'), service: 'my-service' }], 'sanity check')

  service.swarm.join(service.dbDiscoveryKey, { server: true, client: true })
  await service.swarm.flush()

  const swarm = new Hyperswarm({ bootstrap })
  const store = new Corestore(await t.tmp())
  swarm.on('connection', conn => {
    if (DEBUG) console.log('DEBUG CLIENT connection opened')
    store.replicate(conn)
  })
  const client = new RpcDiscoveryLookupClient(
    service.dbKey, swarm, store
  )
  t.teardown(async () => {
    await client.close()
    await swarm.destroy()
    await store.close()
  }, { order: 50 })

  const clientKeys = await toList(await client.list())
  t.alike(keys, clientKeys, 'can lookup with client')
})

async function setup (t, testnet) {
  const { bootstrap } = testnet

  const storage = await t.tmp()
  const store = new Corestore(storage)
  const swarm = new Hyperswarm({ bootstrap })

  const accessSeed = b4a.from('b'.repeat(64), 'hex')
  const service = new RpcDiscovery(store.namespace('autodiscovery'), swarm, accessSeed)
  await service.ready()

  t.teardown(async () => {
    await service.close()
    await swarm.destroy()
    await store.close()
    await testnet.destroy()
  }, { order: 10000 })

  return { service, bootstrap, swarm }
}

async function waitForNewEntry (service) {
  await once(service.view.db.core, 'append')
}

async function toList (stream) {
  const res = []
  for await (const x of stream) {
    res.push(x)
  }

  return res
}
