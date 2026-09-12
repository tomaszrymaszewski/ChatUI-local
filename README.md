# ChatUI

A local-first desktop AI client with two halves in one app: a chat interface
that talks to any OpenAI-compatible model provider, and an agent mode that
runs multi-step tasks through a local OpenCode server.

Free and open source, MIT licensed.

## Features

- Chat with any OpenAI-compatible provider (bring your own API key/endpoint)
- Agent mode for autonomous tasks via a local OpenCode server, which the app spawns and manages itself
- Native desktop app for macOS and Windows (built with Tauri)

## Install

Download a prebuilt release for your platform from the
[Releases page](https://github.com/tomaszrymaszewski/ChatUI-local/releases/latest).

### Build from source

Requirements: Node.js, the Rust toolchain, and Tauri's platform prerequisites
(see the [Tauri prerequisites guide](https://v2.tauri.app/start/prerequisites/)).

```bash
npm install
npm run tauri dev   # full desktop app
# or
npm run dev          # web-only preview in the browser
```

## Usage

Launch the app, add a provider (API key + endpoint) under Settings, and start
chatting. Switch to Agent mode to run tasks against a local OpenCode server.

## Contributing

Contributions are welcome — see [CONTRIBUTING.md](./CONTRIBUTING.md) for how
to file issues and submit pull requests.

## Security

To report a vulnerability privately, see [SECURITY.md](./SECURITY.md).

## Docs

- Tauri: https://v2.tauri.app

## License

MIT — see [LICENSE](./LICENSE).
