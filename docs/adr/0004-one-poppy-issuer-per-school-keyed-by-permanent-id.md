---
status: accepted
---

# One Poppy issuer per school, keyed by its permanent id

Under Personal Agent Protocol (Poppy), a Company is identified by its OAuth issuer: domains that share an issuer are one Company, and a personal agent's user IDs, sessions, and account tokens are scoped to that issuer. So each school gets its own issuer, at a fixed path on one shared auth host, `https://auth.fillthemat.com/schools/<schoolId>`, using the school's permanent id. A single Fillthemat-wide issuer would merge every school into one Company. A slug in the issuer would turn a school rename into a new Company and orphan every agent's user IDs. A separate auth host per school would add DNS and certificate work for no protocol benefit. The same permanent id goes in the platform discovery URL that each school's own domain redirects `/.well-known/poppy.json` to, because that redirect lives on a website we don't control and can't be updated when a slug changes.

## Consequences

- Changing a school's issuer is effectively turning it into a new Company. Never derive the issuer from anything mutable.
- Issuer metadata must follow RFC 8414 path placement (`/.well-known/oauth-authorization-server/schools/<schoolId>`), not the OIDC suffix convention, and its `poppy_domains` lists only that school's verified domains.
- Every Poppy endpoint is tenant-scoped by issuer path, and tokens, sessions, and replay records must be checked against the school they were issued for, even though the infrastructure is shared.
