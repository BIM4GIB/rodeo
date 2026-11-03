# Security

Please report security problems privately, not in a public issue. Use
**Report a vulnerability** on this repository's Security tab (GitHub's
private vulnerability reporting). Say what is affected, how to reproduce it,
and what an attacker could do with it.

We aim to reply within a week. Once a fix is live on
[rodeo.build](https://rodeo.build), the advisory is published with credit to
you, unless you'd rather stay anonymous.

## Scope

- The editor (`web/`): above all, files that run code or reach the network
  when opened. That covers drawings, imports, plug-ins and scripts.
- The server (`server/`): accounts and sign-in, sharing and cloud drawings,
  collaboration, billing and AI credit, and the admin page.
- The hosted service at rodeo.build.

Please don't test against other people's accounts or drawings, run denial of
service tests, or send automated scans at rodeo.build. Run your own server
(see [docs/SETUP.md](docs/SETUP.md)) to probe it as hard as you like.
