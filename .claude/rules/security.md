# Security Rules

- No secret values in source, fixtures, logs, screenshots, or documentation.
- Enforce tenant isolation on every repository/query path.
- Validate file type by content, size, extension, malware scan result, and authorization.
- Mask or minimize personal information in UI, logs, exports, and provider requests.
- Use least privilege for DB, storage, provider tokens, and Claude Code permissions.
- Production deployment and credential changes always require explicit human approval.
