#!/usr/bin/env node

const Hyperswarm = require('hyperswarm')
const IdEnc = require('hypercore-id-encoding')
const { command, flag, arg } = require('paparam')
const Corestore = require('corestore')

const LookupClient = require('./lookup')

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

const cmd = command('autodiscovery-client', lookup)
cmd.parse()
