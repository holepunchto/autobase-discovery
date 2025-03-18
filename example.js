const Hyperswarm = require('hyperswarm')
const IdEnc = require('hypercore-id-encoding')
const RegisterClient = require('./client/register')

async function main () {
  const rpcServerKey = 'e7pr459mhuomz7dzoh4hx3mcb6q5ng1ixar5ayzjjbwohf1pu88o'
  const swarm = new Hyperswarm()
  await swarm.listen()
  const myServerKey = swarm.keyPair.publicKey

  const client = new RegisterClient(rpcServerKey, swarm.dht)
  console.log(`Registering service ${IdEnc.normalize(myServerKey)}...`)
  await client.putService(myServerKey)
  console.log(`Registered ${IdEnc.normalize(myServerKey)}`)

  await client.close()
  await swarm.destroy()
}

main()
