export function parseNumericValue(value: unknown): number | null {
  if (value == null || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const parsed = Number(String(value).trim());
  return Number.isFinite(parsed) ? parsed : null;
}

export function computeTargetScore(indicator: unknown, achievedResult: unknown) {
  const target = parseNumericValue(indicator);
  const achieved = parseNumericValue(achievedResult);

  if (target == null || achieved == null) {
    return {
      achievementPct: null,
      score: null,
      error: "Enter both numeric target and achieved result values.",
    };
  }

  if (target === 0) {
    return {
      achievementPct: null,
      score: null,
      error: "Target value cannot be zero.",
    };
  }

  const score = (achieved / target) * 100;
  return {
    achievementPct: score,
    score,
    error: null,
  };
}

export function calculateWeightedScore(targets: Array<{ weight: number; score: number | null | undefined }>) {
  const totalWeight = targets.reduce((sum, target) => sum + (Number(target.weight) || 0), 0);
  const weightedTotal = targets.reduce((sum, target) => {
    const score = parseNumericValue(target.score);
    return sum + ((Number(target.weight) || 0) * (score == null ? 0 : score));
  }, 0);

  const pct = totalWeight > 0 ? weightedTotal / totalWeight : null;
  return { totalWeight, pct };
}

export function formatPercentage(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) return "—";
  return `${value.toFixed(1)}%`;
}

export function getNationalId(profile: { id_number?: string | null; national_id?: string | null; employee_no?: string | null } | null | undefined) {
  return profile?.id_number ?? profile?.national_id ?? profile?.employee_no ?? null;
}
