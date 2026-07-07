import { clearSession, getToken } from "./auth";
import type {
  BillingRunInput,
  BillingRunResult,
  BreakdownSlice,
  CreateCustomerInput,
  CreateInvoiceInput,
  CreateRuleInput,
  Customer,
  Defaulters,
  Exception,
  Kpis,
  LoginResponse,
  PageParams,
  Paginated,
  Refund,
  RosterResult,
  RosterStudentInput,
  SchoolRule,
  SchoolStudent,
  Statement,
  TimeseriesPoint,
} from "./types";

export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;
  constructor(status: number, message: string, body: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  /** When false, a 401 will NOT trigger a redirect (used by /login). */
  redirectOn401?: boolean;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, redirectOn401 = true } = options;

  const headers: Record<string, string> = {
    Accept: "application/json",
  };

  const token = getToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";

  const res = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });

  if (res.status === 401 && redirectOn401) {
    clearSession();
    if (typeof window !== "undefined" && window.location.pathname !== "/login") {
      window.location.href = "/login";
    }
    throw new ApiError(401, "Unauthorized", null);
  }

  let payload: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }

  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    if (payload && typeof payload === "object" && "error" in payload) {
      const err = (payload as { error: unknown }).error;
      if (typeof err === "string") message = err;
    }
    throw new ApiError(res.status, message, payload);
  }

  return payload as T;
}

/** Build a query string with pagination (default 20/0) plus any extra params. */
function pageQs(page?: PageParams, extra?: Record<string, string>): string {
  const p = new URLSearchParams(extra);
  p.set("limit", String(page?.limit ?? 20));
  p.set("offset", String(page?.offset ?? 0));
  return `?${p.toString()}`;
}

export const api = {
  login(email: string, password: string): Promise<LoginResponse> {
    return request<LoginResponse>("/auth/login", {
      method: "POST",
      body: { email, password },
      redirectOn401: false,
    });
  },

  listCustomers(page?: PageParams): Promise<Paginated<Customer>> {
    return request<Paginated<Customer>>(`/customers${pageQs(page)}`);
  },

  createCustomer(input: CreateCustomerInput): Promise<Customer> {
    return request<Customer>("/customers", { method: "POST", body: input });
  },

  getStatement(id: string): Promise<Statement> {
    return request<Statement>(`/customers/${id}/statement`);
  },

  createInvoice(customerId: string, input: CreateInvoiceInput): Promise<unknown> {
    return request<unknown>(`/customers/${customerId}/invoices`, {
      method: "POST",
      body: input,
    });
  },

  applyCredit(customerId: string): Promise<{ appliedKobo: string }> {
    return request<{ appliedKobo: string }>(`/customers/${customerId}/apply-credit`, {
      method: "POST",
    });
  },

  getKpis(): Promise<Kpis> {
    return request<Kpis>("/kpis");
  },

  getTimeseries(days = 30): Promise<TimeseriesPoint[]> {
    return request<TimeseriesPoint[]>(`/kpis/timeseries?days=${days}`);
  },

  getBreakdown(): Promise<BreakdownSlice[]> {
    return request<BreakdownSlice[]>("/kpis/breakdown");
  },

  listExceptions(status = "open", page?: PageParams): Promise<Paginated<Exception>> {
    return request<Paginated<Exception>>(`/exceptions${pageQs(page, { status })}`);
  },

  resolveException(id: string): Promise<{ ok: true }> {
    return request<{ ok: true }>(`/exceptions/${id}/resolve`, {
      method: "POST",
    });
  },

  reattributeException(id: string, customerId: string): Promise<{ ok: true }> {
    return request<{ ok: true }>(`/exceptions/${id}/reattribute`, {
      method: "POST",
      body: { customerId },
    });
  },

  listRefunds(status = "pending_approval", page?: PageParams): Promise<Paginated<Refund>> {
    return request<Paginated<Refund>>(`/refunds${pageQs(page, { status })}`);
  },

  approveRefund(id: string): Promise<unknown> {
    return request<unknown>(`/refunds/${id}/approve`, { method: "POST" });
  },

  // ── School product ────────────────────────────────────────────────────────
  onboardRoster(students: RosterStudentInput[]): Promise<RosterResult> {
    return request<RosterResult>("/school/roster", { method: "POST", body: { students } });
  },

  listStudents(cohort?: string, page?: PageParams): Promise<Paginated<SchoolStudent>> {
    return request<Paginated<SchoolStudent>>(
      `/school/students${pageQs(page, cohort ? { cohort } : undefined)}`,
    );
  },

  listTags(cohort?: string): Promise<string[]> {
    const qs = cohort ? `?cohort=${encodeURIComponent(cohort)}` : "";
    return request<string[]>(`/school/tags${qs}`);
  },

  listRules(cohort?: string, page?: PageParams): Promise<Paginated<SchoolRule>> {
    return request<Paginated<SchoolRule>>(
      `/school/rules${pageQs(page, cohort ? { cohort } : undefined)}`,
    );
  },

  createRule(input: CreateRuleInput): Promise<{ id: string }> {
    return request<{ id: string }>("/school/rules", { method: "POST", body: input });
  },

  runBilling(input: BillingRunInput): Promise<BillingRunResult> {
    return request<BillingRunResult>("/school/billing-runs", { method: "POST", body: input });
  },

  getDefaulters(cohort: string, page?: PageParams): Promise<Defaulters> {
    return request<Defaulters>(`/school/defaulters${pageQs(page, { cohort })}`);
  },

  promoteCohort(from: string, to: string): Promise<{ moved: number }> {
    return request<{ moved: number }>("/school/cohorts/promote", {
      method: "POST",
      body: { from, to },
    });
  },
};
