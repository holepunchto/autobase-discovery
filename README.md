# RPC Discovery

Automatic service discovery with self-registering services, using [autobase](https://github.com/holepunchto/autobase). Works will with [protomux-rpc](https://github.com/holepunchto/protomux-rpc) services.

Clients discover the RPC services by querying the autodiscovery's [hyperdb](https://github.com/holepunchto/hyperdb), which is an autobase view.

## Install

```
npm i autodiscovery
```

## Usage

### Server

```
autodiscovery run
```

The RPC server's public key and the database key will be printed.

Logs are in pino's JSON format. Pipe them to `pino-pretty` for a human-readable format (`autodiscovery run | pino-pretty`)

Note that the database key is updated every time a new indexer is processed. In particular, you should add at least one entry to the database to stabilise the database key for the initial indexer.

### Client

See [example.js](example.js) for the programmatic way of self-registering a service instance.

See [client/bin.js](client/bin.js) for the programmatic way of listing the available service instances.

Alternatively, use the CLI:

```
autodiscovery-client list <autodiscovery database key>
```
