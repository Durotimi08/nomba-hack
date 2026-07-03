"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/PageHeader";
import { Pagination } from "@/components/Pagination";
import { EmptyState } from "@/components/States";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useOnboardRoster, useStudents } from "@/lib/hooks";
import type { RosterResult, RosterStudentInput } from "@/lib/types";

const STUDENTS_PAGE = 20;

const PLACEHOLDER = `Ada Obi, JSS1
Tobi Cole, JSS1, scholarship
Bisi Lawal, JSS1, sibling, house=Blue`;

/** Parse "Name, Cohort, tag, tag=value" lines into roster rows. */
function parseRoster(text: string): RosterStudentInput[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(",").map((p) => p.trim());
      const [name, cohort, ...tags] = parts;
      const metadata: Record<string, unknown> = {};
      for (const tag of tags) {
        if (!tag) continue;
        if (tag.includes("=")) {
          const [k, v] = tag.split("=").map((s) => s.trim());
          metadata[k!] = v === "true" ? true : v === "false" ? false : v!;
        } else {
          metadata[tag] = true;
        }
      }
      return {
        name: name ?? "",
        cohort: cohort ?? "",
        ...(Object.keys(metadata).length ? { metadata } : {}),
      };
    })
    .filter((s) => s.name.length >= 2 && s.cohort.length >= 1);
}

export default function StudentsPage() {
  const [text, setText] = useState("");
  const router = useRouter();
  const [result, setResult] = useState<RosterResult | null>(null);
  const [cohortFilter, setCohortFilter] = useState("");
  const [offset, setOffset] = useState(0);
  const onboard = useOnboardRoster();
  const { data } = useStudents(cohortFilter.trim() || undefined, { limit: STUDENTS_PAGE, offset });
  const students = data?.items ?? [];

  const parsed = parseRoster(text);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (parsed.length === 0) {
      toast.error("Add at least one valid row: Name, Cohort");
      return;
    }
    onboard.mutate(parsed, {
      onSuccess: (res) => {
        setResult(res);
        toast.success(`Onboarded ${res.created} student(s)`);
        setText("");
      },
      onError: (err) => toast.error(err instanceof Error ? err.message : "Onboarding failed"),
    });
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Students"
        description="Onboard a whole class at once — each student gets a dedicated virtual account."
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Upload roster</CardTitle>
          <CardDescription>
            One student per line: <code>Name, Cohort, tag, tag=value</code>. Tags become metadata that
            fee &amp; discount rules target.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="grid gap-2">
              <Label htmlFor="roster">Roster</Label>
              <textarea
                id="roster"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={PLACEHOLDER}
                rows={8}
                className="w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-sm shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setText(PLACEHOLDER)}
                  className="text-xs font-medium text-primary hover:underline"
                >
                  Load example
                </button>
                <p className="text-xs text-muted-foreground">
                  {parsed.length} valid row{parsed.length === 1 ? "" : "s"} detected
                </p>
              </div>
              <Button type="submit" disabled={onboard.isPending || parsed.length === 0}>
                {onboard.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Upload className="size-4" />
                )}
                Onboard {parsed.length || ""} student{parsed.length === 1 ? "" : "s"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
          <div>
            <CardTitle className="text-base">Students</CardTitle>
            <CardDescription>Click a student to open their statement and account details.</CardDescription>
          </div>
          <Input
            value={cohortFilter}
            onChange={(e) => {
              setCohortFilter(e.target.value);
              setOffset(0);
            }}
            placeholder="Filter cohort"
            className="w-40"
          />
        </CardHeader>
        <CardContent className="px-0 pb-2">
          {!students || students.length === 0 ? (
            <EmptyState title="No students yet" hint="Upload a roster to provision accounts." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-5">Student</TableHead>
                  <TableHead className="pr-5">Cohort</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {students.map((s) => (
                  <TableRow
                    key={s.id}
                    onClick={() => router.push(`/customers/${s.id}`)}
                    className="cursor-pointer"
                  >
                    <TableCell className="pl-5 font-medium">{s.name}</TableCell>
                    <TableCell className="pr-5 text-muted-foreground">{s.cohort ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <Pagination
            total={data?.total ?? 0}
            limit={STUDENTS_PAGE}
            offset={offset}
            onChange={setOffset}
          />
          {result && result.failed > 0 ? (
            <p className="px-5 pt-2 text-sm text-rose-600">
              {result.failed} row(s) failed: {result.errors.map((e) => e.name).join(", ")}
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
