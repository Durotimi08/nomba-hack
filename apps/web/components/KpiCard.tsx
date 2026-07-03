import Link from "next/link";
import { ArrowUpRight, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type Tone = "neutral" | "good" | "warn" | "bad";

const valueTone: Record<Tone, string> = {
  neutral: "text-foreground",
  good: "text-emerald-600",
  warn: "text-amber-600",
  bad: "text-rose-600",
};

const iconTone: Record<Tone, string> = {
  neutral: "bg-muted text-muted-foreground",
  good: "bg-emerald-50 text-emerald-600",
  warn: "bg-amber-50 text-amber-600",
  bad: "bg-rose-50 text-rose-600",
};

export function KpiCard({
  label,
  value,
  hint,
  tone = "neutral",
  icon: Icon,
  href,
  footer,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: Tone;
  icon?: LucideIcon;
  href?: string;
  footer?: ReactNode;
}) {
  const body = (
    <div
      className={cn(
        "group relative flex h-full flex-col rounded-xl border border-border bg-card p-5 shadow-xs transition-colors",
        href && "hover:border-primary/30 hover:bg-accent/40",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
          {label}
        </p>
        {Icon ? (
          <span
            className={cn(
              "flex size-8 items-center justify-center rounded-lg",
              iconTone[tone],
            )}
          >
            <Icon className="size-4" />
          </span>
        ) : null}
      </div>

      <p className={cn("mt-3 text-2xl font-semibold tabular-nums", valueTone[tone])}>
        {value}
      </p>

      {hint ? (
        <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
      ) : null}

      {footer ? <div className="mt-3">{footer}</div> : null}

      {href ? (
        <ArrowUpRight className="absolute right-4 top-12 size-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
      ) : null}
    </div>
  );

  if (href) {
    return (
      <Link href={href} className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-xl">
        {body}
      </Link>
    );
  }
  return body;
}
