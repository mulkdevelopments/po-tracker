import type { ReactNode } from "react";

/** Pulsing placeholder. Use this instead of any “Loading…” text. */
export function Skeleton({ className = "" }: { className?: string }) {
  return <span className={`skeleton ${className}`} aria-hidden="true" />;
}

/** Replaces a button label while an action is in progress. */
export function BusyLabel({
  busy,
  children,
  className = "h-3 w-16",
}: {
  busy: boolean;
  children: ReactNode;
  className?: string;
}) {
  if (!busy) return <>{children}</>;
  return <span className={`skeleton skeleton-inline rounded-full ${className}`} aria-hidden="true" />;
}

function Bar({ className }: { className: string }) {
  return <Skeleton className={className} />;
}

export function TableSkeleton({
  rows = 8,
  toolbar = true,
  fill = false,
}: {
  rows?: number;
  cols?: number;
  toolbar?: boolean;
  fill?: boolean;
}) {
  return (
    <div className={fill ? "flex min-h-0 flex-1 flex-col" : "space-y-3"} role="status" aria-label="Loading">
      {toolbar && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Bar className="h-9 w-full sm:max-w-xs" />
          <Bar className="h-9 w-full sm:w-28" />
          <Bar className="h-9 w-full sm:ml-auto sm:w-32" />
        </div>
      )}
      <div className={`overflow-hidden rounded-lg border border-slate-200 bg-white ${fill ? "min-h-0 flex-1" : ""}`}>
        {Array.from({ length: rows }, (_, r) => (
          <div key={r} className="flex items-center gap-3 border-b border-slate-100 px-3 py-3 last:border-b-0">
            <Bar className="h-3.5 w-14 shrink-0" />
            <Bar className="h-3.5 w-24 shrink-0 sm:w-32" />
            <Bar className="hidden h-3.5 min-w-0 flex-1 sm:block" />
            <Bar className="hidden h-3.5 w-20 md:block" />
            <Bar className="ml-auto hidden h-3.5 w-16 lg:block" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function DashboardSkeleton() {
  return (
    <div className="space-y-4" role="status" aria-label="Loading">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <Bar className="h-4 w-40" />
        <Bar className="h-9 w-full sm:w-56" />
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="rounded-lg border border-slate-200 bg-white p-4">
            <Bar className="mb-3 h-3 w-20" />
            <Bar className="h-7 w-24" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="h-56 rounded-lg border border-slate-200 bg-white p-4 lg:col-span-2">
          <Bar className="mb-4 h-4 w-40" />
          <Bar className="h-36 w-full" />
        </div>
        <div className="h-56 rounded-lg border border-slate-200 bg-white p-4">
          <Bar className="mb-4 h-4 w-28" />
          <Bar className="h-36 w-full" />
        </div>
      </div>
    </div>
  );
}

export function CardGridSkeleton({ cards = 4 }: { cards?: number }) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2" role="status" aria-label="Loading">
      {Array.from({ length: cards }, (_, i) => (
        <div key={i} className="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
          <Bar className="h-4 w-32" />
          <Bar className="h-9 w-full" />
          <Bar className="h-9 w-full" />
          <Bar className="h-9 w-2/3" />
        </div>
      ))}
    </div>
  );
}

export function FormSkeleton({ fields = 5 }: { fields?: number }) {
  return (
    <div className="space-y-3" role="status" aria-label="Loading">
      {Array.from({ length: fields }, (_, i) => (
        <div key={i}>
          <Bar className="mb-1.5 h-3 w-24" />
          <Bar className="h-9 w-full" />
        </div>
      ))}
    </div>
  );
}

export function PdfSkeleton() {
  return (
    <div className="flex h-full items-start justify-center p-4 sm:p-8" role="status" aria-label="Loading">
      <div className="w-full max-w-3xl space-y-4 rounded-sm bg-white p-6 shadow sm:p-10">
        <Bar className="mx-auto h-5 w-48" />
        <Bar className="h-3 w-full" />
        <Bar className="h-3 w-5/6" />
        <Bar className="h-3 w-2/3" />
        <div className="grid grid-cols-2 gap-3 pt-4 sm:grid-cols-4">
          {Array.from({ length: 8 }, (_, i) => (
            <Bar key={i} className="h-8 w-full" />
          ))}
        </div>
      </div>
    </div>
  );
}

/** Full-screen shape used before the signed-in shell is ready. */
export function AppBootSkeleton() {
  return (
    <div className="min-h-screen bg-slate-100" role="status" aria-label="Loading">
      <div className="p-4 pb-24 sm:p-6">
        <Bar className="mb-4 h-7 w-40" />
        <DashboardSkeleton />
      </div>
      <div className="fixed inset-x-0 bottom-0 flex gap-2 overflow-hidden border-t border-slate-200 bg-white p-2">
        {Array.from({ length: 8 }, (_, i) => (
          <Bar key={i} className="h-10 min-w-16 flex-1" />
        ))}
      </div>
    </div>
  );
}
