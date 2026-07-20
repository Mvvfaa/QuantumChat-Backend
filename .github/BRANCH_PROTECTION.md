# Required checks for `main`

Configure repository branch protection to require:

## Security and Vulnerability Detection System (L0–L4)

- Static Analysis
- Crypto Confidentiality
- Auth Abuse
- API Vuln Detection
- Transport Hardening
- Security Canary (must fail)
- E2E Ciphertext Confidentiality (must not decode)
- E2E X5 Invariants
- Socket Auth Security

## Supply chain (required)

- Dependency Review *(pull requests — npm audit high+)*
- Gitleaks

## Legacy / umbrella (recommended)

- Security Attack Suite
- Crypto Algorithms
- Backend Build

Require the branch to be up to date and disable administrator bypass.

## Not required for merge (scheduled / informational)

- Deep Fuzz and Stress (`security-nightly.yml`)
- OpenSSF Scorecard (`ossf-scorecard.yml`)
- SBOM (`sbom.yml`)

## External checks (not controlled by this repo)

- **Vercel** — “Authorization required to deploy” needs a team admin to open the
  Vercel authorize link on the PR (or reconnect the GitHub integration). It is not
  a backend code or security-suite failure.
