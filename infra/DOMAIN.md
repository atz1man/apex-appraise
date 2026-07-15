# Custom domain — 5-minute wire-up

Once a domain is owned (e.g. `apexappraise.co.uk`), pointing the live app at it
takes one cert command and two DNS records. The app currently serves at
https://apex-appraise-web.fly.dev.

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
