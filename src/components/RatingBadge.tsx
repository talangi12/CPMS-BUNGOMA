type Rating = "Excellent" | "Very Good" | "Good" | "Fair" | "Poor" | string | null | undefined;

export function classify(pct: number | null | undefined): Rating {
  if (pct == null || isNaN(pct)) return null;
  if (pct >= 101) return "Excellent";
  if (pct >= 85) return "Very Good";
  if (pct >= 65) return "Good";
  if (pct >= 50) return "Fair";
  return "Poor";
}

const tone: Record<string, string> = {
  Excellent: "bg-primary text-primary-foreground",
  "Very Good": "bg-gold text-gold-foreground",
  Good: "bg-success/15 text-success border border-success/30",
  Fair: "bg-warning/20 text-earth border border-warning/40",
  Poor: "bg-destructive/15 text-destructive border border-destructive/30",
};

export function RatingBadge({ rating, score }: { rating?: Rating; score?: number | null }) {
  const label = rating ?? classify(score ?? null);
  if (!label) return <span className="text-sm text-muted-foreground">Not rated</span>;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${tone[label] ?? "bg-muted"}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
      {label}{typeof score === "number" ? ` · ${score.toFixed(1)}%` : ""}
    </span>
  );
}
