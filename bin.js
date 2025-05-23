#!/usr/bin/env node

const Corestore = require('corestore')
const IdEnc = require('hypercore-id-encoding')
const Hyperswarm = require('hyperswarm')
const goodbye = require('graceful-goodbye')
const { command, flag, arg } = require('paparam')
const HyperInstrumentation = require('hyper-instrument')
const pino = require('pino')

const Autodiscovery = require('.')

const runCmd = command('run',
  arg('<rpcAllowedPublicKey>', 'public key of peers that are allowed to send requests over RPC (in hex or z32 format)'),
  flag('--storage|-s [path]', 'storage path, defaults to ./autodiscovery'),
  flag('--scraper-public-key [scraper-public-key]', 'Public key of a dht-prometheus scraper'),
  flag('--scraper-secret [scraper-secret]', 'Secret of the dht-prometheus scraper'),
  flag('--scraper-alias [scraper-alias]', '(optional) Alias with which to register to the scraper'),

  async function ({ flags, args }) {
    const storage = flags.storage || 'autodiscovery'
    const rpcAllowedPublicKey = IdEnc.decode(args.rpcAllowedPublicKey)
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
      const prometheusServiceName = 'autodiscovery'

      let prometheusAlias = flags.scraperAlias
      if (prometheusAlias && prometheusAlias.length > 99) throw new Error('The Prometheus alias must have length less than 100')
      if (!prometheusAlias) {
        prometheusAlias = `autodiscovery-${IdEnc.normalize(swarm.keyPair.publicKey)}`.slice(0, 99)
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

    const service = new Autodiscovery(
      store.namespace('autodiscovery'), swarm, rpcAllowedPublicKey
    )
    service.on('rpc-session', () => {
      logger.info('Opened RPC session')
    })

    goodbye(async () => {
      logger.info('Shutting down autodiscovery service')
      if (instrumentation) await instrumentation.close()
      await swarm.destroy()
      await service.close()
    })

    if (instrumentation) await instrumentation.ready()

    logger.info('Starting autodiscovery service')
    await service.ready()

    swarm.join(service.base.discoveryKey)
    swarm.join(service.dbDiscoveryKey)

    logger.info(`DB version: ${service.view.db.core.length}`)
    logger.info(`Autobase key: ${IdEnc.normalize(service.base.key)}`)
    logger.info(`Name-service database key: ${IdEnc.normalize(service.dbKey)}`)
    logger.info(`RPC server public key: ${IdEnc.normalize(service.serverPublicKey)}`)
    logger.info(`Accepting RPC connections from public key ${IdEnc.normalize(rpcAllowedPublicKey)}`)
  }
)

const cmd = command('autodiscovery', runCmd)

cmd.parse()
