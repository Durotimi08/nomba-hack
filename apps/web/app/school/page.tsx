"use client";

import { useState } from "react";
import { Loader2, Receipt, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/PageHeader";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatNaira } from "@/lib/format";
import { usePromoteCohort, useRunBilling, useDefaulters } from "@/lib/hooks";
import { Pagination } from "@/components/Pagination";
import type { BillingFrequency } from "@/lib/types";

const DEFAULTERS_PAGE = 20;

export default function SchoolCollectionsPage() {
  const [cohort, setCohort] = useState("JSS1");
  const [offset, setOffset] = useState(0);
  const [showBilling, setShowBilling] = useState(false);
  const [showPromote, setShowPromote] = useState(false);
  const { data, isLoading, isError, error, refetch } = useDefaulters(cohort, {
    limit: DEFAULTERS_PAGE,
    offset,
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Collections"
        description="Fee collection and defaulters per cohort — derived from the Kobo ledger."
        action={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setShowPromote(true)}>
              Promote
            </Button>
            <Button onClick={() => setShowBilling(true)}>
              <Receipt className="size-4" /> Run billing
            </Button>
          </div>
        }
      />

      <div className="flex items-end gap-2">
        <div className="grid gap-1.5">
          <Label htmlFor="cohort">Cohort</Label>
          <Input
            id="cohort"
            value={cohort}
            onChange={(e) => {
              setCohort(e.target.value);
              setOffset(0);
            }}
            placeholder="JSS1"
            className="w-40"
          />
        </div>
      </div>

      {isLoading ? (
        <div className="flex h-48 items-center justify-center">
          <Spinner className="h-6 w-6 text-primary" />
        </div>
      ) : isError || !data ? (
        <Card>
          <ErrorState
            message={error instanceof Error ? error.message : "Could not load collections."}
            onRetry={() => void refetch()}
          />
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Card>
              <CardContent className="pt-5">
                <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                  Collection rate
                </p>
                <p className="mt-2 flex items-baseline gap-1.5 text-3xl font-semibold tabular-nums text-emerald-600">
                  {data.collectionRate}%
                  <TrendingUp className="size-4 text-emerald-500" />
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {formatNaira(data.collectedKobo)} of {formatNaira(data.billedKobo)}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-5">
                <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                  Outstanding
                </p>
                <p className="mt-2 text-3xl font-semibold tabular-nums text-amber-600">
                  {formatNaira(
                    (BigInt(data.billedKobo) - BigInt(data.collectedKobo)).toString(),
                  )}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">Still to be collected</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-5">
                <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                  Defaulters
                </p>
                <p className="mt-2 text-3xl font-semibold tabular-nums text-foreground">
                  {data.defaulters.length}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">Students owing in {cohort}</p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Defaulters</CardTitle>
              <CardDescription>Students with an outstanding balance, largest first.</CardDescription>
            </CardHeader>
            <CardContent className="px-0 pb-2">
              {data.defaulters.length === 0 ? (
                <EmptyState
                  title="Everyone's paid up"
                  hint={`No outstanding balances in ${cohort}.`}
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="pl-5">Student</TableHead>
                      <TableHead className="pr-5 text-right">Outstanding</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.defaulters.map((d) => (
                      <TableRow key={d.id}>
                        <TableCell className="pl-5 font-medium">{d.name}</TableCell>
                        <TableCell className="pr-5 text-right tabular-nums text-amber-600">
                          {formatNaira(d.outstandingKobo)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
              <Pagination
                total={data.defaultersTotal}
                limit={DEFAULTERS_PAGE}
                offset={offset}
                onChange={setOffset}
              />
            </CardContent>
          </Card>
        </>
      )}

      {showBilling ? (
        <RunBillingDialog cohort={cohort} onClose={() => setShowBilling(false)} />
      ) : null}
      {showPromote ? (
        <PromoteDialog cohort={cohort} onClose={() => setShowPromote(false)} />
      ) : null}
    </div>
  );
}

const FREQ_PERIOD_HINT: Record<BillingFrequency, string> = {
  monthly: "2026-01",
  termly: "2026-T1",
  annually: "2026",
};

function RunBillingDialog({ cohort, onClose }: { cohort: string; onClose: () => void }) {
  const run = useRunBilling();
  const [frequency, setFrequency] = useState<BillingFrequency>("termly");
  const [period, setPeriod] = useState("2026-T1");

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    run.mutate(
      { cohort, frequency, period: period.trim() },
      {
        onSuccess: (res) => {
          if (res.invoicesCreated === 0) {
            toast.warning(
              res.studentsBilled === 0
                ? `No students in ${cohort} yet — onboard a roster first.`
                : `Already billed for ${res.reference} (nothing new).`,
            );
          } else if (res.totalExpectedKobo === "0") {
            toast.warning(
              `Billed ${res.invoicesCreated} student(s) at ₦0 — add a Tuition fee under Fees & discounts.`,
            );
          } else {
            toast.success(
              `Billed ${res.invoicesCreated} student(s) · ${formatNaira(res.totalExpectedKobo)} expected`,
            );
          }
          onClose();
        },
        onError: (err) => toast.error(err instanceof Error ? err.message : "Billing failed"),
      },
    );
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Run billing</DialogTitle>
          <DialogDescription>
            One invoice per student in <b>{cohort}</b>. Only <b>{frequency === "termly" ? "per-term" : frequency}</b> fees
            are charged this run (plus any pending one-time fees). The amounts come from the cohort&apos;s
            <b> fee rules</b>.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="frequency">Frequency</Label>
              <select
                id="frequency"
                className="h-9 rounded-md border border-input bg-transparent px-2 text-sm shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={frequency}
                onChange={(e) => {
                  const f = e.target.value as BillingFrequency;
                  setFrequency(f);
                  setPeriod(FREQ_PERIOD_HINT[f]);
                }}
              >
                <option value="monthly">Monthly</option>
                <option value="termly">Per term</option>
                <option value="annually">Annually</option>
              </select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="period">Period</Label>
              <Input
                id="period"
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
                placeholder={FREQ_PERIOD_HINT[frequency]}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={run.isPending}>
              {run.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
              Generate invoices
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PromoteDialog({ cohort, onClose }: { cohort: string; onClose: () => void }) {
  const promote = usePromoteCohort();
  const [to, setTo] = useState("");

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    promote.mutate(
      { from: cohort, to: to.trim() },
      {
        onSuccess: (res) => {
          toast.success(`Moved ${res.moved} student(s): ${cohort} → ${to.trim()}`);
          onClose();
        },
        onError: (err) => toast.error(err instanceof Error ? err.message : "Promotion failed"),
      },
    );
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Promote cohort</DialogTitle>
          <DialogDescription>
            Relabel every student in <b>{cohort}</b>. Their accounts, tags and credit carry over.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="to">New cohort</Label>
            <Input id="to" value={to} onChange={(e) => setTo(e.target.value)} placeholder="JSS2" required />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={promote.isPending || to.trim().length === 0}>
              {promote.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
              Promote
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
