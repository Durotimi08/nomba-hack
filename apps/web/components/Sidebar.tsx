"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Banknote,
  ClipboardList,
  GraduationCap,
  LayoutDashboard,
  Tags,
  TriangleAlert,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useExceptions, useRefunds } from "@/lib/hooks";
import { cn } from "@/lib/utils";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  exact?: boolean;
  badge?: "breaks" | "refunds";
}

const sections: { title: string; items: NavItem[] }[] = [
  {
    title: "Overview",
    items: [{ href: "/", label: "Dashboard", icon: LayoutDashboard, exact: true }],
  },
  {
    title: "Operations",
    items: [
      { href: "/customers", label: "Customers", icon: Users },
      {
        href: "/exceptions",
        label: "Exceptions",
        icon: TriangleAlert,
        badge: "breaks",
      },
      { href: "/refunds", label: "Refunds", icon: Banknote, badge: "refunds" },
    ],
  },
  {
    title: "School",
    items: [
      { href: "/school", label: "Collections", icon: GraduationCap, exact: true },
      { href: "/school/students", label: "Students", icon: ClipboardList },
      { href: "/school/rules", label: "Fees & discounts", icon: Tags },
    ],
  },
];

export function Sidebar() {
  const pathname = usePathname();
  const { data: exceptions } = useExceptions("open");
  const { data: refunds } = useRefunds("pending_approval");

  const counts: Record<NonNullable<NavItem["badge"]>, number> = {
    breaks: exceptions?.total ?? 0,
    refunds: refunds?.total ?? 0,
  };

  return (
    <aside className="hidden w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar md:flex">
      <Link
        href="/"
        className="flex items-center gap-2.5 px-5 py-5 transition-opacity hover:opacity-90"
      >
        <div className="flex size-9 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">
          ₦
        </div>
        <div className="leading-tight">
          <p className="text-sm font-semibold text-sidebar-foreground">Kobo</p>
          <p className="text-xs text-muted-foreground">Reconciliation engine</p>
        </div>
      </Link>

      <nav className="flex-1 space-y-6 px-3 py-3">
        {sections.map((section) => (
          <div key={section.title}>
            <p className="px-3 pb-1.5 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
              {section.title}
            </p>
            <div className="space-y-0.5">
              {section.items.map((item) => {
                const active = item.exact
                  ? pathname === item.href
                  : pathname.startsWith(item.href);
                const Icon = item.icon;
                const count = item.badge ? counts[item.badge] : 0;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                      active
                        ? "bg-sidebar-accent text-sidebar-accent-foreground"
                        : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
                    )}
                  >
                    <Icon className="size-4 shrink-0" />
                    <span className="flex-1">{item.label}</span>
                    {item.badge && count > 0 ? (
                      <span
                        className={cn(
                          "min-w-5 rounded-full px-1.5 py-0.5 text-center text-xs font-medium tabular-nums",
                          item.badge === "breaks"
                            ? "bg-rose-100 text-rose-700"
                            : "bg-amber-100 text-amber-700",
                        )}
                      >
                        {count}
                      </span>
                    ) : null}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="border-t border-sidebar-border px-5 py-4">
        <p className="text-xs text-muted-foreground">
          Drive demo payments with{" "}
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs text-foreground">
            pnpm simulate
          </code>
        </p>
      </div>
    </aside>
  );
}
