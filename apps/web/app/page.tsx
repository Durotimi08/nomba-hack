"use client";

import {
  ArrowLeftRight,
  Receipt,
  Target,
  TriangleAlert,
  Wallet,
} from "lucide-react";
import {
  BreakdownDonut,
  InflowAreaChart,
  MatchRateRadial,
  VolumeAreaChart,
} from "@/components/dashboard/charts";
import { ExceptionQueue } from "@/components/ExceptionQueue";
import { KpiCard } from "@/components/KpiCard";
import { PageHeader } from "@/components/PageHeader";
import { PendingRefunds } from "@/components/PendingRefunds";
import { ErrorState } from "@/components/States";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useBreakdown, useKpis, useTimeseries } from "@/lib/hooks";
import { formatNaira, formatPercent } from "@/lib/format";
import { useState } from "react";

const AUTO_MATCH_TARGET = 0.98;
const WINDOW_CAPTION = "Last 30 days";

export default function DashboardPage() {
  const { data, isLoading, isError, error, refetch } = useKpis();
  const timeseries = useTimeseries(30);
  const breakdown = useBreakdown();
  const [metric, setMetric] = useState<"inflow" | "volume">("inflow");

  if (isError) {
    return (
      <div>
        <PageHeader
          title="Operator console"
          description="Live reconciliation health across every customer virtual account."
        />
        <Card>
          <ErrorState
            message={error instanceof Error ? error.message : "Could not load KPIs."}
            onRetry={() => void refetch()}
          />
        </Card>
      </div>
    );
  }

  const ready = !isLoading && data;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Operator console"
        description="Live reconciliation health across every customer virtual account."
      />

      {/* KPI strip — every tile deep-links into the relevant view. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <KpiCard
          label="Auto-match rate"
          value={ready ? formatPercent(data.autoMatchRate) : "—"}
          hint={`Target ≥ ${formatPercent(AUTO_MATCH_TARGET, 0)}`}
          icon={Target}
          href="/exceptions"
          tone={
            data
              ? data.autoMatchRate >= AUTO_MATCH_TARGET
                ? "good"
                : "warn"
              : "neutral"
          }
        />
        <KpiCard
          label="Open breaks"
          value={ready ? String(data.openBreaks) : "—"}
          hint="Payments needing a decision"
          icon={TriangleAlert}
          href="/exceptions"
          tone={data ? (data.openBreaks > 0 ? "warn" : "good") : "neutral"}
        />
        <KpiCard
          label="Unreconciled exposure"
          value={ready ? formatNaira(data.unreconciledExposureKobo) : "—"}
          hint="Value not yet matched"
          icon={Wallet}
          href="/exceptions"
        />
        <KpiCard
          label="Fee leakage"
          value={ready ? formatNaira(data.feeLeakageKobo) : "—"}
          hint="Processor fees vs. expected"
          icon={Receipt}
          tone={data ? (data.feeLeakageKobo !== "0" ? "bad" : "good") : "neutral"}
        />
        <KpiCard
          label="Total payments"
          value={ready ? String(data.totalPayments) : "—"}
          hint={data ? `${data.reconciledPayments} reconciled` : "Across all accounts"}
          icon={ArrowLeftRight}
          href="/customers"
        />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-start justify-between">
            <div className="space-y-1">
              <CardTitle className="text-base">Payment activity</CardTitle>
              <CardDescription>
                {metric === "inflow"
                  ? "Daily inflow value"
                  : "Reconciled vs. exception volume"}{" "}
                · {WINDOW_CAPTION}
              </CardDescription>
            </div>
            <CardAction>
              <Tabs value={metric} onValueChange={(v) => setMetric(v as typeof metric)}>
                <TabsList>
                  <TabsTrigger value="inflow">Inflow</TabsTrigger>
                  <TabsTrigger value="volume">Volume</TabsTrigger>
                </TabsList>
              </Tabs>
            </CardAction>
          </CardHeader>
          <CardContent>
            {timeseries.data ? (
              metric === "inflow" ? (
                <InflowAreaChart points={timeseries.data} />
              ) : (
                <VolumeAreaChart points={timeseries.data} />
              )
            ) : (
              <Skeleton className="h-65 w-full" />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Auto-match rate</CardTitle>
            <CardDescription>Share settled without an operator · {WINDOW_CAPTION}</CardDescription>
          </CardHeader>
          <CardContent>
            {ready ? (
              <MatchRateRadial rate={data.autoMatchRate} />
            ) : (
              <Skeleton className="mx-auto h-50 w-50 rounded-full" />
            )}
          </CardContent>
        </Card>
      </div>

      {/* Mix + exceptions row */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Payment mix</CardTitle>
            <CardDescription>By reconciliation classification</CardDescription>
          </CardHeader>
          <CardContent>
            {breakdown.data ? (
              <BreakdownDonut slices={breakdown.data} />
            ) : (
              <Skeleton className="mx-auto h-60 w-60 rounded-full" />
            )}
          </CardContent>
        </Card>

        <div className="lg:col-span-2">
          <ExceptionQueue limit={5} viewAllHref="/exceptions" />
        </div>
      </div>

      <PendingRefunds limit={5} viewAllHref="/refunds" />
    </div>
  );
}
