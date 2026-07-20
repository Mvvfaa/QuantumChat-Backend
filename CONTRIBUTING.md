# Contributing to QuantumChat Backend

Thanks for contributing to the QuantumChat API and real-time relay.

## Before you start

1. Read the product rules in the meta repo: [`docs/REQUIREMENTS.md`](https://github.com/QuantumLogicsLabs/QuantumChat/blob/main/docs/REQUIREMENTS.md).
2. Follow the [Code of Conduct](CODE_OF_CONDUCT.md).
3. For vulnerabilities, use [SECURITY.md](SECURITY.md) — never file a public issue.

## Development setup

```bash
npm ci
cp .env.example .env   # set MONGODB_URI and JWT_SECRET
npm run dev            # http://localhost:5000
```

## Security checks (required)

A failing security suite is a **merge blocker**:

```bash
npm run test:security
```

Useful lanes:

- `npm run test:security:crypto`
- `npm run test:security:x5`
- `npm run test:security:auth`
- `npm run test:security:api`
- `npm run test:security:socket`

See [README.md](README.md) and [`.github/BRANCH_PROTECTION.md`](.github/BRANCH_PROTECTION.md).

## Pull requests

1. Keep PRs focused (one concern per PR when practical).
2. Do not weaken E2E X5 invariants (server must not need plaintext for chat content).
3. Add or update security tests when changing crypto, auth, or authorization surfaces.
4. Fill out the pull request template.
5. Ensure GitHub Actions required checks pass.

## License

By contributing, you agree that your contributions are licensed under the
[MIT License](LICENSE).
