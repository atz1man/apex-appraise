# Custom domain — 5-minute wire-up

**Apex Appraise runs on Fly.io.** That is the live production host, not a plan
or an option: two apps in `lhr` (London) —

| app | role |
|---|---|
| `apex-appraise-web` | the front door, and the only one on the public internet — serves the built React app and proxies `/trpc`, `/uploads`, `/reports`, `/webhooks` |
| `apex-appraise-api` | Fastify + tRPC, **flycast-only**: reachable from the web app over Fly's private network and from nowhere else |

It serves today at https://apex-appraise-web.fly.dev.

Both apps set `auto_stop_machines = "stop"` **and** `min_machines_running = 1`,
so extra machines stop under low load but one stays up — they do **not** scale
to zero, and there is no cold start on the first request. That is deliberate on
the API and `fly.api.toml` says why: "login throttling and Stripe webhooks want
a warm machine". Rate-limit counters live in the process, and a webhook arriving
at a stopped machine is a payment confirmation waiting on a boot.

It is also the whole of the compute bill, since a machine that never stops is
billed around the clock. Dropping either app to `min_machines_running = 0` is
the one lever that changes that materially, and it is a real trade rather than a
saving: see the sentence above for what the API gives up. The web app has less
to lose, holding no state — it costs a cold start on the first request after
idle.

| | web | api |
|---|---|---|
| size | `shared-cpu-1x` | `shared-cpu-1x` |
| memory | 256mb | 1gb |
| always-on | yes (`min_machines_running = 1`) | yes (`min_machines_running = 1`) |
| volume | — | `uploads`, 3gb |

Postgres is a third app, `apex-appraise-db`, created separately (see
[`DEPLOY.md`](DEPLOY.md)) and billed as its own machine plus its own volume.

Configuration lives in [`fly.api.toml`](fly.api.toml) and
[`fly.web.toml`](fly.web.toml); how to deploy is in [`DEPLOY.md`](DEPLOY.md).

Once a domain is owned (e.g. `apexappraise.co.uk`), pointing the live app at it
takes one cert command and two DNS records.

## 1. Issue the certificate

```bash
fly certs add app.apexappraise.co.uk -a apex-appraise-web
# or the apex domain itself:
fly certs add apexappraise.co.uk -a apex-appraise-web
```

The command prints the DNS records Fly needs. Typically:

## 2. DNS records (at the registrar)

| Type  | Name  | Value |
|-------|-------|-------|
| CNAME | `app` | `apex-appraise-web.fly.dev.` |
| — or for the apex domain — | | |
| A     | `@`   | Fly's IPv4 (shown by `fly ips list -a apex-appraise-web`) |
| AAAA  | `@`   | Fly's IPv6 (same command) |

Plus the ACME challenge record `fly certs add` prints (one-time, for issuance).
Check status with `fly certs show <domain> -a apex-appraise-web` — usually
verified within minutes.

## 3. Flip the app URLs

The API bakes the public URL into email links and the PDF renderer target:

```bash
# infra/fly.api.toml [env] — update both, then redeploy the api:
#   APP_URL = "https://app.apexappraise.co.uk"
#   WEB_URL = "https://app.apexappraise.co.uk"
flyctl deploy -c infra/fly.api.toml --yes
```

Also update the hardcoded share/OG URLs if the domain should appear there:
`apps/web/index.html` (og:url if present) and any copy referencing fly.dev.

## 4. Checklist after flip

- [ ] `curl -sSI https://app.apexappraise.co.uk/login` → 200, valid cert
- [ ] Login + hub loads on the new domain
- [ ] PDF report renders (exercises WEB_URL)
- [ ] Stripe webhook endpoint updated in the Stripe dashboard (when live keys exist)
- [ ] GitHub Action demo-reset.yml: update the curl URL to the new domain
- [ ] fly.dev URL keeps working (Fly serves both) — optionally add a redirect later
