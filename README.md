# Project Hub

See which project needs you: connected stacks, GitHub issues, deployments, AI chat activity, and subscription renewals in one private hub.

**Self-hosted alpha.** Each installation belongs to one person. Start locally with no accounts, or deploy your own private cloud copy. This is not a shared multi-user service.

## Try it in three commands

Install [Node.js 24 LTS or newer](https://nodejs.org/en/download), download this repository's source ZIP (or clone your fork), then open a terminal in the extracted folder:

```sh
npm ci
npm run setup
npm run demo
```

Open **http://127.0.0.1:3008**. The demo contains fictional projects and one example subscription. Provider requests and chat reading are disabled. Stop with **Ctrl+C**.

To start your own empty hub, run **`npm start`** and open **http://127.0.0.1:3007**. Select **Add project**, paste the absolute path to `examples/notes-app` inside this checkout, and preview its detected stack. Then add your own project folder or GitHub repository. Demo data and your hub use separate data folders.

## What works

| Feature | Connection | Freshness / limit |
| --- | --- | --- |
| Connected stack map | Local manifests or GitHub | Detected dependencies, not runtime health |
| Issues, pull requests, Actions | GitHub CLI or token | 30-second refresh while visible |
| Deployments | Vercel token; optional cloud events | Polling, or signed events with 10-second display refresh |
| Codex and T3 chat titles/activity | Optional local reader or Mac sync | 10-second refresh; offline after 45 seconds |
| Subscription amounts and due dates | Manual entry | Saved locally or to your own cloud database |

Chat content remains in its original app. Codex activity means “active recently,” not proof a task is running. T3 titles can be copied; remote chat execution is not included. Chat readers depend on the installed apps' SQLite schemas and may need updates after those apps change.

## Connect your projects

For local GitHub access, install the [GitHub CLI](https://cli.github.com/) and run `gh auth login`, or set `HUB_GITHUB_TOKEN` in your private `.env.local`. Use a fine-grained token limited to selected repositories, with read access to Metadata, Contents, Issues, Pull requests, and Actions. Then use **Add project → Choose from GitHub**.

For Vercel, set `HUB_VERCEL_TOKEN` in `.env.local`, restart the server, then use **Connections → Choose Vercel project**. Existing Vercel CLI credentials are also supported. Provider credentials are used server-side, never bundled into the frontend.

Local folders default to this checkout, `~/Desktop`, `~/Documents`, `~/dev`, and `~/Developer`. For another location, set `HUB_PROJECT_ROOTS` in `.env.local` to allowed folders separated by `:` on macOS/Linux. The scanner reads manifests; it never installs dependencies or executes project scripts.

Chat reading is **off by default**. On your Mac, set `HUB_ENABLE_CHATS=1` in `.env.local` and restart. Only chats matched to linked projects are included. To include other recent chats too, explicitly set `HUB_INCLUDE_UNASSIGNED_CHATS=1`. See [privacy and data flow](docs/privacy.md).

## Open it from another device

Follow the [private cloud setup guide](docs/cloud.md) for Vercel + Neon Postgres + Neon Auth. You supply your own accounts, HTTPS domain, owner email, and secrets. Hosting/email providers may charge for usage. No services are provisioned by local setup.

The local server binds to loopback and has no user login: do not expose it to the internet or a shared network. Use the authenticated cloud deployment for access from a phone or another computer.

## Development and help

```sh
npm test
npm run build
npm run doctor
npm run release:check
```

Local app and Mac sync are tested on macOS; CI is configured to check the Node core on Linux and macOS. Windows is not yet a supported/tested installation target. No analytics or telemetry are included.

- [Troubleshooting](docs/troubleshooting.md)
- [Contributing](CONTRIBUTING.md) and [security reporting](SECURITY.md)
- [Roadmap](docs/roadmap.md) and [architecture](docs/architecture.md)
- [MIT license](LICENSE); dependency notices stay with their packages
- [Release checklist](docs/releasing.md) and [changelog](CHANGELOG.md)
