# Security Policy

## Supported versions

| Version | Supported |
| ------- | --------- |
| `main` (latest) | Yes |

## Reporting a vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Use [GitHub Private Vulnerability Reporting](https://github.com/QuantumLogicsLabs/QuantumChat-Backend/security/advisories/new) on this repository.

Include:

- Affected endpoints, events, or components
- Reproduction steps and expected vs actual behavior
- Impact (confidentiality / integrity / availability)
- PoC only when it stays non-destructive

### What to expect

- Acknowledgement when maintainers triage the report
- Coordination on fix and disclosure timing
- Credit when appropriate and desired

## In scope

- Auth bypass, JWT misuse, rate-limit evasion with security impact
- IDOR / privilege escalation
- Injection (NoSQL, path traversal, unsafe deserialization)
- E2E / X5 regressions (server storing or notifying plaintext chat content)
- Broken sealed call signaling, story envelopes, or push blindness
- Secrets leakage in logs, artifacts, or CI

## Out of scope

- Lost client keyrings / `keys.txt`
- Compromised user devices
- Pure DoS without a practical, actionable exploit
- Issues solely in Frontend or QuantumAI (report to those repos)

## Safe harbor

Good-faith research that follows this policy and avoids privacy abuse or destructive
testing will not be pursued legally by the maintainers.
