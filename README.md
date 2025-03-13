# RPC Discovery

Discovery of RPC services using [autobase](https://github.com/holepunchto/autobase) and [protomux-rpc](https://github.com/holepunchto/protomux-rpc).

The RPC services self-register to the discovery service. Clients discover them by querying the discovery service's [hyperdb](https://github.com/holepunchto/hyperdb), which is an autobase view.
