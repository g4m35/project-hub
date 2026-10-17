# Contributing

Start with the README's local setup or fictional demo. Use Node.js 24 or newer. Changes should solve one concrete problem and include a short before/after explanation.

1. Open an issue describing the problem and expected behavior. Use demo data and redact private names and credentials.
2. Fork the repository and create a branch for the change.
3. Run `npm ci`, `npm test`, `npm run build`, and `npm run release:check`.
4. For interface changes, check desktop and a 390px phone viewport, keyboard navigation and reduced motion. Screenshots must contain synthetic data.
5. Open a pull request with the change, verification results and remaining limitations.

Never include environment files, real project exports, chat databases, provider tokens, private screenshots or logs. Keep APIs read-only toward GitHub/Vercel unless a new permission is deliberately designed and documented. Test meaningful behavior with disposable fixtures; never mutate real user chats or subscriptions in tests.

Contributions are under the repository's MIT license. Be respectful, describe evidence, and avoid personal attacks. Maintainers may close abusive or off-topic discussions. Report security issues privately using SECURITY.md.
