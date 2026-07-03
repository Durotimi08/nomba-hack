import { Badge } from "@/components/ui/badge";
import {
  CLASSIFICATION_META,
  INVOICE_STATUS_META,
  PAYMENT_STATUS_META,
  VERTICAL_META,
  metaFor,
} from "@/lib/domain";

export function InvoiceStatusBadge({ status }: { status: string }) {
  const m = metaFor(INVOICE_STATUS_META, status);
  return <Badge variant={m.badge}>{m.label}</Badge>;
}

export function ClassificationBadge({ value }: { value: string }) {
  const m = metaFor(CLASSIFICATION_META, value);
  return <Badge variant={m.badge}>{m.label}</Badge>;
}

export function VerticalBadge({ vertical }: { vertical: string }) {
  const m = metaFor(VERTICAL_META, vertical);
  return <Badge variant={m.badge}>{m.label}</Badge>;
}

export function PaymentStatusBadge({ status }: { status: string }) {
  const m = metaFor(PAYMENT_STATUS_META, status);
  return <Badge variant={m.badge}>{m.label}</Badge>;
}

/** Back-compat alias used by the statement payments table. */
export const StatusBadge = PaymentStatusBadge;
