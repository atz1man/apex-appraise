# Standing up a demo instance

A demo instance is the production stack with two switches thrown and one key added.
Everything else — the build, the reverse proxy, the database, backups — is
[`infra/DEPLOY.md`](DEPLOY.md), which this file does not repeat. Read that first if
you have never deployed this app; come back here for what makes an instance a *demo*.

The audience for the instance this describes is **one named tester with a link**, not
the public.

---

## What the two switches do

| Variable | Effect | Why a demo needs it |
|---|---|---|
| `SEED_DEMO=1` | Seeds the sample workspace: 11 deals, a construction scheme with cost packages and certificates, a sales development with ten plots, three investors, comparables, a data room, and the three demo logins below. | Without it the instance boots empty and the tester's first screen is a registration form. |
| `DEMO_MODE=1` | Permits the fabricating fallbacks: a buyer card payment settles instantly with no card processor behind it, and Auto-Appraisal returns its built-in worked example when asked to appraise from notes with no AI key. | Both are refused in production **on purpose** — `src/demo-mode.ts` explains why the absence of configuration is not consent to invent a figure. A demo has to declare itself one. |

Both are off by default. A real deployment sets neither and is unaffected by anything below.

---

## The `.env` for this demo

In the repo root on the host, alongside the values `DEPLOY.md` already asks for:

```bash
# --- required, as for any deployment (openssl rand -hex 32 each) ---
JWT_SECRET=...
POSTGRES_PASSWORD=...
ENCRYPTION_KEY=...

# --- what makes it a demo ---
SEED_DEMO=1
DEMO_MODE=1

# --- live AI extraction (the one integration this demo runs for real) ---
ANTHROPIC_API_KEY=sk-ant-...

# --- so emailed links point at the right host, even though nothing is sent ---
APP_URL=https://demo.yourdomain.co.uk
```

Deliberately **left unset**: `STRIPE_SECRET_KEY`, `SMTP_URL`, `EMAIL_FROM`,
`EPC_BEARER_TOKEN`. Each degrades to something the tester can still walk through, and
the walkthrough tells them which is which.

Then, exactly as in `DEPLOY.md`:

```bash
docker compose up -d --build
```

---

## What the Anthropic key turns on, and what it costs

Four touchpoints go live, and no others — the list is `src/ai-disclosure.ts`, which the
`ai-disclosure-provenance` sweep holds to the code:

| Touchpoint | Where the tester meets it |
|---|---|
| Document extraction | Auto-Appraisal — upload a PDF and it reads the scheme out of it |
| Report narrative | Red Book — market commentary, valuation rationale, risk commentary |
| Data-room questions | Data room — ask a question of the documents on a deal |
| Scenario risk commentary | Scenarios — the risk note comparing options |

**No figure comes from the model in any of them.** Every monetary output is the
deterministic engine's, from inputs a valuer accepted; the drafts are additionally held
to the figures the engine produced (`narrative-guard.ts`) and discarded for a
deterministic template if they stray. That is a product rule, not a demo posture — it is
worth saying to Dan before he starts, because it is the thing most people assume works
the other way.

**Cost.** Each of these is a single `claude-sonnet-5` call — a few thousand input tokens
and one to two thousand out. At $2/$10 per million that is well under a penny a run, so
a day of testing is pennies. Use a **spend-capped key** anyway: the key sits on a host
that has a link circulating, and a cap is the difference between a surprise and an
incident.

**Without the key**, extraction from a *document* refuses with a message saying the AI is
not configured, and the other three fall back to deterministic templates. Nothing breaks;
the most impressive journey just gets quieter.

### The rule: a PUBLIC demo holds no billable key

Learned the hard way on this project. `ANTHROPIC_API_KEY` was set on a demo instance that
was publicly reachable and whose credentials were in the public README — so anybody who
read the repo could sign in as an admin and spend the key. The AI procedures are gated on
the `aiDirector` feature, the seeded workspace is ENTERPRISE and therefore has it, those
procedures sit in the general rate-limit bucket (600 requests/min per IP), and there is no
per-org usage cap anywhere in the product. Nothing was actually spent. That was luck.

So the two configurations are:

| Instance | Reachable by | Billable keys |
|---|---|---|
| **Public demo** — a link that circulates, credentials in the README | anyone | **none** |
| **Private demo** — one named tester, behind auth on an unguessable host | that tester | a **spend-capped** key |

The API says so at boot now: with `SEED_DEMO=1` and a billable key present it logs at
error level naming the variable and the fix (`src/demo-key-guard.ts`). It warns rather
than refusing, because a private demo with a capped key is the right thing to run — what
it removes is the silence. A Stripe **test** key does not trigger it; a `sk_live_` one does.

### Putting the private instance behind a password

The web container includes `/etc/nginx/demo-auth/*.conf` — a glob that matches nothing
in a normal deployment and so does nothing. Mount one file there and the whole site needs
a password, with no code change:

```bash
# on the host, once
htpasswd -cB demo-auth.htpasswd dan          # prompts for a password
cat > demo-auth.conf <<'CONF'
auth_basic "Apex Appraise — demo";
auth_basic_user_file /etc/nginx/demo-auth/demo-auth.htpasswd;
CONF
```

Then add to the `web` service in a `docker-compose.override.yml`:

```yaml
services:
  web:
    volumes:
      - ./demo-auth.conf:/etc/nginx/demo-auth/demo-auth.conf:ro
      - ./demo-auth.htpasswd:/etc/nginx/demo-auth/demo-auth.htpasswd:ro
```

Give the tester the URL and that one username and password. It is a blunt instrument — one
shared credential in front of everything — which is exactly right for a demo and wrong for
anything else.

---

## Before you send the link

**The demo logins are on the internet.** `SEED_DEMO=1` creates these three, password
`demo`, and the login page offers them:

| Surface | Email |
|---|---|
| Firm — admin | `arthur@apexappraise.co.uk` |
| Investor portal | `investor@demo.co.uk` |
| Buyer portal | `buyer@demo.co.uk` |

That is the point of a demo and a hole in anything else. So:

- Put **nothing real** in this instance — no client names, no live valuations, no
  documents you would mind a stranger reading.
- Prefer an unguessable hostname, and put HTTP basic auth in front of nginx if the link
  may travel further than Dan.
- When the trial is over, destroy the instance rather than repurposing it. A demo box
  that quietly becomes a staging box still has `demo`/`demo` on it.

**Rate limits.** The stack ships the honest production numbers: 600 requests/min and
**10 sign-ins per minute per IP**. Normal testing never comes near it; a tester rapidly
switching between the three logins can, and the symptom is a refused sign-in that looks
like a bug. If that happens, wait a minute — or raise `AUTH_RATE_LIMIT_PER_MIN` on the
demo instance only, never in the file you deploy for real.

**Map tiles** need the decision `DEPLOY.md` describes under "Map tiles need a decision
before you sell this". For a single tester, the default is fine; for anything wider, read
that section.

---

## Resetting between sessions

The reset workflow (`.github/workflows/demo-reset.yml`) is **manual only** — Actions tab,
Run workflow. It used to fire nightly at 03:00 UTC, which is right for a demo nobody is
part-way through and wrong the moment somebody is testing it: a tester's afternoon of work
would vanish overnight with nothing on screen to explain it. Reset between sessions, not
during one.

To reset the local stack instead:

Dan's testing writes real rows — deals, appraisals, documents, signatures. To hand him a
clean instance again:

```bash
docker compose down -v          # drops the volume, and with it every row
docker compose up -d --build    # reseeds from scratch
```

`-v` is what makes it a reset rather than a restart; without it the old database survives
and the seed refuses to run twice.

---

## What this instance cannot show

Say these up front and they cost nothing; discovered mid-test they read as defects.

| Not exercised | Why | What the tester sees instead |
|---|---|---|
| Real card payments | No Stripe key | The buyer's payment settles instantly, labelled as demo mode |
| Email delivery | No SMTP | Invites, welcome and reset emails print into the API log — `docker compose logs api` shows them, reset links included |
| EPC register | No bearer token | The panel reports the integration as unconfigured |
| Companies House, Xero, open banking | Customer-supplied credentials | Connect screens work; a live sync needs a key pasted in |

Everything else in the walkthrough runs for real against Postgres, including the
server-rendered PDFs — the API image ships Chromium for exactly that.
