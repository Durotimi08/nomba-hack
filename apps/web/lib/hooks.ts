"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { api } from "./api";
import type {
  BillingRunInput,
  CreateCustomerInput,
  CreateInvoiceInput,
  CreateRuleInput,
  PageParams,
  RosterStudentInput,
} from "./types";

export const queryKeys = {
  customers: ["customers"] as const,
  statement: (id: string) => ["statement", id] as const,
  kpis: ["kpis"] as const,
  timeseries: (days: number) => ["timeseries", days] as const,
  breakdown: ["breakdown"] as const,
  exceptions: (status: string) => ["exceptions", status] as const,
  refunds: (status: string) => ["refunds", status] as const,
};

export function useCustomers(page?: PageParams) {
  return useQuery({
    queryKey: [...queryKeys.customers, page?.offset ?? 0],
    queryFn: () => api.listCustomers(page),
  });
}

export function useStatement(id: string) {
  return useQuery({
    queryKey: queryKeys.statement(id),
    queryFn: () => api.getStatement(id),
    enabled: Boolean(id),
  });
}

export function useCreateCustomer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateCustomerInput) => api.createCustomer(input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.customers });
    },
  });
}

export function useApplyCredit(customerId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.applyCredit(customerId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.statement(customerId) });
      void qc.invalidateQueries({ queryKey: queryKeys.customers });
      void qc.invalidateQueries({ queryKey: queryKeys.kpis });
    },
  });
}

export function useCreateInvoice(customerId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateInvoiceInput) => api.createInvoice(customerId, input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.statement(customerId) });
    },
  });
}

export function useKpis() {
  return useQuery({
    queryKey: queryKeys.kpis,
    queryFn: () => api.getKpis(),
    refetchInterval: 15_000,
  });
}

export function useTimeseries(days = 30) {
  return useQuery({
    queryKey: queryKeys.timeseries(days),
    queryFn: () => api.getTimeseries(days),
    refetchInterval: 30_000,
  });
}

export function useBreakdown() {
  return useQuery({
    queryKey: queryKeys.breakdown,
    queryFn: () => api.getBreakdown(),
    refetchInterval: 30_000,
  });
}

export function useExceptions(status = "open", page?: PageParams) {
  return useQuery({
    queryKey: [...queryKeys.exceptions(status), page?.offset ?? 0],
    queryFn: () => api.listExceptions(status, page),
    refetchInterval: 15_000,
  });
}

function invalidateOpsViews(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: ["exceptions"] });
  void qc.invalidateQueries({ queryKey: queryKeys.kpis });
  void qc.invalidateQueries({ queryKey: ["timeseries"] });
  void qc.invalidateQueries({ queryKey: queryKeys.breakdown });
  void qc.invalidateQueries({ queryKey: queryKeys.customers });
}

export function useResolveException() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.resolveException(id),
    onSuccess: () => invalidateOpsViews(qc),
  });
}

export function useReattributeException() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, customerId }: { id: string; customerId: string }) =>
      api.reattributeException(id, customerId),
    onSuccess: () => invalidateOpsViews(qc),
  });
}

export function useRefunds(status = "pending_approval", page?: PageParams) {
  return useQuery({
    queryKey: [...queryKeys.refunds(status), page?.offset ?? 0],
    queryFn: () => api.listRefunds(status, page),
    refetchInterval: 15_000,
  });
}

export function useApproveRefund() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.approveRefund(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["refunds"] });
    },
  });
}

// ── School product ────────────────────────────────────────────────────────
export function useDefaulters(cohort: string, page?: PageParams) {
  return useQuery({
    queryKey: ["defaulters", cohort, page?.offset ?? 0],
    queryFn: () => api.getDefaulters(cohort, page),
    enabled: cohort.trim().length > 0,
    refetchInterval: 15_000,
  });
}

export function useRules(cohort?: string, page?: PageParams) {
  return useQuery({
    queryKey: ["rules", cohort ?? "all", page?.offset ?? 0],
    queryFn: () => api.listRules(cohort, page),
  });
}

export function useStudents(cohort?: string, page?: PageParams) {
  return useQuery({
    queryKey: ["students", cohort ?? "all", page?.offset ?? 0],
    queryFn: () => api.listStudents(cohort, page),
  });
}

export function useTags(cohort?: string) {
  return useQuery({
    queryKey: ["tags", cohort ?? "all"],
    queryFn: () => api.listTags(cohort),
  });
}

export function useOnboardRoster() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (students: RosterStudentInput[]) => api.onboardRoster(students),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.customers });
      void qc.invalidateQueries({ queryKey: ["students"] });
    },
  });
}

export function useCreateRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateRuleInput) => api.createRule(input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["rules"] }),
  });
}

export function useRunBilling() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: BillingRunInput) => api.runBilling(input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["defaulters"] });
      void qc.invalidateQueries({ queryKey: queryKeys.customers });
    },
  });
}

export function usePromoteCohort() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: { from: string; to: string }) => api.promoteCohort(p.from, p.to),
    onSuccess: () => void qc.invalidateQueries(),
  });
}
