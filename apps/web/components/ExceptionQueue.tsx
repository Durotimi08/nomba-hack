"use client";

import Link from "next/link";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ApiError } from "@/lib/api";
import { useExceptions, useResolveException } from "@/lib/hooks";
import { formatHours, formatNaira } from "@/lib/format";
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
import { Pagination } from "./Pagination";
import { ReattributeDialog } from "./ReattributeDialog";
import { EmptyState, ErrorState, LoadingRow } from "./States";

const PAGE_SIZE = 20;

export function ExceptionQueue({
  limit,
  viewAllHref,
}: {
  limit?: number;
  viewAllHref?: string;
}) {
  const [offset, setOffset] = useState(0);
  // Preview mode (limit set) fetches a default page and slices; full mode paginates.
  const { data, isLoading, isError, error, refetch } = useExceptions(
    "open",
    limit ? undefined : { limit: PAGE_SIZE, offset },
  );
  const resolve = useResolveException();
  const [pendingId, setPendingId] = useState<string | null>(null);

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const rows = limit ? items.slice(0, limit) : items;

  function onResolve(id: string) {
    setPendingId(id);
    resolve.mutate(id, {
      onSuccess: () => toast.success("Break resolved"),
      onError: (err) =>
        toast.error(
          err instanceof ApiError ? err.message : "Failed to resolve break.",
        ),
      onSettled: () => setPendingId(null),
    });
  }

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between">
        <div className="space-y-1">
          <CardTitle>Exception queue</CardTitle>
          <CardDescription>
            Unmatched and ambiguous payments awaiting a decision.
          </CardDescription>
        </div>
        <CardAction className="flex items-center gap-2">
          {total > 0 ? (
            <Badge variant="destructive">{total} open</Badge>
          ) : null}
          {viewAllHref && total > (limit ?? 0) ? (
            <Button asChild variant="ghost" size="sm">
              <Link href={viewAllHref}>View all</Link>
            </Button>
          ) : null}
        </CardAction>
      </CardHeader>

      {isLoading ? (
        <LoadingRow label="Loading exceptions…" />
      ) : isError ? (
        <ErrorState
          message={
            error instanceof Error ? error.message : "Could not load exceptions."
          }
          onRetry={() => void refetch()}
        />
      ) : rows.length === 0 ? (
        <EmptyState
          title="No open breaks"
          hint="Every payment has been reconciled. Nice and tidy."
        />
      ) : (
        <CardContent className="px-0 pb-2">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-5">Reason</TableHead>
                <TableHead>Sender</TableHead>
                <TableHead className="text-right">Gross</TableHead>
                <TableHead className="text-right">Materiality</TableHead>
                <TableHead className="text-right">Age</TableHead>
                <TableHead className="pr-5 text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((ex) => (
                <TableRow key={ex.id}>
                  <TableCell className="pl-5">
                    <Badge variant={ex.reason === "orphan" ? "destructive" : "warning"}>
                      {ex.reason.replace(/_/g, " ")}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {ex.senderName ?? "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatNaira(ex.grossKobo)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {formatNaira(ex.materialityKobo)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {formatHours(ex.ageHours)}
                  </TableCell>
                  <TableCell className="pr-5 text-right">
                    <div className="flex items-center justify-end gap-2">
                      {ex.reason === "orphan" ? (
                        <ReattributeDialog exception={ex} />
                      ) : null}
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => onResolve(ex.id)}
                        disabled={pendingId === ex.id}
                      >
                        {pendingId === ex.id ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : null}
                        Resolve
                      </Button>
                    </div>
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
