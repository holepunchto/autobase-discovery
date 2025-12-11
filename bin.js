#!/usr/bin/env node

const Corestore = require('corestore')
const IdEnc = require('hypercore-id-encoding')
const Hyperswarm = require('hyperswarm')
const goodbye = require('graceful-goodbye')
const { command, flag, arg } = require('paparam')
const HyperInstrumentation = require('hyper-instrument')
const pino = require('pino')
const path = require('path')
const ProtomuxRPCRouter = require('protomux-rpc-router')
const defaultMiddleware = require('protomux-rpc-middleware')

const { version: ownVersion } = require('./package.json')
const Autodiscovery = require('.')

const runCmd = command('run',
  arg('<rpcAllowedPublicKey>', 'public key of peers that are allowed to send requests over RPC (in hex or z32 format)'),
  flag('--storage|-s [path]', 'storage path, defaults to ./autodiscovery'),
  flag('--scraper-public-key [scraper-public-key]', 'Public key of a dht-prometheus scraper'),
  flag('--scraper-secret [scraper-secret]', 'Secret of the dht-prometheus scraper'),
  flag('--scraper-alias [scraper-alias]', '(optional) Alias with which to register to the scraper'),
  flag('--bootstrap [bootstrap]', '(for tests) Bootstrap DHT node to use, in format <host>:<port> (e.g. 127.0.0.1:10000)'),
  flag('--rate-limit-capacity [rate-limit-capacity]', '(optional) Rate limit bucket capacity for RPC requests'),
  flag('--rate-limit-interval-ms [rate-limit-interval-ms]', '(optional) Rate limit refill interval in milliseconds'),
  flag('--concurrent-limit-capacity [concurrent-limit-capacity]', '(optional) Concurrent limit capacity for RPC requests'),

  async function ({ flags, args }) {
    const logger = pino({ name: 'autobase-discovery' })
    const storage = path.resolve(flags.storage || 'autodiscovery')
    const rpcAllowedPublicKey = IdEnc.decode(args.rpcAllowedPublicKey)
    let bootstrap = null
    if (flags.bootstrap) {
      const [host, port] = flags.bootstrap.split(':')
      bootstrap = [{ port: parseInt(port), host }]
      logger.warn(`Using non-standard bootstrap: ${bootstrap[0].host}:${bootstrap[0].port}`)
    }

    const rateLimitCapacity = flags.rateLimitCapacity ? parseInt(flags.rateLimitCapacity) : 10
    const rateLimitIntervalMs = flags.rateLimitIntervalMs ? parseInt(flags.rateLimitIntervalMs) : 100
    const concurrentLimitCapacity = flags.concurrentLimitCapacity ? parseInt(flags.concurrentLimitCapacity) : 16

    logger.info(`Using storage: ${storage}`)
    const store = new Corestore(storage)
    await store.ready()

    const swarm = new Hyperswarm(
      { keyPair: await store.createKeyPair('public-key'), bootstrap }
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
        prometheusServiceName,
        version: ownVersion
      })

      instrumentation.registerLogger(logger)
    }

    const router = new ProtomuxRPCRouter()
    router.use(defaultMiddleware({
      logger: {
        instance: logger
      },
      rateLimit: { capacity: rateLimitCapacity, intervalMs: rateLimitIntervalMs },
      concurrentLimit: { capacity: concurrentLimitCapacity }
    }))
    if (instrumentation) {
      router.registerMetrics(instrumentation.promClient)
    }
    const service = new Autodiscovery(
      store.namespace('autodiscovery'),
      swarm,
      rpcAllowedPublicKey,
      router
    )
    service.on('rpc-session', () => {
      logger.info('Opened RPC session')
    })

    goodbye(async () => {
      logger.info('Shutting down autodiscovery service')
      if (instrumentation) await instrumentation.close()
      await swarm.destroy()
      await service.close()
      await router.close()
    })

    if (instrumentation) await instrumentation.ready()

    logger.info('Starting autodiscovery service')
    await service.ready()

    swarm.join(service.base.discoveryKey)
    swarm.join(service.dbDiscoveryKey, { client: true, server: true }) // Note: needs client: true when being replicated by a blind-peer

    logger.info(`DB version: ${service.view.db.core.length}`)
    logger.info(`Autobase key: ${IdEnc.normalize(service.base.key)}`)
    logger.info(`Name-service database key: ${IdEnc.normalize(service.dbKey)}`)
    logger.info(`RPC server public key: ${IdEnc.normalize(service.serverPublicKey)}`)
    logger.info(`Accepting RPC connections from public key ${IdEnc.normalize(rpcAllowedPublicKey)}`)
  }
)

const cmd = command('autodiscovery', runCmd)

cmd.parse()
