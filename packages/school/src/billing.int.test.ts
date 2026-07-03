import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import {
  createDb,
  customers,
  invoices,
  ledgerEntries,
  ruleConsumptions,
  rules,
  runMigrations,
  type DbHandle,
} from "@kobo/db";
import { LedgerAccount } from "@kobo/shared";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { runBilling } from "./billing.js";
import { promoteCohort } from "./cohort.js";

let pg: StartedPostgreSqlContainer;
let handle: DbHandle;

const TUITION = 5_500_000n; // ₦55,000
const REGISTRATION = 1_000_000n; // ₦10,000 (one-time)

beforeAll(async () => {
  pg = await new PostgreSqlContainer("postgres:16-alpine").start();
  await runMigrations(pg.getConnectionUri());
  handle = createDb(pg.getConnectionUri());
}, 120_000);

afterAll(async () => {
  await handle?.close();
  await pg?.stop();
});

let ada: string, tobi: string, bola: string;

beforeEach(async () => {
  // TRUNCATE, not DELETE — the ledger is append-only (DELETE is trigger-blocked).
  await handle.db.execute(
    sql`TRUNCATE ledger_entries, rule_consumptions, invoices, rules, customers RESTART IDENTITY CASCADE`,
  );

  const inserted = await handle.db
    .insert(customers)
    .values([
      { accountRef: "KOBO-JSS1-ADA-000001", name: "Ada", vertical: "school", cohort: "JSS1", metadata: {} },
      { accountRef: "KOBO-JSS1-TOBI-00001", name: "Tobi", vertical: "school", cohort: "JSS1", metadata: { scholarship: true } },
      { accountRef: "KOBO-JSS1-BOLA-00001", name: "Bola", vertical: "school", cohort: "JSS1", metadata: { scholarship: true, hardship: true } },
    ])
    .returning({ id: customers.id, name: customers.name });
  ada = inserted.find((c) => c.name === "Ada")!.id;
  tobi = inserted.find((c) => c.name === "Tobi")!.id;
  bola = inserted.find((c) => c.name === "Bola")!.id;

  await handle.db.insert(rules).values([
    { name: "Tuition", kind: "charge", valueType: "fixed", value: TUITION, recurrence: "termly", cohort: "JSS1", match: {} },
    { name: "Registration", kind: "charge", valueType: "fixed", value: REGISTRATION, recurrence: "one_time", cohort: "JSS1", match: {} },
    { name: "Scholarship", kind: "discount", valueType: "percent", value: 2000n, recurrence: "termly", cohort: "JSS1", match: { scholarship: true } },
    { name: "Hardship", kind: "discount", valueType: "percent", value: 5000n, recurrence: "one_time", cohort: "JSS1", match: { hardship: true } },
    { name: "Bus", kind: "charge", valueType: "fixed", value: 800_000n, recurrence: "monthly", cohort: "JSS1", match: {} },
  ]);
});

const TERM = { cohort: "JSS1", frequency: "termly", period: "2026-T1" } as const;

async function expectedFor(customerId: string, reference: string): Promise<bigint> {
  const [inv] = await handle.db
    .select({ amountExpected: invoices.amountExpected })
    .from(invoices)
    .where(and(eq(invoices.customerId, customerId), eq(invoices.reference, reference)));
  return inv!.amountExpected;
}

describe("runBilling", () => {
  it("nets charges + highest-wins discount and consumes one-time rules", async () => {
    const res = await runBilling(handle.db, TERM);
    expect(res.reference).toBe("JSS1-2026-T1");
    expect(res.invoicesCreated).toBe(3);

    // Ada: tuition + registration, no discount.
    expect(await expectedFor(ada, "JSS1-2026-T1")).toBe(TUITION + REGISTRATION); // 6,500,000
    // Tobi: base 6,500,000 − 20% (1,300,000) = 5,200,000.
    expect(await expectedFor(tobi, "JSS1-2026-T1")).toBe(5_200_000n);
    // Bola: base 6,500,000 − max(20% = 1,300,000, 50% = 3,250,000) → 3,250,000.
    expect(await expectedFor(bola, "JSS1-2026-T1")).toBe(3_250_000n);

    // Registration (one-time charge) consumed for all 3; hardship only for Bola.
    const cons = await handle.db.select().from(ruleConsumptions);
    expect(cons.length).toBe(4); // 3 registration + 1 hardship
  });

  it("is idempotent — re-running the same term creates nothing", async () => {
    await runBilling(handle.db, TERM);
    const again = await runBilling(handle.db, TERM);
    expect(again.invoicesCreated).toBe(0);
    expect(again.invoicesSkipped).toBe(3);
  });

  it("drops consumed one-time rules in the next term", async () => {
    await runBilling(handle.db, TERM);
    await runBilling(handle.db, { cohort: "JSS1", frequency: "termly", period: "2026-T2" });

    // Term 2: registration gone for everyone (base = tuition only).
    expect(await expectedFor(ada, "JSS1-2026-T2")).toBe(TUITION); // 5,500,000
    // Tobi: 5,500,000 − 20% = 4,400,000.
    expect(await expectedFor(tobi, "JSS1-2026-T2")).toBe(4_400_000n);
    // Bola: hardship consumed → only scholarship 20% → 4,400,000.
    expect(await expectedFor(bola, "JSS1-2026-T2")).toBe(4_400_000n);
  });
});

describe("frequency-scoped billing", () => {
  it("charges only the fees matching the run's frequency", async () => {
    // Termly run: tuition + registration, but NOT the monthly Bus fee.
    await runBilling(handle.db, TERM);
    expect(await expectedFor(ada, "JSS1-2026-T1")).toBe(TUITION + REGISTRATION);

    // Monthly run for the same cohort: only the Bus fee (₦8,000); tuition/scholarship
    // are termly, so they're excluded.
    const monthly = await runBilling(handle.db, { cohort: "JSS1", frequency: "monthly", period: "2026-01" });
    expect(monthly.invoicesCreated).toBe(3);
    expect(await expectedFor(ada, "JSS1-2026-01")).toBe(800_000n);
    expect(await expectedFor(tobi, "JSS1-2026-01")).toBe(800_000n); // scholarship is termly → not here
  });
});

describe("credit auto-apply at billing", () => {
  it("offsets the new invoice with a student's standing credit and draws it down", async () => {
    // Ada prepaid ₦20,000 last term (a credit on her account, no invoice then).
    await handle.db.insert(ledgerEntries).values({
      paymentId: null,
      account: LedgerAccount.customerCredit(ada),
      direction: "credit",
      amount: 2_000_000n,
    });

    const res = await runBilling(handle.db, TERM);
    expect(res.creditApplied).toBe(2_000_000n);

    // Ada's invoice (tuition ₦55k + registration ₦10k = ₦65k) auto-settles ₦20k.
    const [inv] = await handle.db
      .select()
      .from(invoices)
      .where(and(eq(invoices.customerId, ada), eq(invoices.reference, "JSS1-2026-T1")));
    expect(inv!.amountSettled).toBe(2_000_000n);
    expect(inv!.status).toBe("partially_paid");

    // Credit account is drawn down to zero (credit − debit).
    const entries = await handle.db
      .select()
      .from(ledgerEntries)
      .where(eq(ledgerEntries.account, LedgerAccount.customerCredit(ada)));
    const balance = entries.reduce((a, e) => a + (e.direction === "credit" ? e.amount : -e.amount), 0n);
    expect(balance).toBe(0n);
  });
});

describe("promoteCohort", () => {
  it("relabels an entire cohort, keeping students intact", async () => {
    const res = await promoteCohort(handle.db, { from: "JSS1", to: "JSS2" });
    expect(res.moved).toBe(3);

    const moved = await handle.db.select().from(customers).where(eq(customers.cohort, "JSS2"));
    expect(moved.map((c) => c.name).sort()).toEqual(["Ada", "Bola", "Tobi"]);
    const stillJss1 = await handle.db.select().from(customers).where(eq(customers.cohort, "JSS1"));
    expect(stillJss1).toHaveLength(0);
  });
});
