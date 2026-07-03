/**
 * Missed-webhook backfill. NIBSS lag or a brief endpoint outage can drop a
 * webhook; this poller treats the webhook as authoritative and the Transactions
 * API as a safety net. For every active VA it lists recent transactions, and any
 * transfer present at Nomba but absent from our `payments` (by sessionId) is
 * materialised as a trusted `raw_event` and fed through the SAME reconciliation
 * path — so backfill and live webhooks converge on identical ledger writes.
 */
import { customers, payments, rawEvents, virtualAccounts, type Db } from "@kobo/db";
import { koboToNaira, type Logger } from "@kobo/shared";
import type { NombaClient, NombaTransaction } from "@kobo/nomba";
import { eq } from "drizzle-orm";
import { DateTime } from "luxon";

export interface BackfillDeps {
  db: Db;
  nomba: NombaClient;
  enqueue: (rawEventId: string) => Promise<void>;
  log?: Logger;
}

function buildSyntheticPayload(
  vaNumber: string,
  accountRef: string,
  tx: NombaTransaction,
): Record<string, unknown> {
  return {
    event_type: "payment_success",
    requestId: `backfill-${tx.sessionId}`,
    data: {
      merchant: {},
      transaction: {
        sessionId: tx.sessionId,
        type: "vact_transfer",
        aliasAccountType: "VIRTUAL",
        aliasAccountNumber: vaNumber,
        aliasAccountReference: tx.aliasAccountReference ?? accountRef,
        transactionAmount: koboToNaira(tx.amount),
        fee: koboToNaira(tx.fee),
        responseCode: "",
        time: tx.occurredAt,
      },
      customer: {},
    },
  };
}

export async function pollBackfill(deps: BackfillDeps): Promise<{ scanned: number; enqueued: number }> {
  const { db, nomba, enqueue, log } = deps;
  const now = DateTime.now().setZone("Africa/Lagos");
  const dateFrom = now.minus({ days: 1 }).toFormat("yyyy-MM-dd");
  const dateTo = now.toFormat("yyyy-MM-dd");

  const vas = await db
    .select({
      number: virtualAccounts.bankAccountNumber,
      accountRef: customers.accountRef,
    })
    .from(virtualAccounts)
    .innerJoin(customers, eq(virtualAccounts.customerId, customers.id))
    .where(eq(virtualAccounts.status, "active"));

  let scanned = 0;
  let enqueued = 0;

  for (const va of vas) {
    const txs = await nomba.listVirtualAccountTransactions({
      virtualAccount: va.number,
      dateFrom,
      dateTo,
    });
    for (const tx of txs) {
      if (!tx.sessionId || tx.amount <= 0n) continue;
      scanned++;

      const [seen] = await db
        .select({ id: payments.id })
        .from(payments)
        .where(eq(payments.sessionId, tx.sessionId))
        .limit(1);
      if (seen) continue;

      const [inserted] = await db
        .insert(rawEvents)
        .values({
          sessionId: tx.sessionId,
          requestId: `backfill-${tx.sessionId}`,
          eventType: "payment_success",
          payload: buildSyntheticPayload(va.number, va.accountRef, tx),
          signatureValid: true, // sourced from the authenticated Transactions API
        })
        .onConflictDoNothing({ target: rawEvents.sessionId })
        .returning({ id: rawEvents.id });

      if (inserted) {
        await enqueue(inserted.id);
        enqueued++;
      }
    }
  }

  log?.info({ scanned, enqueued, dateFrom, dateTo }, "backfill poll complete");
  return { scanned, enqueued };
}
