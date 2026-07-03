/**
 * Cohort lifecycle. Two motions a bursar needs at term/year boundaries:
 *   - **transition** to the next term: just a new billing run for the same cohort
 *     (see `runBilling`) — students, VAs, metadata and credit all carry over.
 *   - **promotion**: relabel a whole cohort (JSS1 → JSS2) at year end. Students
 *     keep everything; only their cohort label changes.
 */
import { customers, type Db } from "@kobo/db";
import { eq } from "drizzle-orm";

export async function promoteCohort(
  db: Db,
  params: { from: string; to: string },
): Promise<{ moved: number }> {
  const moved = await db
    .update(customers)
    .set({ cohort: params.to })
    .where(eq(customers.cohort, params.from))
    .returning({ id: customers.id });
  return { moved: moved.length };
}
