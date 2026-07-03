/**
 * Money is transported as integer **kobo** serialized as a string.
 * 100 kobo = ₦1. We format using BigInt to avoid any floating-point loss.
 */
export function formatNaira(koboString: string | null | undefined): string {
  if (koboString === null || koboString === undefined || koboString === "") {
    return "₦0.00";
  }

  let kobo: bigint;
  try {
    kobo = BigInt(koboString);
  } catch {
    return "₦0.00";
  }

  const negative = kobo < 0n;
  const abs = negative ? -kobo : kobo;

  const naira = abs / 100n;
  const remainder = abs % 100n;

  const nairaStr = withThousands(naira.toString());
  const koboStr = remainder.toString().padStart(2, "0");

  return `${negative ? "-" : ""}₦${nairaStr}.${koboStr}`;
}

function withThousands(value: string): string {
  return value.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** Kobo string → naira as a plain number, for charting (precision is fine here). */
export function koboToNaira(koboString: string | null | undefined): number {
  if (!koboString) return 0;
  const n = Number(koboString);
  return Number.isFinite(n) ? n / 100 : 0;
}

/** Compact naira for chart axes / tight labels: ₦12.5k, ₦3.4M, ₦1.2B. */
export function formatNairaCompact(value: number | string): string {
  const naira = typeof value === "string" ? koboToNaira(value) : value;
  const abs = Math.abs(naira);
  const sign = naira < 0 ? "-" : "";
  if (abs >= 1_000_000_000) return `${sign}₦${(abs / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${sign}₦${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}₦${(abs / 1_000).toFixed(1)}k`;
  return `${sign}₦${Math.round(abs)}`;
}

/** Short weekday/day label for a YYYY-MM-DD bucket, e.g. "Jun 14". */
export function formatDayLabel(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(d.getTime())) return isoDate;
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}

export function formatPercent(rate: number, fractionDigits = 1): string {
  return `${(rate * 100).toFixed(fractionDigits)}%`;
}

export function formatHours(hours: number): string {
  if (hours < 1) {
    const minutes = Math.round(hours * 60);
    return `${minutes}m`;
  }
  if (hours < 24) {
    return `${Math.round(hours)}h`;
  }
  const days = Math.floor(hours / 24);
  const rem = Math.round(hours % 24);
  return rem > 0 ? `${days}d ${rem}h` : `${days}d`;
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}
