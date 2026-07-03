"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { LogOut } from "lucide-react";
import { useAuth } from "@/lib/auth";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import {
  Avatar,
  AvatarFallback,
} from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sidebar } from "./Sidebar";
import { Spinner } from "./States";

const SEGMENT_LABELS: Record<string, string> = {
  customers: "Customers",
  exceptions: "Exceptions",
  refunds: "Refunds",
};

/** Build crumb trail from the path; the dynamic statement id renders as "Statement". */
function useBreadcrumbs(pathname: string) {
  if (pathname === "/") return [{ label: "Dashboard", href: "/" }];
  const segments = pathname.split("/").filter(Boolean);
  const crumbs: { label: string; href: string }[] = [
    { label: "Dashboard", href: "/" },
  ];
  let acc = "";
  segments.forEach((seg, i) => {
    acc += `/${seg}`;
    const isId = i > 0 && !SEGMENT_LABELS[seg];
    crumbs.push({
      label: isId ? "Statement" : (SEGMENT_LABELS[seg] ?? seg),
      href: acc,
    });
  });
  return crumbs;
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { session, ready, logout } = useAuth();

  const isPublic = pathname === "/login";
  const crumbs = useBreadcrumbs(pathname);

  useEffect(() => {
    if (ready && !session && !isPublic) {
      router.replace("/login");
    }
  }, [ready, session, isPublic, router]);

  if (isPublic) {
    return <>{children}</>;
  }

  if (!ready || !session) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Spinner className="h-6 w-6 text-primary" />
      </div>
    );
  }

  const initials = session.email.slice(0, 2).toUpperCase();

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-border bg-card/60 px-4 backdrop-blur md:px-6">
          <Breadcrumb>
            <BreadcrumbList>
              {crumbs.map((c, i) => {
                const last = i === crumbs.length - 1;
                return (
                  <BreadcrumbItem key={c.href}>
                    {last ? (
                      <BreadcrumbPage>{c.label}</BreadcrumbPage>
                    ) : (
                      <>
                        <BreadcrumbLink asChild>
                          <Link href={c.href}>{c.label}</Link>
                        </BreadcrumbLink>
                        <BreadcrumbSeparator />
                      </>
                    )}
                  </BreadcrumbItem>
                );
              })}
            </BreadcrumbList>
          </Breadcrumb>

          <div className="flex items-center gap-3">
            <span className="hidden items-center gap-1.5 text-xs text-muted-foreground sm:flex">
              <span className="relative flex size-2">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
              </span>
              Live
            </span>

            <DropdownMenu>
              <DropdownMenuTrigger className="flex items-center gap-2 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <Avatar className="size-8">
                  <AvatarFallback>{initials}</AvatarFallback>
                </Avatar>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="flex flex-col gap-1 normal-case">
                  <span className="text-sm font-medium text-foreground">
                    {session.email}
                  </span>
                  <Badge
                    variant={session.role === "checker" ? "info" : "muted"}
                    className="w-fit capitalize"
                  >
                    {session.role}
                  </Badge>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={logout}>
                  <LogOut />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-7xl px-4 py-6 md:px-6 md:py-8">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
