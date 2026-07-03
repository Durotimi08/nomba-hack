/**
 * Demo seed — idempotent. Bootstraps the two maker-checker operators and a
 * multi-vertical data set (rent / school / Ajo) so the dashboard and the live
 * reconciliation demo have something to show. Re-runnable: every insert is
 * guarded by ON CONFLICT DO NOTHING against a natural unique key.
 *
 * Virtual-account numbers are generated locally here (deterministic) so the seed
 * needs no Nomba/Redis connection; the live demo creates real sandbox VAs via
 * the API. Amounts are kobo.
 */
import argon2 from "argon2";
import { eq } from "drizzle-orm";
import { createDb } from "./client.js";
import { runMigrations } from "./migrate.js";
import { customers, invoices, operators, virtualAccounts } from "./schema.js";

interface SeedCustomer {
  accountRef: string;
  name: string;
  vertical: "rent" | "school" | "ajo";
  bankAccountNumber: string;
  invoice: { reference: string; amountExpected: bigint; period: string };
}

const DEMO_CUSTOMERS: SeedCustomer[] = [
  {
    accountRef: "KOBO-RENT-TENANT-0001",
    name: "Adunni Okafor",
    vertical: "rent",
    bankAccountNumber: "9900000001",
    invoice: { reference: "RENT-2026-07", amountExpected: 50_000_00n, period: "2026-07" },
  },
  {
    accountRef: "KOBO-SCHOOL-STUDENT-0001",
    name: "Chidi Balogun",
    vertical: "school",
    bankAccountNumber: "9900000002",
    invoice: { reference: "FEES-JSS1-T1", amountExpected: 120_000_00n, period: "2026-T1" },
  },
  {
    accountRef: "KOBO-AJO-MEMBER-0001",
    name: "Ngozi Adeyemi",
    vertical: "ajo",
    bankAccountNumber: "9900000003",
    invoice: { reference: "AJO-WEEK-26", amountExpected: 10_000_00n, period: "2026-W26" },
  },
];

async function seed(databaseUrl: string): Promise<void> {
  await runMigrations(databaseUrl);
  const { db, close } = createDb(databaseUrl);
  try {
    const password = process.env.SEED_OPERATOR_PASSWORD ?? "kobo-demo-password";
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    await db
      .insert(operators)
      .values([
        { email: "maker@kobo.dev", passwordHash, role: "maker" },
        { email: "checker@kobo.dev", passwordHash, role: "checker" },
      ])
      .onConflictDoNothing({ target: operators.email });

    for (const c of DEMO_CUSTOMERS) {
      const [customer] = await db
        .insert(customers)
        .values({ accountRef: c.accountRef, name: c.name, vertical: c.vertical })
        .onConflictDoNothing({ target: customers.accountRef })
        .returning({ id: customers.id });

      const customerId =
        customer?.id ??
        (await db.query.customers.findFirst({ where: eq(customers.accountRef, c.accountRef) }))?.id;
      if (!customerId) throw new Error(`Failed to resolve customer ${c.accountRef}`);

      await db
        .insert(virtualAccounts)
        .values({
          customerId,
          bankAccountNumber: c.bankAccountNumber,
          bankAccountName: `Kobo/${c.name}`,
          bankName: "Nombank MFB",
        })
        .onConflictDoNothing({ target: virtualAccounts.bankAccountNumber });

      await db
        .insert(invoices)
        .values({
          customerId,
          reference: c.invoice.reference,
          amountExpected: c.invoice.amountExpected,
          period: c.invoice.period,
        })
        .onConflictDoNothing();
    }
  } finally {
    await close();
  }
}

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required to seed");
seed(url)
  .then(() => {
    console.log("Seed complete.");
    process.exit(0);
  })
  .catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
