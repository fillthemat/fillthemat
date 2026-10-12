# Production runtime logs

`bun run logs:prod` is read-only Vercel logs retrieval, fixed to project `prj_LMCslFWBFnxPN3ISKqidTBp3kIA7`, team `fillthemat`, and Production. It never deploys, migrates, or reproduces requests. The versioned CLI runs on demand without a devDependency; network access and authorized CLI credentials are required.

```bash
bun run logs:prod --since 1h --status-code 5xx
bun run logs:prod --since 2026-10-11T17:59:00Z --until 2026-10-11T18:02:00Z --request-id gnktd-1791741629602-003823914326
bun run logs:prod --since 1h --query "booking error" --limit 20
bun run logs:prod --help
```

The wrapper accepts only `--since`, `--until`, `--request-id`, `--status-code`, `--query`, `--limit` and standalone `--help`. Values go directly to Vercel: relative or ISO windows, platform request IDs, HTTP status filters and text/query searches. Use `--query` for an application support reference. No custom parsing or local filtering; CLI defaults and retention apply. Empty results do not prove no incident; narrow windows if the result limit is reached.

If authentication fails, stop and ask an authorized human to run `bun run vercel login`, then verify `bun run vercel whoami` and retry. Never read or print credential files or tokens, change production settings, or pull production environment files.

Stdout and stderr receive a best-effort regex pass for emails, common phone formats, bearer/JWT/API tokens and cookies. Other sensitive prose (names, addresses, SQL parameters, message bodies, unknown secret formats) can remain: review and minimize every excerpt before sharing. Raw output stays in memory; never commit downloaded logs. Nonzero exits are failures, not empty results.
