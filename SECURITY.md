# Security

This is an alpha, not an independently certified security product. The latest alpha is the supported line. Each deployed instance is private to one owner; it must not be adapted into a shared service by disabling the owner check.

For vulnerabilities, use the repository's **Security → Report a vulnerability** private reporting flow when enabled. Do not publish credentials, exploit details affecting live installations, private logs or personal project data in public issues. If private reporting is unavailable, open a minimal issue asking a maintainer to enable it without including sensitive details.

Reports should include the affected version, reproducible steps using synthetic data, expected impact and any suggested mitigation. There is no guaranteed response SLA during alpha.

Local HTTP is loopback-only and has no login. Do not tunnel it publicly. For remote use, follow docs/cloud.md. Cloud credentials belong only in server environment variables or the encrypted credential store. Back up the session secret privately; rotating it requires reconnecting encrypted integrations. Use separate credentials and databases for production and development.

Before publishing changes, run tests, `npm audit`, the release check and a secret scanner such as Gitleaks over files and Git history. These checks reduce risk; they do not prove the absence of vulnerabilities.
