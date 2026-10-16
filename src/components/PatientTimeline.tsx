import React from "react";
import { useSearchParams } from "react-router-dom";

export type TimelineLinkView = "appointments" | "rx" | "billing";

export interface PatientTimelineItem {
  id: string;
  type: "visit" | "prescription" | "invoice" | "upload" | "consent";
  at: string;
  title: string;
  summary: string;
  linkView?: TimelineLinkView;
}

const FILTERS: Array<{ id: string; label: string }> = [
  { id: "all", label: "All" },
  { id: "visit", label: "Visits" },
  { id: "prescription", label: "Rx" },
  { id: "invoice", label: "Invoices" },
  { id: "upload", label: "Uploads" },
  { id: "consent", label: "Consent" },
];

function formatWhen(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || "Undated";
  return date.toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

export const PatientTimeline: React.FC<{
  items: PatientTimelineItem[];
  canPrescribe: boolean;
  onOpen: (item: PatientTimelineItem) => void;
}> = ({ items, canPrescribe, onOpen }) => {
  const [params, setParams] = useSearchParams();
  const selected = params.get("timeline") || "all";
  const visible = selected === "all" ? items : items.filter((item) => item.type === selected);

  function selectFilter(id: string) {
    const next = new URLSearchParams(params);
    if (id === "all") next.delete("timeline");
    else next.set("timeline", id);
    setParams(next, { replace: true });
  }

  return (
    <section data-testid="patient-timeline" className="rounded-xl border border-slate-200 bg-white p-4 space-y-3 min-w-0">
      <h2 className="text-sm font-bold text-slate-900">Timeline</h2>
      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Timeline filters">
        {FILTERS.map((filter) => {
          const active = selected === filter.id;
          return (
            <button
              key={filter.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => selectFilter(filter.id)}
              className={`px-2.5 py-1 rounded-full text-xs font-semibold border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                active ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-700 border-slate-300"
              }`}
            >
              {filter.label}
            </button>
          );
        })}
      </div>
      {visible.length === 0 ? (
        <p className="text-sm text-slate-600">Nothing in this filter yet. Visits, prescriptions, invoices, uploads, and consent events show up here.</p>
      ) : (
        <ul className="space-y-2">
          {visible.map((item) => {
            const linked = Boolean(item.linkView) && (item.linkView !== "rx" || canPrescribe);
            return (
              <li key={item.id} data-testid={`timeline-${item.type}`} className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{formatWhen(item.at)}</p>
                <p className="text-sm font-semibold text-slate-900 break-words mt-0.5">{item.title}</p>
                {item.summary && <p className="text-xs text-slate-600 break-words mt-0.5">{item.summary}</p>}
                {linked && (
                  <button
                    type="button"
                    onClick={() => onOpen(item)}
                    className="mt-1 text-xs font-semibold text-blue-700 hover:text-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded"
                  >
                    Open
                  </button>
                )}
                {item.type === "upload" && (
                  <a
                    href="#patient-documents"
                    className="mt-1 inline-block text-xs font-semibold text-blue-700 hover:text-blue-800"
                  >
                    Open report
                  </a>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
};
