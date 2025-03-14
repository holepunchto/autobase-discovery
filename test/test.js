const { once } = require('events')
const test = require('brittle')
const Corestore = require('corestore')
const Hyperswarm = require('hyperswarm')
const getTestnet = require('hyperdht/testnet')
const b4a = require('b4a')

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
    service.addService(key1)
  ])

  const keys = await toList(service.getKeys())
  t.alike(keys, [{ publicKey: b4a.from(key1, 'hex') }])
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
    service.serverPublicKey, dht
  )

  await client.putService(key1)

  await Promise.all([
    waitForNewEntry(service),
    client.putService(key1)
  ])

  const keys = await toList(service.getKeys())
  t.alike(keys, [{ publicKey: b4a.from(key1, 'hex') }])
  await client.close()
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
    service.addService(key1)
  ])

  const keys = await toList(service.getKeys())
  t.alike(keys, [{ publicKey: b4a.from(key1, 'hex') }], 'sanity check')

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

  const service = new RpcDiscovery(store.namespace('rpc-discovery'), swarm)
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
