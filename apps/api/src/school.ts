/**
 * School product routes — the bursar-facing surface built ON Kobo. These own the
 * school domain (cohorts, metadata, rules, billing, defaulters) and consume Kobo
 * for the money: virtual accounts, invoices, and the reconciliation engine.
 *
 * All amounts cross the wire in NAIRA and are stored as integer kobo; percentages
 * cross as a number (20 or 20.5) and are stored as integer basis points.
 * BigInt is never JSON-serialised directly — every money field goes out as a string.
 */
import { randomUUID } from "node:crypto";
import { customers, rules, virtualAccounts, type Db } from "@kobo/db";
import { promoteCohort, runBilling } from "@kobo/school";
import { nairaToKobo } from "@kobo/shared";
import type { NombaClient } from "@kobo/nomba";
import { and, eq, sql } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

type PreHandler = (req: FastifyRequest, reply: FastifyReply) => Promise<void>;

const RosterBody = z.object({
  students: z
    .array(
      z.object({
        name: z.string().min(2).max(64),
        cohort: z.string().min(1).max(32),
        metadata: z.record(z.unknown()).optional(),
      }),
    )
    .min(1)
    .max(1000),
});

const RuleBody = z.object({
  name: z.string().min(1).max(64),
  kind: z.enum(["charge", "discount"]),
  valueType: z.enum(["fixed", "percent"]),
  // fixed → naira (>0); percent → percentage 0–100 (e.g. 20 or 20.5).
  amount: z.number().positive().finite(),
  recurrence: z.enum(["one_time", "monthly", "termly", "annually"]),
  cohort: z.string().max(32).optional(),
  match: z.record(z.unknown()).optional(),
});

const BillingRunBody = z.object({
  cohort: z.string().min(1).max(32),
  frequency: z.enum(["monthly", "termly", "annually"]),
  period: z.string().min(1).max(16),
});

const PromoteBody = z.object({
  from: z.string().min(1).max(32),
  to: z.string().min(1).max(32),
});

function pageOf(req: FastifyRequest): { limit: number; offset: number } {
  const q = req.query as { limit?: string; offset?: string };
  return {
    limit: Math.min(Math.max(Number(q.limit) || 20, 1), 100),
    offset: Math.max(Number(q.offset) || 0, 0),
  };
}

export function registerSchoolRoutes(
  app: FastifyInstance,
  ctx: { db: Db; nomba: NombaClient; authenticate: PreHandler },
): void {
  const { db, nomba, authenticate } = ctx;

  // Bulk onboarding: a roster → a dedicated VA + student per row.
  app.post("/school/roster", { preHandler: authenticate }, async (req, reply) => {
    const parsed = RosterBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid body" });

    const created: { id: string; name: string; cohort: string; bankAccountNumber: string }[] = [];
    const failed: { name: string; error: string }[] = [];

    for (const s of parsed.data.students) {
      try {
        const accountRef = `KOBO-${s.cohort}-${randomUUID()}`.slice(0, 64);
        const accountName = s.name.length >= 8 ? s.name : `${s.name} (${s.cohort})`;
        const va = await nomba.createVirtualAccount({ accountRef, accountName });
        const [customer] = await db
          .insert(customers)
          .values({
            accountRef,
            name: s.name,
            vertical: "school",
            cohort: s.cohort,
            metadata: s.metadata ?? {},
          })
          .returning({ id: customers.id });
        await db.insert(virtualAccounts).values({
          customerId: customer!.id,
          bankAccountNumber: va.bankAccountNumber,
          bankAccountName: va.bankAccountName,
          bankName: va.bankName,
          accountHolderId: va.accountHolderId,
        });
        created.push({ id: customer!.id, name: s.name, cohort: s.cohort, bankAccountNumber: va.bankAccountNumber });
      } catch (err) {
        failed.push({ name: s.name, error: (err as Error).message });
      }
    }
    return reply.code(201).send({ created: created.length, failed: failed.length, students: created, errors: failed });
  });

  // List provisioned students (with their VA number), optionally by cohort.
  app.get<{ Querystring: { cohort?: string; limit?: string; offset?: string } }>(
    "/school/students",
    { preHandler: authenticate },
    async (req) => {
      const page = pageOf(req);
      const cohort = req.query.cohort?.trim();
      const where = cohort
        ? and(eq(customers.vertical, "school"), eq(customers.cohort, cohort))
        : eq(customers.vertical, "school");
      const items = await db
        .select({
          id: customers.id,
          name: customers.name,
          cohort: customers.cohort,
          bankAccountNumber: virtualAccounts.bankAccountNumber,
        })
        .from(customers)
        .leftJoin(virtualAccounts, eq(virtualAccounts.customerId, customers.id))
        .where(where)
        .orderBy(customers.cohort, customers.name)
        .limit(page.limit)
        .offset(page.offset);
      const [c] = await db
        .select({ total: sql<string>`COUNT(*)` })
        .from(customers)
        .where(where);
      return { items, total: Number(c?.total ?? "0") };
    },
  );

  // Distinct tags currently on students (so rules can target real tags, not guesses).
  app.get<{ Querystring: { cohort?: string } }>(
    "/school/tags",
    { preHandler: authenticate },
    async (req) => {
      const cohort = req.query.cohort?.trim();
      const where = cohort
        ? and(eq(customers.vertical, "school"), eq(customers.cohort, cohort))
        : eq(customers.vertical, "school");
      const rows = await db.select({ metadata: customers.metadata }).from(customers).where(where);
      const tags = new Set<string>();
      for (const r of rows) {
        for (const [k, v] of Object.entries(r.metadata ?? {})) {
          tags.add(v === true ? k : `${k}=${String(v)}`);
        }
      }
      return [...tags].sort();
    },
  );

  // Create a Rule (charge or discount), targeted by metadata.
  app.post("/school/rules", { preHandler: authenticate }, async (req, reply) => {
    const parsed = RuleBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid body" });
    const b = parsed.data;
    if (b.valueType === "percent" && b.amount > 100) {
      return reply.code(400).send({ error: "percent must be 0–100" });
    }
    // fixed → kobo; percent → basis points (20 → 2000, 20.5 → 2050).
    const value = b.valueType === "fixed" ? nairaToKobo(b.amount) : BigInt(Math.round(b.amount * 100));

    const [rule] = await db
      .insert(rules)
      .values({
        name: b.name,
        kind: b.kind,
        valueType: b.valueType,
        value,
        recurrence: b.recurrence,
        ...(b.cohort ? { cohort: b.cohort } : {}),
        match: b.match ?? {},
      })
      .returning({ id: rules.id });
    return reply.code(201).send({ id: rule!.id });
  });

  app.get<{ Querystring: { cohort?: string; limit?: string; offset?: string } }>(
    "/school/rules",
    { preHandler: authenticate },
    async (req) => {
      const page = pageOf(req);
      const where = req.query.cohort ? eq(rules.cohort, req.query.cohort) : undefined;
      const rows = await db.select().from(rules).where(where).limit(page.limit).offset(page.offset);
      const [c] = await db.select({ total: sql<string>`COUNT(*)` }).from(rules).where(where);
      return {
        items: rows.map((r) => ({
          id: r.id,
          name: r.name,
          kind: r.kind,
          valueType: r.valueType,
          value: r.value.toString(),
          recurrence: r.recurrence,
          cohort: r.cohort,
          match: r.match,
          active: r.active,
        })),
        total: Number(c?.total ?? "0"),
      };
    },
  );

  // Run billing for a cohort/term → one net invoice per student.
  app.post("/school/billing-runs", { preHandler: authenticate }, async (req, reply) => {
    const parsed = BillingRunBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid body" });
    const result = await runBilling(db, parsed.data);
    return {
      reference: result.reference,
      studentsBilled: result.studentsBilled,
      invoicesCreated: result.invoicesCreated,
      invoicesSkipped: result.invoicesSkipped,
      totalExpectedKobo: result.totalExpected.toString(),
    };
  });

  // Defaulters + collection rate for a cohort (the bursar's home screen).
  app.get<{ Querystring: { cohort?: string; limit?: string; offset?: string } }>(
    "/school/defaulters",
    { preHandler: authenticate },
    async (req, reply) => {
      const cohort = req.query.cohort;
      if (!cohort) return reply.code(400).send({ error: "cohort is required" });
      const page = pageOf(req);

      const owing = await db.execute<{ id: string; name: string; outstanding: string }>(sql`
        SELECT c.id, c.name,
          COALESCE(SUM(CASE WHEN i.status IN ('open','partially_paid')
                            THEN i.amount_expected - i.amount_settled ELSE 0 END), 0)::text AS outstanding
        FROM customers c
        LEFT JOIN invoices i ON i.customer_id = c.id
        WHERE c.cohort = ${cohort}
        GROUP BY c.id, c.name
        HAVING COALESCE(SUM(CASE WHEN i.status IN ('open','partially_paid')
                                 THEN i.amount_expected - i.amount_settled ELSE 0 END), 0) > 0
        ORDER BY outstanding DESC
        LIMIT ${page.limit} OFFSET ${page.offset}
      `);

      const owingCount = await db.execute<{ total: string }>(sql`
        SELECT COUNT(*)::text AS total FROM (
          SELECT c.id
          FROM customers c LEFT JOIN invoices i ON i.customer_id = c.id
          WHERE c.cohort = ${cohort}
          GROUP BY c.id
          HAVING COALESCE(SUM(CASE WHEN i.status IN ('open','partially_paid')
                                   THEN i.amount_expected - i.amount_settled ELSE 0 END), 0) > 0
        ) q
      `);

      const totals = await db.execute<{ billed: string; collected: string }>(sql`
        SELECT COALESCE(SUM(i.amount_expected), 0)::text AS billed,
               COALESCE(SUM(i.amount_settled), 0)::text AS collected
        FROM customers c JOIN invoices i ON i.customer_id = c.id
        WHERE c.cohort = ${cohort}
      `);

      const billed = BigInt(totals.rows[0]?.billed ?? "0");
      const collected = BigInt(totals.rows[0]?.collected ?? "0");
      const collectionRate = billed > 0n ? Number((collected * 10000n) / billed) / 100 : 0;

      return {
        cohort,
        billedKobo: billed.toString(),
        collectedKobo: collected.toString(),
        collectionRate, // percent, 2dp
        defaultersTotal: Number(owingCount.rows[0]?.total ?? "0"),
        defaulters: owing.rows.map((d) => ({
          id: d.id,
          name: d.name,
          outstandingKobo: d.outstanding,
        })),
      };
    },
  );

  // Promotion: relabel a whole cohort (JSS1 → JSS2) at year end.
  app.post("/school/cohorts/promote", { preHandler: authenticate }, async (req, reply) => {
    const parsed = PromoteBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid body" });
    return promoteCohort(db, parsed.data);
  });
}
