const Hyperswarm = require('hyperswarm')
const IdEnc = require('hypercore-id-encoding')
const RegisterClient = require('./client/register')

async function main () {
  const rpcServerKey = 'b8asa95odn8obnzewke6kfy6jfnqew8s3ktwo1do8hk78gi77h5o'
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
