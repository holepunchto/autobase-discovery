const Hyperswarm = require('hyperswarm')
const IdEnc = require('hypercore-id-encoding')
const RegisterClient = require('./client/register')

async function main () {
  const rpcServerKey = '<Enter autodiscovery RPC-server public key here>'
  const accessSeed = '<Enter autodiscovery access seed here>'

  const swarm = new Hyperswarm()
  await swarm.listen()
  const myServerKey = swarm.keyPair.publicKey

  const client = new RegisterClient(rpcServerKey, swarm.dht, accessSeed)
  console.log(`Registering service ${IdEnc.normalize(myServerKey)}...`)
  await client.putService(myServerKey, 'my-service-name')
  console.log(`Registered ${IdEnc.normalize(myServerKey)}`)

  await client.close()
  await swarm.destroy()
}

main()
