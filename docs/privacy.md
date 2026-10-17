# Privacy and data flow

Project Hub contains no analytics, tracking pixels, third-party fonts, or telemetry. Your installation starts empty. Demo projects and costs are fictional and never represent live provider status.

| Data | Local installation | Private cloud installation |
| --- | --- | --- |
| Projects, detected stack, subscriptions | `.data/hub.json` (or your configured data directory) | Your Neon database |
| Provider credentials | Your environment or existing CLI login | Encrypted server-side using the session secret |
| Chat titles, IDs, app, time, activity | Read only after explicit opt-in | Sent to your hub only after installing Mac sync |
| Chat transcripts | Never uploaded; small local log tails are read for event types when chat reading is enabled | Not stored |
| Local paths and manifests | Read for explicit folder scans and local project matching | Not sent by chat sync |

Github/Vercel requests go to those providers to retrieve the data you connect. The cloud sign-in sends owner email and verification code to your configured Neon Auth service. Hosting and database providers may retain their own operational logs under their policies.

Chat titles may derive from the first line of a prompt when an app has no custom title. Review what is visible in the local Chats view before enabling remote sync. Only matched project chats are included by default; all-chats inclusion is a separate opt-in. The app databases are opened read-only and no chat messages are sent.

To stop local chat reads, set `HUB_ENABLE_CHATS=0` and restart. To stop remote uploads, run `npm run sync:stop`. Previously uploaded metadata remains in your private database; stopping the uploader is not deletion. If you need deletion, remove the `live:chats` row from `hub_cache` in your own database after stopping sync.

Back up your private data directory or Neon database. Never upload `.env*` files with real values, `.data`, sync configs, webhook receipts, database dumps, or screenshots of private project/chat names. Public bug reports should use the fictional demo.
