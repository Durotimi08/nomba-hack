"use client";

import Link from "next/link";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useApproveRefund, useRefunds } from "@/lib/hooks";
import { formatNaira } from "@/lib/format";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Pagination } from "./Pagination";
import { EmptyState, ErrorState, LoadingRow } from "./States";

const PAGE_SIZE = 20;

export function PendingRefunds({
  limit,
  viewAllHref,
}: {
  limit?: number;
  viewAllHref?: string;
}) {
  const { session } = useAuth();
  const [offset, setOffset] = useState(0);

  const [status, setStatus] = useState<"pending_approval" | "failed">("pending_approval");
  const { data, isLoading, isError, error, refetch } = useRefunds(
    status,
    limit ? undefined : { limit: PAGE_SIZE, offset },
  );
  const approve = useApproveRefund();
  const [pendingId, setPendingId] = useState<string | null>(null);

  const isMaker = session?.role === "maker";
  const isFailed = status === "failed";
  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const rows = limit ? items.slice(0, limit) : items;

  function switchStatus(next: "pending_approval" | "failed") {
    setStatus(next);
    setOffset(0);
  }

  function onApprove(id: string) {
    setPendingId(id);
    approve.mutate(id, {
      onSuccess: () =>
        toast.success(isFailed ? "Retry enqueued — reprocessing payout" : "Refund approved — payout enqueued"),
      onError: (err) => {
        let message = "Failed to approve refund.";
        if (err instanceof ApiError) {
          message =
            err.status === 409
              ? "Maker-checker: a different operator must approve this refund."
              : err.message;
        }
        toast.error(message);
      },
      onSettled: () => setPendingId(null),
    });
  }

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between">
        <div className="space-y-1">
          <CardTitle>{isFailed ? "Failed refunds" : "Pending refunds"}</CardTitle>
          <CardDescription>
            {isFailed
              ? "Payouts that were rejected (e.g. insufficient balance). Re-approve to retry."
              : "Maker-checker controlled. A checker — not the proposer — approves before payout."}
          </CardDescription>
        </div>
        <CardAction className="flex items-center gap-2">
          {isMaker ? <Badge variant="warning">View-only as maker</Badge> : null}
          {!limit ? (
            <div className="flex items-center gap-0.5 rounded-md border border-border p-0.5">
              <Button
                variant={isFailed ? "ghost" : "secondary"}
                size="sm"
                className="h-7 px-2.5 text-xs"
                onClick={() => switchStatus("pending_approval")}
              >
                Pending
              </Button>
              <Button
                variant={isFailed ? "secondary" : "ghost"}
                size="sm"
                className="h-7 px-2.5 text-xs"
                onClick={() => switchStatus("failed")}
              >
                Failed
              </Button>
            </div>
          ) : null}
          {viewAllHref && total > (limit ?? 0) ? (
            <Button asChild variant="ghost" size="sm">
              <Link href={viewAllHref}>View all</Link>
            </Button>
          ) : null}
        </CardAction>
      </CardHeader>

      {isLoading ? (
        <LoadingRow label="Loading refunds…" />
      ) : isError ? (
        <ErrorState
          message={
            error instanceof Error ? error.message : "Could not load refunds."
          }
          onRetry={() => void refetch()}
        />
      ) : rows.length === 0 ? (
        <EmptyState
          title={isFailed ? "No failed refunds" : "No refunds awaiting approval"}
          hint={
            isFailed
              ? "Payouts that fail (e.g. insufficient balance) show here to retry."
              : "Proposed refunds appear here for checker sign-off."
          }
        />
      ) : (
        <CardContent className="px-0 pb-2">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-5">Customer</TableHead>
                <TableHead>Merchant tx ref</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="pr-5 text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="pl-5">
                    <Link
                      href={`/customers/${r.customerId}`}
                      className="font-medium text-primary hover:underline"
                    >
                      {r.customerName}
                    </Link>
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {r.merchantTxRef}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatNaira(r.amountKobo)}
                  </TableCell>
                  <TableCell className="pr-5 text-right">
                    {isMaker ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span tabIndex={0}>
                            <Button size="sm" disabled>
                              {isFailed ? "Retry" : "Approve"}
                            </Button>
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>
                          Sign in as a checker to {isFailed ? "retry payouts" : "approve refunds"}.
                        </TooltipContent>
                      </Tooltip>
                    ) : (
                      <Button
                        size="sm"
                        variant={isFailed ? "outline" : "default"}
                        onClick={() => onApprove(r.id)}
                        disabled={pendingId === r.id}
                      >
                        {pendingId === r.id ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : null}
                        {isFailed ? "Retry payout" : "Approve"}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {!limit ? (
            <Pagination total={total} limit={PAGE_SIZE} offset={offset} onChange={setOffset} />
          ) : null}
        </CardContent>
      )}
    </Card>
  );
}
