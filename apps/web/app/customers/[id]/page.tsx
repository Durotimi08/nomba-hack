"use client";

import Link from "next/link";
import { use, useState } from "react";
import { ArrowLeft, Plus } from "lucide-react";
import {
  ClassificationBadge,
  InvoiceStatusBadge,
  StatusBadge,
  VerticalBadge,
} from "@/components/Badge";
import { StatementTimeline } from "@/components/dashboard/charts";
import { NewInvoiceModal } from "@/components/NewInvoiceModal";
import { EmptyState, ErrorState, Spinner } from "@/components/States";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDate, formatDateTime, formatNaira } from "@/lib/format";
import { useStatement } from "@/lib/hooks";

export default function StatementPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { data, isLoading, isError, error, refetch } = useStatement(id);
  const [showNewInvoice, setShowNewInvoice] = useState(false);

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Spinner className="h-6 w-6 text-primary" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="space-y-4">
        <BackLink />
        <Card>
          <ErrorState
            message={
              error instanceof Error ? error.message : "Could not load statement."
            }
            onRetry={() => void refetch()}
          />
        </Card>
      </div>
    );
  }

  const { customer, virtualAccount, invoices, payments, ledger, balances } = data;

  return (
    <div className="space-y-6">
      <BackLink />

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-medium tracking-[-0.01em] text-foreground">
            {customer.name}
          </h1>
          <VerticalBadge vertical={customer.vertical} />
        </div>
        <Button onClick={() => setShowNewInvoice(true)}>
          <Plus className="size-4" /> New invoice
        </Button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card>
          <CardContent className="pt-5">
            <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
              Dedicated virtual account
            </p>
            {virtualAccount ? (
              <>
                <p className="mt-2 font-mono text-2xl font-semibold tabular-nums text-foreground">
                  {virtualAccount.bankAccountNumber}
                </p>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {virtualAccount.bankName}
                </p>
              </>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">
                No virtual account provisioned.
              </p>
            )}
            <p className="mt-3 text-xs text-muted-foreground">
              Ref{" "}
              <span className="font-mono text-foreground">
                {customer.accountRef}
              </span>
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-5">
            <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
              Receivable
            </p>
            <p className="mt-2 text-2xl font-semibold tabular-nums text-amber-600">
              {formatNaira(balances.receivableKobo)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Outstanding across open invoices
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-5">
            <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
              Credit balance
            </p>
            <p className="mt-2 text-2xl font-semibold tabular-nums text-blue-600">
              {formatNaira(balances.creditKobo)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Overpayments held on account
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Settlement timeline */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Settlement timeline</CardTitle>
          <CardDescription>
            Cumulative net settled into this account over time.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <StatementTimeline payments={payments} />
        </CardContent>
      </Card>

      {/* Invoices */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Invoices</CardTitle>
          <CardDescription>
            Amounts expected and settled per billing period.
          </CardDescription>
        </CardHeader>
        <CardContent className="px-0 pb-2">
          {invoices.length === 0 ? (
            <EmptyState title="No invoices" hint="Nothing has been billed yet." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-5">Reference</TableHead>
                  <TableHead>Period</TableHead>
                  <TableHead className="text-right">Expected</TableHead>
                  <TableHead className="text-right">Settled</TableHead>
                  <TableHead className="pr-5">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoices.map((inv) => (
                  <TableRow key={inv.id}>
                    <TableCell className="pl-5 font-mono text-xs text-muted-foreground">
                      {inv.reference}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {inv.period}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatNaira(inv.amountExpectedKobo)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatNaira(inv.amountSettledKobo)}
                    </TableCell>
                    <TableCell className="pr-5">
                      <InvoiceStatusBadge status={inv.status} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Payments */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Payments</CardTitle>
          <CardDescription>
            Inbound settlements with reconciliation classification.
          </CardDescription>
        </CardHeader>
        <CardContent className="px-0 pb-2">
          {payments.length === 0 ? (
            <EmptyState
              title="No payments"
              hint="Inbound transfers to the virtual account will appear here."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-5">Sender</TableHead>
                  <TableHead>When</TableHead>
                  <TableHead className="text-right">Gross</TableHead>
                  <TableHead className="text-right">Fee</TableHead>
                  <TableHead className="text-right">Net</TableHead>
                  <TableHead>Classification</TableHead>
                  <TableHead className="pr-5">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {payments.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="pl-5 text-foreground">
                      {p.senderName ?? "—"}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {p.occurredAt ? formatDateTime(p.occurredAt) : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {formatNaira(p.grossKobo)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {formatNaira(p.feeKobo)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-medium">
                      {formatNaira(p.netKobo)}
                    </TableCell>
                    <TableCell>
                      <ClassificationBadge value={p.classification} />
                    </TableCell>
                    <TableCell className="pr-5">
                      <StatusBadge status={p.status} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Ledger */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Ledger audit trail</CardTitle>
          <CardDescription>
            Double-entry record — every kobo explained.
          </CardDescription>
        </CardHeader>
        <CardContent className="px-0 pb-2">
          {ledger.length === 0 ? (
            <EmptyState
              title="No ledger entries"
              hint="Postings appear as payments are reconciled."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-5">Account</TableHead>
                  <TableHead>When</TableHead>
                  <TableHead className="text-right">Debit</TableHead>
                  <TableHead className="pr-5 text-right">Credit</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ledger.map((entry, i) => (
                  <TableRow key={`${entry.account}-${i}`}>
                    <TableCell className="pl-5 font-mono text-xs text-foreground">
                      {entry.account}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatDate(entry.createdAt)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {entry.direction === "debit"
                        ? formatNaira(entry.amountKobo)
                        : "—"}
                    </TableCell>
                    <TableCell className="pr-5 text-right tabular-nums text-muted-foreground">
                      {entry.direction === "credit"
                        ? formatNaira(entry.amountKobo)
                        : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {showNewInvoice ? (
        <NewInvoiceModal customerId={id} onClose={() => setShowNewInvoice(false)} />
      ) : null}
    </div>
  );
}

function BackLink() {
  return (
    <Link
      href="/customers"
      className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
    >
      <ArrowLeft className="size-4" /> Back to customers
    </Link>
  );
}
