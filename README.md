# Autobase Discovery

Automatic service discovery with self-registering services, using [autobase](https://github.com/holepunchto/autobase). Works well with [protomux-rpc](https://github.com/holepunchto/protomux-rpc) services.

Clients discover the RPC services by querying the autodiscovery's [hyperdb](https://github.com/holepunchto/hyperdb), which is an autobase view.

## Install

```
npm i autobase-discovery
```

## Usage

### Security

Autodiscovery uses a simple security model, taking advantage of the authentication mechanism of HyperDHT.

All clients who wish to register to the autodiscovery service know a shared secret seed (64 bytes). This seed is passed to the autodiscovery clients, which deterministically generate a DHT keyPair. This keyPair is then used to open a connection to the autodiscovery RPC server.

The autodiscovery service is passed the public key corresponding to the secret seed upon startup, and only sets up the RPC endpoints for peers with that public key.

The security relies on HyperDHT fully opening a connection only after the server verified that the client knows the secret key corresponding to its public key.

Note: to check which public key corresponds to a seed, run:
```
HyperDHT.keyPair(Buffer.from(seed, 'hex')).publicKey.toString('hex')
```

(assuming `seed` is in hexadecimal notation)

### Server

```
autodiscovery run <rpc-allowed-public-key>
```

Where `rpc-allowed-public-key` is the public key corresponding to the clients' seed (see the 'Security' section above).

The RPC server's public key and the database key will be printed.

Logs are in pino's JSON format. Pipe them to `pino-pretty` for a human-readable format (`autodiscovery run | pino-pretty`)

Note that the database key is updated every time a new indexer is processed. In particular, you should add at least one entry to the database to stabilise the database key for the initial indexer.

### Client

See [example.js](example.js) for the programmatic way of self-registering a service instance.

See [client/bin.js](client/bin.js) for the programmatic way of listing the available service instances.

Alternatively, use the CLI:

```
autodiscovery-client list <autodiscovery database key> <service-name>
```
