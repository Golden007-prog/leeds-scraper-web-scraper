# Security Policy

## Supported versions

Security fixes go to the latest release on `main`.

## Reporting a vulnerability

Please **do not open a public issue**. Report it privately through [GitHub private vulnerability reporting](https://github.com/KritishX/leeds-harvester-web-scraper/security/advisories/new), and include:

- the affected file or endpoint and the version or commit;
- the steps or input that reproduce it on a local install;
- what an attacker gains (for example, reaching a private address through the crawler).

Expect an acknowledgement within a few days. Once a fix is released, you'll be credited unless you prefer otherwise.

## Scope

Leeds Harvester is designed to run on your own machine with no sign-in. The intended boundaries are described in [docs/security-model.md](docs/security-model.md). In particular, other users or processes on the same machine being able to use the local API is a documented limitation, not a vulnerability. Reports that break the documented boundaries are very welcome, for example:

- the crawler reaching private or loopback addresses;
- another website changing data through the browser;
- DNS rebinding;
- the limits failing to bound memory or CPU.

Test only against your own local install. Do not test against websites or services you don't own.
