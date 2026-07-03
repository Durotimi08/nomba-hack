"use client";

import * as React from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Label,
  Pie,
  PieChart,
  PolarRadiusAxis,
  RadialBar,
  RadialBarChart,
  XAxis,
  YAxis,
} from "recharts";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { CLASSIFICATION_META, metaFor } from "@/lib/domain";
import {
  formatDayLabel,
  formatNaira,
  formatNairaCompact,
  koboToNaira,
} from "@/lib/format";
import type {
  BreakdownSlice,
  Customer,
  StatementPayment,
  TimeseriesPoint,
} from "@/lib/types";

const nairaTooltip = (value: number | string) =>
  formatNaira(String(Math.round(Number(value) * 100)));

// ── Inflow over time (hero) ──────────────────────────────────────────────────

const inflowConfig = {
  inflow: { label: "Inflow", color: "var(--chart-1)" },
} satisfies ChartConfig;

export function InflowAreaChart({ points }: { points: TimeseriesPoint[] }) {
  const data = points.map((p) => ({
    date: p.date,
    inflow: koboToNaira(p.inflowKobo),
  }));

  return (
    <ChartContainer config={inflowConfig} className="h-65 w-full">
      <AreaChart data={data} margin={{ left: 8, right: 12, top: 8, bottom: 0 }}>
        <defs>
          <linearGradient id="fillInflow" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--color-inflow)" stopOpacity={0.35} />
            <stop offset="95%" stopColor="var(--color-inflow)" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis
          dataKey="date"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          minTickGap={28}
          tickFormatter={formatDayLabel}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          width={52}
          tickMargin={4}
          tickFormatter={(v) => formatNairaCompact(Number(v))}
        />
        <ChartTooltip
          cursor={false}
          content={
            <ChartTooltipContent
              indicator="line"
              labelFormatter={(_, p) =>
                formatDayLabel(String(p?.[0]?.payload?.date ?? ""))
              }
              formatter={(value, name) => (
                <div className="flex w-full items-center justify-between gap-4">
                  <span className="flex items-center gap-1.5 text-muted-foreground">
                    <span
                      className="size-2 rounded-[2px]"
                      style={{ background: "var(--color-inflow)" }}
                    />
                    {inflowConfig[name as keyof typeof inflowConfig]?.label ?? name}
                  </span>
                  <span className="font-medium tabular-nums text-foreground">
                    {nairaTooltip(value as number)}
                  </span>
                </div>
              )}
            />
          }
        />
        <Area
          dataKey="inflow"
          type="monotone"
          stroke="var(--color-inflow)"
          strokeWidth={2}
          fill="url(#fillInflow)"
        />
      </AreaChart>
    </ChartContainer>
  );
}

// ── Reconciliation volume over time (stacked counts) ─────────────────────────

const volumeConfig = {
  reconciledCount: { label: "Reconciled", color: "var(--chart-1)" },
  exceptionCount: { label: "In exception", color: "var(--chart-5)" },
} satisfies ChartConfig;

export function VolumeAreaChart({ points }: { points: TimeseriesPoint[] }) {
  return (
    <ChartContainer config={volumeConfig} className="h-65 w-full">
      <AreaChart data={points} margin={{ left: 8, right: 12, top: 8, bottom: 0 }}>
        <defs>
          <linearGradient id="fillReconciled" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--color-reconciledCount)" stopOpacity={0.35} />
            <stop offset="95%" stopColor="var(--color-reconciledCount)" stopOpacity={0.02} />
          </linearGradient>
          <linearGradient id="fillException" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--color-exceptionCount)" stopOpacity={0.35} />
            <stop offset="95%" stopColor="var(--color-exceptionCount)" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis
          dataKey="date"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          minTickGap={28}
          tickFormatter={formatDayLabel}
        />
        <YAxis tickLine={false} axisLine={false} width={32} allowDecimals={false} />
        <ChartTooltip
          cursor={false}
          content={
            <ChartTooltipContent
              labelFormatter={(_, p) =>
                formatDayLabel(String(p?.[0]?.payload?.date ?? ""))
              }
            />
          }
        />
        <ChartLegend content={<ChartLegendContent />} />
        <Area
          dataKey="reconciledCount"
          type="monotone"
          stackId="v"
          stroke="var(--color-reconciledCount)"
          strokeWidth={2}
          fill="url(#fillReconciled)"
        />
        <Area
          dataKey="exceptionCount"
          type="monotone"
          stackId="v"
          stroke="var(--color-exceptionCount)"
          strokeWidth={2}
          fill="url(#fillException)"
        />
      </AreaChart>
    </ChartContainer>
  );
}

// ── Classification breakdown donut ───────────────────────────────────────────

export function BreakdownDonut({ slices }: { slices: BreakdownSlice[] }) {
  const data = slices
    .filter((s) => s.count > 0)
    .map((s) => {
      const m = metaFor(CLASSIFICATION_META, s.classification);
      return {
        key: s.classification,
        label: m.label,
        count: s.count,
        fill: m.color,
      };
    });

  const total = data.reduce((acc, d) => acc + d.count, 0);

  const config = data.reduce<ChartConfig>((acc, d) => {
    acc[d.key] = { label: d.label, color: d.fill };
    return acc;
  }, {});

  if (total === 0) {
    return (
      <div className="flex h-60 items-center justify-center rounded-lg border border-dashed border-border bg-[repeating-linear-gradient(45deg,transparent,transparent_6px,var(--muted)_6px,var(--muted)_7px)] text-sm text-muted-foreground">
        No payments classified yet
      </div>
    );
  }

  return (
    <ChartContainer config={config} className="mx-auto aspect-square h-60">
      <PieChart>
        <ChartTooltip
          cursor={false}
          content={<ChartTooltipContent nameKey="key" hideLabel />}
        />
        <Pie
          data={data}
          dataKey="count"
          nameKey="key"
          innerRadius={62}
          outerRadius={92}
          strokeWidth={3}
          paddingAngle={2}
        >
          <Label
            content={({ viewBox }) => {
              if (viewBox && "cx" in viewBox && "cy" in viewBox) {
                return (
                  <text
                    x={viewBox.cx}
                    y={viewBox.cy}
                    textAnchor="middle"
                    dominantBaseline="middle"
                  >
                    <tspan
                      x={viewBox.cx}
                      y={viewBox.cy}
                      className="fill-foreground text-2xl font-semibold tabular-nums"
                    >
                      {total.toLocaleString()}
                    </tspan>
                    <tspan
                      x={viewBox.cx}
                      y={(viewBox.cy ?? 0) + 20}
                      className="fill-muted-foreground text-xs"
                    >
                      Payments
                    </tspan>
                  </text>
                );
              }
              return null;
            }}
          />
        </Pie>
      </PieChart>
    </ChartContainer>
  );
}

// ── Auto-match rate radial gauge ─────────────────────────────────────────────

export function MatchRateRadial({ rate }: { rate: number }) {
  const pct = Math.round(rate * 1000) / 10;
  const data = [{ name: "match", value: pct, fill: "var(--chart-1)" }];
  const config = {
    value: { label: "Auto-match", color: "var(--chart-1)" },
  } satisfies ChartConfig;

  return (
    <ChartContainer config={config} className="mx-auto aspect-square h-50">
      <RadialBarChart
        data={data}
        startAngle={90}
        endAngle={90 - (pct / 100) * 360}
        innerRadius={78}
        outerRadius={104}
      >
        <PolarRadiusAxis tick={false} tickLine={false} axisLine={false} domain={[0, 100]}>
          <Label
            content={({ viewBox }) => {
              if (viewBox && "cx" in viewBox && "cy" in viewBox) {
                return (
                  <text x={viewBox.cx} y={viewBox.cy} textAnchor="middle">
                    <tspan
                      x={viewBox.cx}
                      y={viewBox.cy}
                      className="fill-foreground text-3xl font-semibold tabular-nums"
                    >
                      {pct.toFixed(1)}%
                    </tspan>
                    <tspan
                      x={viewBox.cx}
                      y={(viewBox.cy ?? 0) + 22}
                      className="fill-muted-foreground text-xs"
                    >
                      auto-matched
                    </tspan>
                  </text>
                );
              }
              return null;
            }}
          />
        </PolarRadiusAxis>
        <RadialBar
          dataKey="value"
          background={{ fill: "var(--muted)" }}
          cornerRadius={8}
        />
      </RadialBarChart>
    </ChartContainer>
  );
}

// ── Per-customer cumulative settlement timeline ──────────────────────────────

const timelineConfig = {
  cumulative: { label: "Settled to date", color: "var(--chart-1)" },
} satisfies ChartConfig;

export function StatementTimeline({ payments }: { payments: StatementPayment[] }) {
  const ordered = payments
    .filter((p) => p.occurredAt)
    .slice()
    .sort(
      (a, b) =>
        new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime(),
    );

  let running = 0;
  const data = ordered.map((p) => {
    running += koboToNaira(p.netKobo);
    return { date: p.occurredAt, cumulative: running };
  });

  if (data.length < 2) {
    return (
      <div className="flex h-60 items-center justify-center rounded-lg border border-dashed border-border text-sm text-muted-foreground">
        Not enough settled payments to chart yet
      </div>
    );
  }

  return (
    <ChartContainer config={timelineConfig} className="h-60 w-full">
      <AreaChart data={data} margin={{ left: 8, right: 12, top: 8, bottom: 0 }}>
        <defs>
          <linearGradient id="fillCumulative" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--color-cumulative)" stopOpacity={0.35} />
            <stop offset="95%" stopColor="var(--color-cumulative)" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis
          dataKey="date"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          minTickGap={32}
          tickFormatter={(v) => formatDayLabel(String(v).slice(0, 10))}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          width={52}
          tickFormatter={(v) => formatNairaCompact(Number(v))}
        />
        <ChartTooltip
          cursor={false}
          content={
            <ChartTooltipContent
              indicator="line"
              labelFormatter={(_, p) =>
                formatDayLabel(String(p?.[0]?.payload?.date ?? "").slice(0, 10))
              }
              formatter={(value) => (
                <span className="font-medium tabular-nums text-foreground">
                  {nairaTooltip(value as number)}
                </span>
              )}
            />
          }
        />
        <Area
          dataKey="cumulative"
          type="monotone"
          stroke="var(--color-cumulative)"
          strokeWidth={2}
          fill="url(#fillCumulative)"
        />
      </AreaChart>
    </ChartContainer>
  );
}

// ── Receivable by customer (horizontal bars) ─────────────────────────────────

const receivableConfig = {
  receivable: { label: "Receivable", color: "var(--chart-1)" },
} satisfies ChartConfig;

export function ReceivableBars({ customers }: { customers: Customer[] }) {
  const data = customers
    .map((c) => ({
      name: c.name.length > 18 ? `${c.name.slice(0, 17)}…` : c.name,
      receivable: koboToNaira(c.balanceKobo),
    }))
    .filter((d) => d.receivable > 0)
    .sort((a, b) => b.receivable - a.receivable)
    .slice(0, 7);

  if (data.length === 0) {
    return (
      <div className="flex h-50 items-center justify-center rounded-lg border border-dashed border-border text-sm text-muted-foreground">
        No outstanding receivables
      </div>
    );
  }

  return (
    <ChartContainer
      config={receivableConfig}
      className="h-70 w-full"
      style={{ aspectRatio: "auto" }}
    >
      <BarChart
        data={data}
        layout="vertical"
        margin={{ left: 8, right: 16, top: 4, bottom: 4 }}
      >
        <XAxis
          type="number"
          tickFormatter={(v) => formatNairaCompact(Number(v))}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          type="category"
          dataKey="name"
          width={120}
          tickLine={false}
          axisLine={false}
          tickMargin={4}
        />
        <ChartTooltip
          cursor={{ fill: "var(--muted)", opacity: 0.4 }}
          content={
            <ChartTooltipContent
              hideLabel
              formatter={(value) => (
                <span className="font-medium tabular-nums text-foreground">
                  {nairaTooltip(value as number)}
                </span>
              )}
            />
          }
        />
        <Bar
          dataKey="receivable"
          fill="var(--color-receivable)"
          radius={[0, 4, 4, 0]}
          maxBarSize={28}
        />
      </BarChart>
    </ChartContainer>
  );
}
