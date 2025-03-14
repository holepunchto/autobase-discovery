#!/usr/bin/env node

const Corestore = require('corestore')
const IdEnc = require('hypercore-id-encoding')
const Hyperswarm = require('hyperswarm')
const goodbye = require('graceful-goodbye')
const { command, flag } = require('paparam')
const HyperInstrumentation = require('hyper-instrument')
const pino = require('pino')

const RpcDiscovery = require('.')

const runCmd = command('run',
  flag('--storage|-s [path]', 'storage path, defaults to ./rpc-discovery'),
  flag('--scraper-public-key [scraper-public-key]', 'Public key of a dht-prometheus scraper'),
  flag('--scraper-secret [scraper-secret]', 'Secret of the dht-prometheus scraper'),
  flag('--scraper-alias [scraper-alias]', '(optional) Alias with which to register to the scraper'),

  async function ({ flags }) {
    const storage = flags.storage || 'rpc-discovery'

    const logger = pino()

    const store = new Corestore(storage)
    await store.ready()

    const swarm = new Hyperswarm(
      { keyPair: await store.createKeyPair('public-key') }
    )
    swarm.on('connection', (conn, peerInfo) => {
      const key = IdEnc.normalize(peerInfo.publicKey)
      logger.info(`Opened connection to ${key}`)
      conn.on('close', () => logger.info(`Closed connection to ${key}`))
    })

    let instrumentation = null
    if (flags.scraperPublicKey) {
      logger.info('Setting up instrumentation')

      const scraperPublicKey = IdEnc.decode(flags.scraperPublicKey)
      const scraperSecret = IdEnc.decode(flags.scraperSecret)
      const prometheusServiceName = 'rpc-discovery'

      let prometheusAlias = flags.scraperAlias
      if (prometheusAlias && prometheusAlias.length > 99) throw new Error('The Prometheus alias must have length less than 100')
      if (!prometheusAlias) {
        prometheusAlias = `rpc-discovery-${IdEnc.normalize(swarm.keyPair.publicKey)}`.slice(0, 99)
      }

      instrumentation = new HyperInstrumentation({
        swarm,
        corestore: store,
        scraperPublicKey,
        prometheusAlias,
        scraperSecret,
        prometheusServiceName
      })

      instrumentation.registerLogger(logger)
    }

    const service = new RpcDiscovery(
      store.namespace('rpc-discovery'), swarm
    )

    goodbye(async () => {
      logger.info('Shutting down RPC-discovery service')
      if (instrumentation) await instrumentation.close()
      await swarm.destroy()
      await service.close()
    })

    if (instrumentation) await instrumentation.ready()

    logger.info('Starting RPC-discovery service')
    await service.ready()

    swarm.join(service.base.discoveryKey)
    swarm.join(service.dbDiscoveryKey)

    logger.info(`Autobase key: ${IdEnc.normalize(service.base.key)}`)
    logger.info(`Name-service database key: ${IdEnc.normalize(service.dbKey)}`)
    logger.info(`RPC server public key: ${IdEnc.normalize(service.serverPublicKey)}`)
  }
)

const cmd = command('rpc-discovery', runCmd)

cmd.parse()
