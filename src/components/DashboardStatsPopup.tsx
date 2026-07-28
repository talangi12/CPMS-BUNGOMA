import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { X, TrendingUp, ClipboardCheck, Clock, Building2, Trophy } from "lucide-react";

type Stats = Record<string, unknown> & { scope?: string };

const SESSION_KEY = "epms_stats_popup_shown";

export function DashboardStatsPopup({ userId }: { userId: string }) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (sessionStorage.getItem(SESSION_KEY) === "1") return;
    (async () => {
      const { data, error } = await supabase.rpc("dashboard_stats_for_role", { _uid: userId });
      if (error || !data) return;
      setStats(data as Stats);
      setOpen(true);
      sessionStorage.setItem(SESSION_KEY, "1");
      const t = setTimeout(() => setOpen(false), 10_000);
      return () => clearTimeout(t);
    })();
  }, [userId]);

  if (!open || !stats) return null;
  const scope = stats.scope as string | undefined;

  return (
    <div
      className="fixed bottom-6 right-6 z-50 w-[min(420px,calc(100vw-2rem))] animate-in slide-in-from-bottom-4 fade-in duration-500"
      role="status"
      aria-live="polite"
    >
      <div className="rounded-xl border border-primary/30 bg-card shadow-2xl ring-1 ring-primary/10 overflow-hidden">
        <div className="flex items-center justify-between bg-gradient-to-r from-primary/10 via-primary/5 to-transparent px-4 py-3">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-widest text-primary">
              {scopeLabel(scope)} snapshot
            </div>
            <div className="font-display text-sm font-bold">Performance summary</div>
          </div>
          <button onClick={() => setOpen(false)} aria-label="Dismiss" className="rounded-full p-1 hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2 p-4">
          {renderCards(stats).map((c) => (
            <Stat key={c.label} icon={c.icon} label={c.label} value={c.value} accent={c.accent} />
          ))}
        </div>
        {Array.isArray((stats as { top_departments?: unknown }).top_departments) &&
          ((stats as { top_departments?: unknown[] }).top_departments?.length ?? 0) > 0 && (
            <div className="border-t border-border bg-muted/30 px-4 py-2 text-[11px]">
              <div className="mb-1 font-semibold uppercase tracking-wider text-muted-foreground">Top departments</div>
              <ul className="space-y-0.5">
                {(stats as { top_departments: Array<{ department: string; approved: number }> }).top_departments
                  .slice(0, 3)
                  .map((d) => (
                    <li key={d.department} className="flex justify-between">
                      <span className="truncate">{d.department}</span>
                      <span className="font-semibold">{d.approved} approved</span>
                    </li>
                  ))}
              </ul>
            </div>
          )}
        <div className="h-1 w-full overflow-hidden bg-muted">
          <div className="h-full origin-left bg-primary animate-[shrink_10s_linear_forwards]" />
        </div>
      </div>
      <style>{`@keyframes shrink { from { transform: scaleX(1); } to { transform: scaleX(0); } }`}</style>
    </div>
  );
}

function scopeLabel(s?: string) {
  switch (s) {
    case "county": return "County-wide";
    case "directorate": return "Directorate";
    case "department": return "Department";
    case "team": return "Team";
    default: return "Personal";
  }
}

function num(v: unknown): number { return typeof v === "number" ? v : Number(v ?? 0); }

function renderCards(s: Stats): Array<{ label: string; value: string; icon: React.ReactNode; accent?: string }> {
  const scope = s.scope as string | undefined;
  if (scope === "self") {
    return [
      { label: "Submitted", value: String(num(s.submitted)), icon: <ClipboardCheck className="h-4 w-4" /> },
      { label: "Approved", value: String(num(s.approved)), icon: <TrendingUp className="h-4 w-4" />, accent: "text-emerald-600" },
      { label: "Pending", value: String(num(s.pending)), icon: <Clock className="h-4 w-4" />, accent: "text-amber-600" },
      { label: "County completion", value: `${num(s.county_completion_pct)}%`, icon: <Building2 className="h-4 w-4" /> },
    ];
  }
  if (scope === "team") {
    return [
      { label: "Submitted", value: String(num(s.submitted)), icon: <ClipboardCheck className="h-4 w-4" /> },
      { label: "Pending review", value: String(num(s.pending)), icon: <Clock className="h-4 w-4" />, accent: "text-amber-600" },
      { label: "Approved", value: String(num(s.approved)), icon: <TrendingUp className="h-4 w-4" />, accent: "text-emerald-600" },
    ];
  }
  return [
    { label: "Total", value: String(num(s.total)), icon: <Building2 className="h-4 w-4" /> },
    { label: "Approved", value: String(num(s.approved)), icon: <TrendingUp className="h-4 w-4" />, accent: "text-emerald-600" },
    { label: "Completion", value: `${num(s.completion_pct)}%`, icon: <Trophy className="h-4 w-4" />, accent: "text-primary" },
  ];
}

function Stat({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-lg border border-border bg-background p-3">
      <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {icon}{label}
      </div>
      <div className={`mt-1 font-display text-xl font-bold ${accent ?? ""}`}>{value}</div>
    </div>
  );
}
