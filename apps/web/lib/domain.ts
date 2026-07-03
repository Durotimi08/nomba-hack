/**
 * Single source of truth for how reconciliation concepts render across the
 * console — labels, chart colours, and badge variants. Keeping this here means
 * a classification looks identical whether it shows up in a donut slice, a
 * table badge, or a KPI, which is what makes the pages feel like one product.
 */
import type { BadgeProps } from "@/components/ui/badge";

type BadgeVariant = NonNullable<BadgeProps["variant"]>;

export interface Meta {
  label: string;
  /** CSS var reference for charts, e.g. "var(--chart-1)". */
  color: string;
  badge: BadgeVariant;
}

export const CLASSIFICATION_META: Record<string, Meta> = {
  exact: { label: "Exact", color: "var(--chart-1)", badge: "success" },
  underpayment: { label: "Underpayment", color: "var(--chart-3)", badge: "warning" },
  overpayment: { label: "Overpayment", color: "var(--chart-2)", badge: "info" },
  duplicate: { label: "Duplicate", color: "var(--chart-4)", badge: "muted" },
  orphan: { label: "Orphan", color: "var(--chart-5)", badge: "destructive" },
};

export const INVOICE_STATUS_META: Record<string, Meta> = {
  settled: { label: "Settled", color: "var(--chart-1)", badge: "success" },
  partially_paid: { label: "Partially paid", color: "var(--chart-3)", badge: "warning" },
  open: { label: "Open", color: "var(--chart-4)", badge: "muted" },
  overpaid: { label: "Overpaid", color: "var(--chart-2)", badge: "info" },
};

export const PAYMENT_STATUS_META: Record<string, Meta> = {
  reconciled: { label: "Reconciled", color: "var(--chart-1)", badge: "success" },
  in_exception: { label: "In exception", color: "var(--chart-5)", badge: "warning" },
  refunded: { label: "Refunded", color: "var(--chart-2)", badge: "info" },
};

export const VERTICAL_META: Record<string, Meta> = {
  rent: { label: "Rent", color: "var(--chart-2)", badge: "info" },
  school: { label: "School fees", color: "var(--chart-3)", badge: "warning" },
  ajo: { label: "Ajo / Thrift", color: "var(--chart-1)", badge: "success" },
  generic: { label: "Generic", color: "var(--chart-4)", badge: "muted" },
};

const titleCase = (value: string) =>
  value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

export function metaFor(
  table: Record<string, Meta>,
  key: string,
): Meta {
  return (
    table[key] ?? { label: titleCase(key), color: "var(--chart-4)", badge: "muted" }
  );
}
