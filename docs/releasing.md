# Publishing a release

Use a dedicated public repository for the sanitized source. Do not publish a working installation or change the visibility of a repository containing private history.

1. Run `npm ci`, `npm test`, `npm run setup`, `npm run doctor`, `npm run build:cloud`, `npm audit`, and `npm run release:check`.
2. Review `git diff --cached` and scan both files and history with Gitleaks (`gitleaks dir . --redact` and `gitleaks git . --redact`). `.gitignore` does not remove an already tracked secret. Rotate an exposed credential before rewriting history.
3. Test the source archive in a fresh directory: install, run the demo, stop it, start an empty hub, then explicitly import the example folder. Verify cloud email delivery on the target installation separately.
4. Before opening the repository, enable GitHub private vulnerability reporting and secret scanning/push protection where available. Configure a branch rule requiring the Checks workflow. Keep production deployment secrets out of this repository's Actions workflows.
5. Publish an alpha tag and release notes with known limits. Build the download from `git archive` so local configuration, databases, dependency folders and private review evidence are excluded.

The first release is intended for a small self-hosting alpha. Cloud service provisioning, authentication/email delivery, database backups and provider costs remain the operator's responsibility. Windows and shared multi-user hosting are not supported in this release.
