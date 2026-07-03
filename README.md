# Kobo — Virtual-Account Reconciliation Engine

*Nomba × DevCareer Hackathon 2026 · "Virtual Accounts as Infrastructure"*

Kobo gives every customer a **dedicated Nomba virtual account**, then automatically
matches every inbound transfer to the right person and the right invoice in a
**double-entry, append-only ledger** — classifying exact / under / over / duplicate /
orphan payments, quarantining the unclear ones, and reporting every kobo.

> Money is integer **kobo** (`bigint`) end to end. No floating point ever touches a balance.

---

## Architecture

```
Nomba ──webhook──▶ api (Fastify)                       worker (BullMQ)
                   verify signature                    reconcile  ── FIFO invoice FOR UPDATE
                   persist raw_event ──▶ Redis ──job──▶ engine (pure) ──▶ ledger (atomic txn)
                   return 200 fast                      backfill   ── Transactions API safety net
                        │                               payout     ── maker-checker refunds
                        ▼
                   Postgres (system of record)  ◀──  web (Next.js dashboard)
```

| Package | Responsibility |
|---|---|
| `@kobo/shared` | money (kobo), env (Zod), domain types, webhook schemas, queue names, logger |
| `@kobo/core` | **pure reconciliation engine** — classify + balanced double-entry postings |
| `@kobo/db` | Drizzle schema + authoritative SQL migrations + migrator + seed |
| `@kobo/nomba` | Nomba client (real adapter w/ Redis token lease + mock), **signature verification**, normaliser |
| `@kobo/api` | Fastify: webhook receiver, auth (JWT+Argon2), maker-checker, reporting REST |
| `@kobo/worker` | BullMQ: ingestion/reconcile, backfill poller, refund payout |
| `@kobo/web` | Next.js dashboard: customer statements + operator KPI console |

---

## Quick start (Docker)

```bash
cp .env.example .env          # fill NOMBA_* for the sandbox, or leave NOMBA_ADAPTER=mock
docker compose up --build     # postgres, redis, migrate(+seed), api, worker, web
```

`docker compose up` brings up Postgres + Redis, runs the one-shot **`migrate`** container
(which **applies migrations *and* seeds** operators + demo data — idempotent), then starts
`api`, `worker`, and `web`. Everything waits on healthchecks, so the order is automatic.

- **Dashboard:** http://localhost:3000
- **API:** http://localhost:3001 (`/health`, `/ready`)

To re-run the seed manually (rarely needed — it runs on every `up`):

```bash
docker compose run --rm --no-deps migrate sh -c "pnpm --filter @kobo/db seed"
```

---

## School product — a system built on Kobo

A worked demo that Kobo is *infrastructure*, not a one-off app: a school-fees product
(`@kobo/school` + the `/school/*` API + the **School** section in the dashboard) sits on
top of the platform and uses it for all money — VAs, invoices, and the reconciliation
engine. The school layer owns the domain; Kobo owns the ledger.

It models how a bursar actually works — in bulk, on a schedule, in their own vocabulary:

- **Bulk onboarding** — upload a class roster → a dedicated VA per student (no one-at-a-time).
- **One Rule primitive** — charges *and* discounts, fixed (₦) or percent, recurring or one-time,
  targeted purely by **metadata tags** (tag one student or forty — same mechanism). Charges sum;
  among discounts the **single highest wins** (no stacking); a one-time rule is consumed only when applied.
- **Cohort billing** — one **net** invoice per student per term, idempotent; **transition** to the next
  term or **promote** a whole cohort (JSS1→JSS2) in one action.
- **Parents pay any amount, anytime** — a payment **waterfalls** across open invoices oldest-first;
  the remainder becomes credit. The bursar sees a running balance, not invoice-matching jargon.
- **Defaulters & collection rate** per cohort — the bursar's home screen.

Demo (dashboard → **School**): **Students** (paste a roster) → **Fees & discounts** (add tuition + a
scholarship) → **Collections** (Run billing, watch the rate). Drive payments with `pnpm simulate
--account-ref <student> --amount <n>` and watch defaulters shrink.

> Engine note: the waterfall is a *platform* capability in `@kobo/core` (any product on Kobo benefits).
> Everything school-specific lives in `@kobo/school` — the platform stays vertical-agnostic.

---

## Operator console — login & roles

The console enforces **maker-checker** (four-eyes control) on money-moving actions.
Two operators are seeded; both use the password `kobo-demo-password` (override with
`SEED_OPERATOR_PASSWORD` in `.env`):

| Login | Role | Can do |
|---|---|---|
| `maker@kobo.dev` | **maker** | View everything; create customers; resolve / re-attribute exceptions; **propose** refunds |
| `checker@kobo.dev` | **checker** | Everything a maker can, **plus approve refunds** — but never one they proposed |

How the control works:
- An **overpayment** automatically creates a `pending_refund` (status `pending_approval`).
- A **checker** approves it via the console; approval enqueues the actual payout.
- The approver **must differ from the proposer** — the API rejects self-approval (`409`).

Auth is JWT (1-hour TTL) signed with `JWT_SECRET`; passwords are hashed with Argon2id.

---

## Double-entry ledger & audit trail

Every reconciled payment writes **balanced double-entry postings** (Σ debits = Σ credits)
inside one DB transaction — cash, receivable, fee, customer-credit, and suspense accounts.
The ledger is **append-only, enforced by the database**: `BEFORE UPDATE`/`BEFORE DELETE`
triggers on `ledger_entries` raise an exception, so history can never be rewritten or deleted
(reversals are *new* contra postings, not edits).

This gives an **"explain every kobo" audit trail**: each customer's statement
(`/customers/:id/statement` → the **Ledger audit trail** card) lists every posting —
account, debit/credit, amount, timestamp — traceable back to the raw webhook that caused it.
The integration suite asserts both the per-payment balance and that the append-only trigger fires.

---

## Configuration (`.env`)

| Var | Purpose |
|---|---|
| `NODE_ENV` | `development` locally; compose forces `production` in containers |
| `DATABASE_URL` / `REDIS_URL` | Postgres (system of record) + Redis (queues/lease). Compose overrides to service hosts |
| `NOMBA_ADAPTER` | `mock` (hermetic, no creds) or `real` (hits the sandbox/prod API) |
| `NOMBA_BASE_URL` | Sandbox `https://sandbox.api.nomba.com` · prod `https://api.nomba.com` (host only; client appends `/v1`,`/v2`) |
| `NOMBA_CLIENT_ID` / `NOMBA_CLIENT_SECRET` | OAuth client-credentials (use the **TEST** pair against sandbox) |
| `NOMBA_ACCOUNT_ID` | Parent business UUID — sent in the `accountId` header on every call |
| `NOMBA_SUB_ACCOUNT_ID` | Optional — scopes VA creation + payouts to a sub-account |
| `NOMBA_SIGNATURE_KEY` | Webhook signing key — **must match** the value set on the Nomba dashboard |
| `JWT_SECRET` / `JWT_TTL` | Operator session signing |
| `BACKFILL_CRON` / `RECONCILE_CONCURRENCY` | Worker tuning |

> Secrets live only in `.env` (gitignored). Never commit them or paste them anywhere.

---

## Connecting to the Nomba sandbox

1. Put your **TEST** credentials in `.env`, set `NOMBA_ADAPTER=real`, and choose a
   `NOMBA_SIGNATURE_KEY`.
2. Bring the stack up, then expose the webhook over a public HTTPS URL:
   ```bash
   docker compose --profile tunnel up tunnel   # prints https://<host>.trycloudflare.com
   ```
3. On the Nomba dashboard → Webhooks:
   - **Webhook URL:** `https://<host>.trycloudflare.com/webhooks/nomba`
   - **Signature Key:** the exact `NOMBA_SIGNATURE_KEY` from your `.env`
   - **Events:** `payment_success`, `payment_reversal`, `payout_success`, `payout_failed`, `payout_refund`
   - Submit your **sub-account**.

The receiver verifies the signature, persists the raw event, returns `200` fast, and
hands reconciliation to the worker. Unsigned validation probes are acked with `200`
but never processed.

---

## Driving a demo (no bank transfer needed)

The dashboard doesn't originate payments — money arrives via a Nomba webhook. Use the
**`simulate`** script to post correctly-signed webhooks at the running API and watch the
console react. It reads `NOMBA_SIGNATURE_KEY` (or pass `--secret`).

```bash
# 1. In the dashboard: create a customer, open it, click "New invoice" (e.g. ₦50,000).
#    (Or use a seeded customer — accountRef like KOBO-RENT-TENANT-0001.)
# 2. Drive payments against that accountRef:
pnpm simulate --account-ref KOBO-RENT-TENANT-0001 --amount 50000                 # exact → settles
pnpm simulate --account-ref KOBO-RENT-TENANT-0001 --amount 30000                 # under → partial
pnpm simulate --account-ref KOBO-RENT-TENANT-0001 --amount 60000 --type over     # over → refund
pnpm simulate --account-ref KOBO-RENT-TENANT-0001 --amount 50000 --type dup --count 5  # replay → credits once
pnpm simulate --type orphan --amount 5000                                        # unknown → suspense
```

Then watch http://localhost:3000 — KPIs, the customer statement, the exception queue, and
pending refunds all update live. The `dup` run is the headline moment: 5 identical webhooks,
**one** ledger credit.

---

## API reference

| Method & path | Auth | Purpose |
|---|---|---|
| `GET /health` · `GET /ready` | — | Liveness / readiness (DB + Redis) |
| `POST /auth/login` | — | Operator login → JWT (`{email, password}`) |
| `POST /webhooks/nomba` | signature | Inbound webhook receiver (signature-verified, idempotent) |
| `GET /customers` | operator | List customers |
| `POST /customers` | operator | Create a customer + provision their dedicated VA |
| `GET /customers/:id/statement` | operator | Per-customer statement: invoices, balance, audit trail |
| `POST /customers/:id/invoices` | operator | Create an invoice (amount in **naira** → stored as kobo) |
| `GET /kpis` | operator | Operator KPIs: auto-match rate, open breaks, unreconciled exposure, fee leakage |
| `GET /exceptions` | operator | Exception queue (aging + materiality) |
| `POST /exceptions/:id/resolve` | operator | Close a break |
| `POST /exceptions/:id/reattribute` | operator | Move orphan money to a customer credit (balanced postings) |
| `GET /refunds` | operator | Pending refunds |
| `POST /refunds/:id/approve` | **checker** | Approve a refund (not self-proposed) → enqueue payout |

---

## Edge cases handled

| Scenario | Handling |
|---|---|
| Exact / under / over payment | Classified; invoice settled / partially-paid / settled + surplus → customer credit or refund |
| Duplicate webhook (replay) | `sessionId` UNIQUE gate → **ledger credits once** |
| Orphan (unknown sender/VA) | Parked in `suspense:unmatched`; exception opened; operator re-attributable |
| Missed webhook | Backfill poller reconciles from the Transactions API |
| Payout result (`payout_*` / `transfer.*`) | Finalises the matching refund (sent / failed) |
| Payment reversal | Append-only contra postings unwind the credit; invoice rolled back |
| Enqueue failure (Redis blip) | Persist-before-enqueue + sweeper re-enqueues stuck raw_events |
| Invalid signature | Rejected `401`, never reconciled; both documented signing schemes accepted |
| Concurrent payments, same customer | `SELECT … FOR UPDATE` on the FIFO invoice serialises them |

---

## Testing

```bash
pnpm test        # 32 unit tests (engine, money, signature) — no Docker needed
pnpm test:int    # 20 integration tests — real Postgres+Redis via Testcontainers (needs Docker)
pnpm typecheck && pnpm lint
```

The integration suite proves: balanced double-entry for every classification, correct
under/over/orphan handling, the **append-only ledger DB trigger**, **maker-checker**
(a checker cannot approve their own proposal), webhook signature accept/reject, payout
and reversal handling, orphan re-attribution, and the headline
**"replay the webhook 5× → ledger credits once"** idempotency guarantee.

---

## Local dev (no Docker)

```bash
pnpm install
# bring up Postgres + Redis however you like, then:
export DATABASE_URL=postgres://kobo:kobo@localhost:5432/kobo REDIS_URL=redis://localhost:6379
pnpm --filter @kobo/db migrate && pnpm --filter @kobo/db seed
pnpm dev        # builds packages in watch mode + runs api, worker, web
```

`NOMBA_ADAPTER=mock` runs hermetically with an in-memory Nomba; `real` hits the sandbox.
