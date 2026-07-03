"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { ApiError } from "@/lib/api";
import { useCreateInvoice } from "@/lib/hooks";
import { Button } from "@/components/ui/button";
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

export function NewInvoiceModal({
  customerId,
  onClose,
}: {
  customerId: string;
  onClose: () => void;
}) {
  const create = useCreateInvoice(customerId);
  const [reference, setReference] = useState("");
  const [amount, setAmount] = useState("");
  const [period, setPeriod] = useState("");
  const [error, setError] = useState<string | null>(null);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const amountExpected = Number(amount);
    if (!Number.isFinite(amountExpected) || amountExpected <= 0) {
      setError("Enter an amount greater than zero.");
      return;
    }
    const trimmedPeriod = period.trim();
    create.mutate(
      {
        reference: reference.trim(),
        amountExpected,
        ...(trimmedPeriod ? { period: trimmedPeriod } : {}),
      },
      {
        onSuccess: () => {
          toast.success("Invoice created");
          onClose();
        },
        onError: (err) =>
          setError(
            err instanceof ApiError ? err.message : "Could not create invoice.",
          ),
      },
    );
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New invoice</DialogTitle>
          <DialogDescription>
            Amounts are entered in naira and stored as integer kobo.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="inv-ref">Reference</Label>
            <Input
              id="inv-ref"
              required
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="e.g. RENT-2026-07"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="inv-amount">Amount expected (₦)</Label>
            <Input
              id="inv-amount"
              type="number"
              min="0"
              step="0.01"
              required
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="50000"
              className="tabular-nums"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="inv-period">
              Period{" "}
              <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="inv-period"
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              placeholder="2026-07"
            />
          </div>

          {error ? (
            <p className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {error}
            </p>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={create.isPending || reference.trim().length === 0}
            >
              {create.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : null}
              Create invoice
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
