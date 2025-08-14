#!/usr/bin/env node

const Hyperswarm = require('hyperswarm')
const IdEnc = require('hypercore-id-encoding')
const { command, flag, arg, description } = require('paparam')
const Corestore = require('corestore')
const goodbye = require('graceful-goodbye')
const HyperDHT = require('hyperdht')

const LookupClient = require('./lookup')
const DeleteClient = require('./delete')
const RegisterClient = require('./register')

const lookup = command('list',
  arg('<dbKey>', 'Public key of the autodiscovery database'),
  arg('<service>', 'Name of the service for which to list the entries'),
  flag('--storage|-s [path]', 'storage path, defaults to ./autodiscovery-client'),
  flag('--limit|-l [nr]', 'Max amount of services to show (default 10)'),
  flag('--debug|-d', 'Debug mode (more logs)'),
  async function ({ args, flags }) {
    const storage = flags.storage || 'autodiscovery-client'
    const debug = flags.debug
    const limit = flags.limit || 10

    const dbKey = IdEnc.decode(args.dbKey)
    const { service } = args

    const swarm = new Hyperswarm()
    const store = new Corestore(storage)
    swarm.on('connection', (conn, peerInfo) => {
      if (debug) {
        const key = IdEnc.normalize(peerInfo.publicKey)
        console.debug(`Opened connection to ${key}`)
        conn.on('close', () => console.debug(`Closed connection to ${key}`))
      }
      store.replicate(conn)
    })

    const client = new LookupClient(
      dbKey, swarm, store.namespace('autodiscovery-lookup')
    )
    await client.ready()
    console.log('Loading database...')
    try {
      await client.ensureDbLoaded()
    } catch (e) {
      console.error(e.message)
      process.exit(1)
    }

    console.log(`Autobase Discovery database version: ${client.db.db.core.length}`)

    console.log(`Available instances for service '${service}':`)
    let foundOne = false
    for await (const { publicKey } of await client.list(service, { limit })) {
      console.info(`  - ${IdEnc.normalize(publicKey)}`)
      foundOne = true
    }
    if (!foundOne) console.info('None (did not find any instances)')

    await client.close()
    await swarm.destroy()
    await store.close()
  }
)

const deleteCmd = command('delete',
  description('Request to delete a service entry from the database. This is an advanced administartion command which requires a secret to authenticate with the autobase-discovery service.'),
  arg('<rpcKey>', 'Key where the RPC server listens'),
  arg('<accessSeed>', 'Secret seed which gives access to the RPC. Note that an invalid seed results in a request that hangs.'),
  arg('<publicKey>', 'Public key of the service to remove'),
  async function ({ args, flags }) {
    const rpcServerKey = IdEnc.decode(args.rpcKey)
    const accessSeed = IdEnc.decode(args.accessSeed)
    const publicKey = IdEnc.decode(args.publicKey)

    const dht = new HyperDHT()

    const client = new DeleteClient(
      rpcServerKey, dht, accessSeed
    )

    let done = false
    goodbye(async () => {
      if (!done) console.info('Cancelling...')
      if (client.opened) await client.close()
      await dht.destroy()
    })

    console.info('Opening connection... (press ctrl-c to cancel)')
    await client.ready()

    console.log(`Sending delete request to RPC server ${IdEnc.normalize(rpcServerKey)}, using public key ${IdEnc.normalize(client.keyPair.publicKey)}...`)
    await client.deleteService(publicKey)
    console.log(`Successfully requested to delete service ${IdEnc.normalize(publicKey)}`)

    done = true
    goodbye.exit()
  }
)

const registerCmd = command('register',
  description('Request to add a service entry to the database. This is an advanced administartion command which requires a secret to authenticate with the autobase-discovery service.'),
  arg('<rpcKey>', 'Key where the RPC server listens'),
  arg('<accessSeed>', 'Secret seed which gives access to the RPC. Note that an invalid seed results in a request that hangs.'),
  arg('<publicKey>', 'Public key of the service to add'),
  arg('<serviceName>', 'Service name to add the key to'),
  async function ({ args }) {
    const rpcServerKey = IdEnc.decode(args.rpcKey)
    const accessSeed = IdEnc.decode(args.accessSeed)
    const publicKey = IdEnc.decode(args.publicKey)
    const serviceName = args.serviceName

    const dht = new HyperDHT()
    const client = new RegisterClient(rpcServerKey, dht, accessSeed)

    let done = false
    goodbye(async () => {
      if (!done) console.info('Cancelling...')
      if (client.opened) await client.close()
      await dht.destroy()
    })

    console.info('Opening connection... (press ctrl-c to cancel)')
    await client.ready()

    console.info(`Sending register request to RPC server ${IdEnc.normalize(rpcServerKey)}, using public key ${IdEnc.normalize(client.keyPair.publicKey)}...`)
    await client.putService(publicKey, serviceName)
    console.info(`Successfully requested to register service ${IdEnc.normalize(publicKey)}`)

    done = true
    goodbye.exit()
  }
)

const cmd = command('autodiscovery-client', lookup, registerCmd, deleteCmd)
cmd.parse()
