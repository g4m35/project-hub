# Troubleshooting

Run `npm run doctor` first. It checks Node, installed dependencies, the frontend build and local storage without printing credentials.

| Symptom | Fix |
| --- | --- |
| `node:sqlite` missing or syntax/engine errors | Install Node.js 24 or newer; `nvm use` reads `.nvmrc` if you use nvm |
| `vite` missing | Run `npm ci`, then `npm run setup` |
| Page not found / no `dist` directory | Run `npm run setup` before `npm start` |
| Port already in use | Stop the other hub terminal or change `PORT` in `.env.local`; demo defaults to 3008 |
| Folder refused | Use an absolute path under an allowed root; set `HUB_PROJECT_ROOTS` in `.env.local` and restart |
| GitHub list empty | Check your token's selected repositories and read permissions, or run `gh auth status` |
| Vercel unavailable | Set a current `HUB_VERCEL_TOKEN`; for cloud events also check `HUB_TEAM_ID` |
| Chats say unconnected | Local: opt in with `HUB_ENABLE_CHATS=1`. Cloud: install the Mac sync from `docs/cloud.md` |
| Chats missing after an app update | The read-only adapter may not support the new database schema; report app/OS versions, never your database |
| Cloud sign-in code missing | Check the Neon OTP plugin, trusted domain and sender/email provider; use the newest code |
| Normal hub opens a sign-in screen locally | The last build was cloud mode. Run `npm run setup` to rebuild local mode |

Local and cloud are separate installations. Changes do not automatically sync between their project/subscription lists. The cloud Mac bridge syncs chat metadata only.

To back up local data, stop the server and copy `.data/hub.json` to a private location. Reinstalling dependencies or rerunning setup does not overwrite it. The demo has its own `.data/demo/hub.json`.
