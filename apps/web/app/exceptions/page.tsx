"use client";

import { ExceptionQueue } from "@/components/ExceptionQueue";
import { PageHeader } from "@/components/PageHeader";

export default function ExceptionsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Exceptions"
        description="Every unmatched or ambiguous payment, aged and ranked by materiality. Re-attribute orphans to a customer or resolve the break."
      />
      <ExceptionQueue />
    </div>
  );
}
