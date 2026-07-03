"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Offset/limit pager. Renders "Showing X–Y of N" + Prev/Next. Hidden when it all fits on one page. */
export function Pagination({
  total,
  limit,
  offset,
  onChange,
}: {
  total: number;
  limit: number;
  offset: number;
  onChange: (offset: number) => void;
}) {
  if (total <= limit) return null;
  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + limit, total);
  const canPrev = offset > 0;
  const canNext = offset + limit < total;

  return (
    <div className="flex items-center justify-between gap-4 border-t border-border px-5 py-3">
      <p className="text-sm text-muted-foreground tabular-nums">
        Showing {from}–{to} of {total}
      </p>
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={!canPrev}
          onClick={() => onChange(Math.max(0, offset - limit))}
        >
          <ChevronLeft className="size-4" /> Previous
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={!canNext}
          onClick={() => onChange(offset + limit)}
        >
          Next <ChevronRight className="size-4" />
        </Button>
      </div>
    </div>
  );
}
