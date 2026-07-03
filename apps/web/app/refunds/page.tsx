"use client";

import { PageHeader } from "@/components/PageHeader";
import { PendingRefunds } from "@/components/PendingRefunds";

export default function RefundsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Refunds"
        description="Overpayments proposed for refund. Maker-checker control means a checker — never the proposer — releases the payout."
      />
      <PendingRefunds />
    </div>
  );
}
