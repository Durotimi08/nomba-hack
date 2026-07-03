"use client";

import { useState } from "react";
import { Loader2, Plus, Tag } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/PageHeader";
import { Pagination } from "@/components/Pagination";
import { EmptyState, ErrorState, Spinner } from "@/components/States";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import { useCreateRule, useRules, useTags } from "@/lib/hooks";
import type { CreateRuleInput, RuleRecurrence, RuleValueType, SchoolRule } from "@/lib/types";

const SELECT =
  "h-9 rounded-md border border-input bg-transparent px-2 text-sm shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";

function ruleValue(r: SchoolRule): string {
  return r.valueType === "percent" ? `${Number(r.value) / 100}%` : formatNaira(r.value);
}

const RECURRENCE_LABEL: Record<SchoolRule["recurrence"], string> = {
  one_time: "one-time",
  monthly: "monthly",
  termly: "per term",
  annually: "annually",
};

function matchLabel(match: Record<string, unknown>): string {
  const parts = Object.entries(match).map(([k, v]) => `${k}=${String(v)}`);
  return parts.length ? parts.join(", ") : "everyone";
}

function parseMatch(text: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const tag of text.split(",").map((s) => s.trim()).filter(Boolean)) {
    if (tag.includes("=")) {
      const [k, v] = tag.split("=").map((s) => s.trim());
      out[k!] = v === "true" ? true : v === "false" ? false : v!;
    } else {
      out[tag] = true;
    }
  }
  return out;
}

const RULES_PAGE = 20;

export default function RulesPage() {
  const [cohort, setCohort] = useState("JSS1");
  const [offset, setOffset] = useState(0);
  const [showFee, setShowFee] = useState(false);
  const [showDiscount, setShowDiscount] = useState(false);
  const { data, isLoading, isError, error, refetch } = useRules(cohort || undefined, {
    limit: RULES_PAGE,
    offset,
  });
  const items = data?.items ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Fees & discounts"
        description="Fees stack into the bill; the single best discount a student qualifies for is applied."
        action={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setShowDiscount(true)}>
              <Tag className="size-4" /> New discount
            </Button>
            <Button onClick={() => setShowFee(true)}>
              <Plus className="size-4" /> New fee
            </Button>
          </div>
        }
      />

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

      <Card>
        <CardContent className="px-0 py-0">
          {isLoading ? (
            <div className="flex h-40 items-center justify-center">
              <Spinner className="h-6 w-6 text-primary" />
            </div>
          ) : isError || !data ? (
            <ErrorState
              message={error instanceof Error ? error.message : "Could not load rules."}
              onRetry={() => void refetch()}
            />
          ) : items.length === 0 ? (
            <EmptyState title="No rules yet" hint="Add a tuition fee, then any discounts." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-5">Name</TableHead>
                  <TableHead>Kind</TableHead>
                  <TableHead className="text-right">Value</TableHead>
                  <TableHead>Recurrence</TableHead>
                  <TableHead className="pr-5">Applies to</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="pl-5 font-medium">{r.name}</TableCell>
                    <TableCell
                      className={r.kind === "discount" ? "text-emerald-600" : "text-foreground"}
                    >
                      {r.kind === "discount" ? "discount" : "fee"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{ruleValue(r)}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {RECURRENCE_LABEL[r.recurrence]}
                    </TableCell>
                    <TableCell className="pr-5 text-muted-foreground">{matchLabel(r.match)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <Pagination total={data?.total ?? 0} limit={RULES_PAGE} offset={offset} onChange={setOffset} />
        </CardContent>
      </Card>

      {showFee ? <FeeDialog cohort={cohort} onClose={() => setShowFee(false)} /> : null}
      {showDiscount ? <DiscountDialog cohort={cohort} onClose={() => setShowDiscount(false)} /> : null}
    </div>
  );
}

/** Shared fields used by both dialogs. */
function RuleFields(props: {
  name: string;
  setName: (v: string) => void;
  amountLabel: string;
  amount: string;
  setAmount: (v: string) => void;
  amountPlaceholder: string;
  recurrence: RuleRecurrence;
  setRecurrence: (v: RuleRecurrence) => void;
  match: string;
  setMatch: (v: string) => void;
  cohort: string;
  tags: string[];
  extra?: React.ReactNode;
}) {
  const [custom, setCustom] = useState(false);
  return (
    <>
      <div className="grid gap-2">
        <Label htmlFor="rule-name">Name</Label>
        <Input
          id="rule-name"
          value={props.name}
          onChange={(e) => props.setName(e.target.value)}
          required
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        {props.extra}
        <div className="grid gap-2">
          <Label htmlFor="rule-amount">{props.amountLabel}</Label>
          <Input
            id="rule-amount"
            type="number"
            min="0"
            step="0.01"
            value={props.amount}
            onChange={(e) => props.setAmount(e.target.value)}
            placeholder={props.amountPlaceholder}
            required
            className="tabular-nums"
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="rule-rec">Frequency</Label>
          <select
            id="rule-rec"
            className={SELECT}
            value={props.recurrence}
            onChange={(e) => props.setRecurrence(e.target.value as RuleRecurrence)}
          >
            <option value="monthly">Monthly</option>
            <option value="termly">Per term</option>
            <option value="annually">Annually</option>
            <option value="one_time">One-time</option>
          </select>
        </div>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="rule-match">Apply to</Label>
        <select
          id="rule-match"
          className={SELECT}
          value={custom ? "__custom__" : props.match}
          onChange={(e) => {
            const v = e.target.value;
            if (v === "__custom__") {
              setCustom(true);
              props.setMatch("");
            } else {
              setCustom(false);
              props.setMatch(v);
            }
          }}
        >
          <option value="">Everyone in {props.cohort || "the cohort"}</option>
          {props.tags.map((t) => (
            <option key={t} value={t}>
              Students tagged “{t}”
            </option>
          ))}
          <option value="__custom__">Custom tag…</option>
        </select>
        {custom ? (
          <Input
            value={props.match}
            onChange={(e) => props.setMatch(e.target.value)}
            placeholder="scholarship  ·  or  house=Blue"
          />
        ) : (
          <p className="text-xs text-muted-foreground">
            Tags come from the roster (e.g. “scholarship”). Tag students on the Students page first.
          </p>
        )}
      </div>
    </>
  );
}

function FeeDialog({ cohort, onClose }: { cohort: string; onClose: () => void }) {
  const create = useCreateRule();
  const { data: tags } = useTags(cohort || undefined);
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [recurrence, setRecurrence] = useState<RuleRecurrence>("termly");
  const [match, setMatch] = useState("");

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      toast.error("Enter an amount greater than zero");
      return;
    }
    const input: CreateRuleInput = {
      name: name.trim(),
      kind: "charge",
      valueType: "fixed",
      amount: amt,
      recurrence,
      ...(cohort ? { cohort } : {}),
      ...(match.trim() ? { match: parseMatch(match) } : {}),
    };
    create.mutate(input, {
      onSuccess: () => {
        toast.success("Fee created");
        onClose();
      },
      onError: (err) => toast.error(err instanceof Error ? err.message : "Could not create fee"),
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New fee</DialogTitle>
          <DialogDescription>
            A charge in <b>{cohort || "any cohort"}</b> (e.g. Tuition). Fees stack into the bill.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <RuleFields
            name={name}
            setName={setName}
            amountLabel="Amount (₦)"
            amount={amount}
            setAmount={setAmount}
            amountPlaceholder="55000"
            recurrence={recurrence}
            setRecurrence={setRecurrence}
            match={match}
            setMatch={setMatch}
            cohort={cohort}
            tags={tags ?? []}
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={create.isPending || name.trim().length === 0}>
              {create.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
              Create fee
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DiscountDialog({ cohort, onClose }: { cohort: string; onClose: () => void }) {
  const create = useCreateRule();
  const { data: tags } = useTags(cohort || undefined);
  const [name, setName] = useState("");
  const [valueType, setValueType] = useState<RuleValueType>("percent");
  const [amount, setAmount] = useState("");
  const [recurrence, setRecurrence] = useState<RuleRecurrence>("termly");
  const [match, setMatch] = useState("");

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      toast.error("Enter an amount greater than zero");
      return;
    }
    const input: CreateRuleInput = {
      name: name.trim(),
      kind: "discount",
      valueType,
      amount: amt,
      recurrence,
      ...(cohort ? { cohort } : {}),
      ...(match.trim() ? { match: parseMatch(match) } : {}),
    };
    create.mutate(input, {
      onSuccess: () => {
        toast.success("Discount created");
        onClose();
      },
      onError: (err) => toast.error(err instanceof Error ? err.message : "Could not create discount"),
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New discount</DialogTitle>
          <DialogDescription>
            For <b>{cohort || "any cohort"}</b>. Only the single largest discount a student
            qualifies for is applied — discounts don&apos;t stack.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <RuleFields
            name={name}
            setName={setName}
            amountLabel={valueType === "percent" ? "Percent (%)" : "Amount (₦)"}
            amount={amount}
            setAmount={setAmount}
            amountPlaceholder={valueType === "percent" ? "20" : "5000"}
            recurrence={recurrence}
            setRecurrence={setRecurrence}
            match={match}
            setMatch={setMatch}
            cohort={cohort}
            tags={tags ?? []}
            extra={
              <div className="grid gap-2">
                <Label htmlFor="disc-vt">Type</Label>
                <select
                  id="disc-vt"
                  className={SELECT}
                  value={valueType}
                  onChange={(e) => setValueType(e.target.value as RuleValueType)}
                >
                  <option value="percent">Percent (%)</option>
                  <option value="fixed">Fixed (₦)</option>
                </select>
              </div>
            }
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={create.isPending || name.trim().length === 0}>
              {create.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
              Create discount
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
