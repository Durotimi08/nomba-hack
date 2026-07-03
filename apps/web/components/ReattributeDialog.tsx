"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { ApiError } from "@/lib/api";
import { useCustomers, useReattributeException } from "@/lib/hooks";
import { formatNaira } from "@/lib/format";
import type { Exception } from "@/lib/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * Re-attribute an orphan: move parked suspense money into a customer's credit
 * balance. The customer Select is fed by the live customer list, so the action
 * threads two pages of state together in one place.
 */
export function ReattributeDialog({ exception }: { exception: Exception }) {
  const [open, setOpen] = useState(false);
  const [customerId, setCustomerId] = useState<string>("");
  const { data: customers } = useCustomers({ limit: 100 });
  const reattribute = useReattributeException();

  function onConfirm() {
    if (!customerId) return;
    reattribute.mutate(
      { id: exception.id, customerId },
      {
        onSuccess: () => {
          const name =
            customers?.items.find((c) => c.id === customerId)?.name ?? "customer";
          toast.success(`Re-attributed to ${name}`);
          setOpen(false);
          setCustomerId("");
        },
        onError: (err) =>
          toast.error(
            err instanceof ApiError ? err.message : "Could not re-attribute.",
          ),
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          Re-attribute
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Re-attribute orphan payment</DialogTitle>
          <DialogDescription>
            Move {formatNaira(exception.grossKobo)} from{" "}
            {exception.senderName ?? "an unknown sender"} out of suspense into a
            customer&apos;s credit balance. This posts a balanced contra entry and
            closes the break.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-2">
          <Label htmlFor="reattribute-customer">Customer</Label>
          <Select value={customerId} onValueChange={setCustomerId}>
            <SelectTrigger id="reattribute-customer">
              <SelectValue placeholder="Select a customer…" />
            </SelectTrigger>
            <SelectContent>
              {(customers?.items ?? []).map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            onClick={onConfirm}
            disabled={!customerId || reattribute.isPending}
          >
            {reattribute.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : null}
            Re-attribute
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
