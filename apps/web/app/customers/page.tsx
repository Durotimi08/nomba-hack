"use client";

import Link from "next/link";
import { useState } from "react";
import { ChevronRight, FileText, Users, Wallet } from "lucide-react";
import { VerticalBadge } from "@/components/Badge";
import { ReceivableBars } from "@/components/dashboard/charts";
import { KpiCard } from "@/components/KpiCard";
import { Pagination } from "@/components/Pagination";
import { NewCustomerModal } from "@/components/NewCustomerModal";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState, ErrorState, LoadingRow } from "@/components/States";
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
import { formatNaira } from "@/lib/format";
import { useCustomers } from "@/lib/hooks";

function sumKobo(values: string[]): string {
  return values
    .reduce((acc, v) => {
      try {
        return acc + BigInt(v || "0");
      } catch {
        return acc;
      }
    }, 0n)
    .toString();
}

const PAGE = 20;

export default function CustomersPage() {
  const [offset, setOffset] = useState(0);
  const { data, isLoading, isError, error, refetch } = useCustomers({ limit: PAGE, offset });
  const [showModal, setShowModal] = useState(false);

  const customers = data?.items ?? [];
  const totalReceivable = sumKobo(customers.map((c) => c.balanceKobo));
  const openInvoices = customers.reduce((a, c) => a + c.openInvoiceCount, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Customers"
        description="Each customer holds a dedicated virtual account for inbound collections."
        action={
          <Button onClick={() => setShowModal(true)}>
            <span className="text-base leading-none">+</span> New customer
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KpiCard
          label="Customers"
          value={data ? String(data.total) : "—"}
          hint="With provisioned accounts"
          icon={Users}
        />
        <KpiCard
          label="Total receivable"
          value={data ? formatNaira(totalReceivable) : "—"}
          hint="Outstanding across open invoices"
          icon={Wallet}
        />
        <KpiCard
          label="Open invoices"
          value={data ? String(openInvoices) : "—"}
          hint="Awaiting settlement"
          icon={FileText}
        />
      </div>

      {customers.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Receivable by customer</CardTitle>
            <CardDescription>Top outstanding balances on this page</CardDescription>
          </CardHeader>
          <CardContent>
            <ReceivableBars customers={customers} />
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">All customers</CardTitle>
          <CardDescription>Open a customer to see their statement and ledger.</CardDescription>
        </CardHeader>
        <CardContent className="px-0 pb-2">
          {isLoading ? (
            <LoadingRow label="Loading customers…" />
          ) : isError ? (
            <ErrorState
              message={
                error instanceof Error ? error.message : "Could not load customers."
              }
              onRetry={() => void refetch()}
            />
          ) : customers.length === 0 ? (
            <EmptyState
              title="No customers yet"
              hint="Create your first customer to provision a virtual account."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-5">Customer</TableHead>
                  <TableHead>Vertical</TableHead>
                  <TableHead>Account ref</TableHead>
                  <TableHead>Virtual account</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                  <TableHead className="text-right">Open</TableHead>
                  <TableHead className="pr-5" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {customers.map((c) => (
                  <TableRow key={c.id} className="group cursor-pointer">
                    <TableCell className="pl-5">
                      <Link
                        href={`/customers/${c.id}`}
                        className="font-medium text-foreground hover:text-primary"
                      >
                        {c.name}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <VerticalBadge vertical={c.vertical} />
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {c.accountRef}
                    </TableCell>
                    <TableCell>
                      {c.bankAccountNumber ? (
                        <div>
                          <span className="font-mono text-foreground">
                            {c.bankAccountNumber}
                          </span>
                          {c.bankName ? (
                            <span className="block text-xs text-muted-foreground">
                              {c.bankName}
                            </span>
                          ) : null}
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          Provisioning…
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatNaira(c.balanceKobo)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {c.openInvoiceCount}
                    </TableCell>
                    <TableCell className="pr-5 text-right">
                      <Link href={`/customers/${c.id}`}>
                        <ChevronRight className="ml-auto size-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <Pagination total={data?.total ?? 0} limit={PAGE} offset={offset} onChange={setOffset} />
        </CardContent>
      </Card>

      {showModal ? (
        <NewCustomerModal onClose={() => setShowModal(false)} />
      ) : null}
    </div>
  );
}
