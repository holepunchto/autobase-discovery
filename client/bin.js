#!/usr/bin/env node

const Hyperswarm = require('hyperswarm')
const IdEnc = require('hypercore-id-encoding')
const { command, flag, arg } = require('paparam')
const Corestore = require('corestore')

const LookupClient = require('./lookup')

const lookup = command('list',
  arg('<dbKey>', 'Public key of the RPC-discovery database'),
  flag('--storage|-s [path]', 'storage path, defaults to ./rpc-discovery-client'),
  flag('--limit|-l [nr]', 'Max amount of services to show (default 10)'),
  flag('--debug|-d', 'Debug mode (more logs)'),
  async function ({ args, flags }) {
    const storage = flags.storage || 'rpc-discovery-client'
    const debug = flags.debug
    const limit = flags.limit || 10

    const dbKey = IdEnc.decode(args.dbKey)

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
      dbKey, swarm, store.namespace('rpc-discovery-lookup')
    )
    await client.ready()
    console.log('Loading database...')
    try {
      await client.ensureDbLoaded()
    } catch (e) {
      console.error(e.message)
      process.exit(1)
    }

    console.log('Available services:')
    for await (const { publicKey } of await client.list({ limit })) {
      console.info(`  - ${IdEnc.normalize(publicKey)}`)
    }

    await client.close()
    await swarm.destroy()
    await store.close()
  }
)

const cmd = command('rpc-discovery-client', lookup)
cmd.parse()
