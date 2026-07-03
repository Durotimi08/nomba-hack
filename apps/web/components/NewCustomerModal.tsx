"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { ApiError } from "@/lib/api";
import { useCreateCustomer } from "@/lib/hooks";
import type { Vertical } from "@/lib/types";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const VERTICALS: { value: Vertical; label: string }[] = [
  { value: "rent", label: "Rent" },
  { value: "school", label: "School fees" },
  { value: "ajo", label: "Ajo / Thrift" },
  { value: "generic", label: "Generic" },
];

export function NewCustomerModal({ onClose }: { onClose: () => void }) {
  const create = useCreateCustomer();
  const [name, setName] = useState("");
  const [vertical, setVertical] = useState<Vertical>("rent");
  const [accountRef, setAccountRef] = useState("");
  const [error, setError] = useState<string | null>(null);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const trimmedRef = accountRef.trim();
    create.mutate(
      {
        name: name.trim(),
        vertical,
        ...(trimmedRef ? { accountRef: trimmedRef } : {}),
      },
      {
        onSuccess: () => {
          toast.success("Customer created — virtual account provisioned");
          onClose();
        },
        onError: (err) =>
          setError(
            err instanceof ApiError ? err.message : "Could not create customer.",
          ),
      },
    );
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New customer</DialogTitle>
          <DialogDescription>
            Provisions a dedicated virtual account on creation.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="cust-name">Name</Label>
            <Input
              id="cust-name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Lekki Gardens Estate"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="cust-vertical">Vertical</Label>
            <Select
              value={vertical}
              onValueChange={(v) => setVertical(v as Vertical)}
            >
              <SelectTrigger id="cust-vertical">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {VERTICALS.map((v) => (
                  <SelectItem key={v.value} value={v.value}>
                    {v.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="cust-ref">
              Account reference{" "}
              <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="cust-ref"
              value={accountRef}
              onChange={(e) => setAccountRef(e.target.value)}
              placeholder="Auto-generated if left blank"
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
              disabled={create.isPending || name.trim().length === 0}
            >
              {create.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : null}
              Create customer
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
