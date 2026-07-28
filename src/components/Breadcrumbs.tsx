import { Link, useRouterState } from "@tanstack/react-router";
import { ChevronRight, Home, ArrowLeft } from "lucide-react";

// Human labels for known path segments. Unknown segments are Title-Cased.
const LABELS: Record<string, string> = {
  dashboard: "Dashboard",
  appraisal: "My Appraisal",
  contracts: "Performance Contract",
  workplans: "Workplans",
  "additional-assignments": "Additional Assignments",
  "continuous-review": "Continuous Review",
  quarterly: "Quarterly Review",
  midyear: "Mid-Year Review",
  endyear: "End-Year Review",
  appeals: "Appeals",
  committee: "Committee",
  supervisor: "Supervisor",
  inbox: "Inbox",
  review: "Review",
  reports: "Reports",
  "spas-reports": "SPAS Forms",
  analytics: "Analytics",
  profile: "Profile",
  admin: "Administration",
  "dept-admin": "Departmental Administration",
  "sign-off": "Sign-Off Console",
  users: "Create User",
  roles: "Manage Roles",
  status: "Employment Status",
  cycles: "Appraisal Cycles",
  matrix: "Performance Matrix",
  audit: "Audit Trail",
  "login-audit": "Login Audit",
  "org-structure": "Org Structure",
  elevate: "Elevate Access",
  import: "Bulk Import",
  sync: "Payroll Sync",
  search: "Search",
  "change-password": "Change Password",
};

function label(seg: string) {
  if (LABELS[seg]) return LABELS[seg];
  // uuid-ish → "Details"
  if (/^[0-9a-f-]{16,}$/i.test(seg)) return "Details";
  return seg.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function Breadcrumbs() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  if (pathname === "/" || pathname === "/dashboard") return null;

  const segments = pathname.split("/").filter(Boolean);
  const crumbs = segments.map((seg, i) => ({
    label: label(seg),
    to: "/" + segments.slice(0, i + 1).join("/"),
  }));

  return (
    <div className="border-b border-border/60 bg-muted/30">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2 px-4 py-2 sm:px-6">
        <nav aria-label="Breadcrumb" className="flex min-w-0 flex-wrap items-center gap-1 text-xs">
          <Link to="/dashboard" className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-muted-foreground hover:bg-background hover:text-foreground">
            <Home className="h-3.5 w-3.5" /> Dashboard
          </Link>
          {crumbs.map((c, i) => {
            const isLast = i === crumbs.length - 1;
            return (
              <span key={c.to} className="inline-flex items-center gap-1">
                <ChevronRight className="h-3 w-3 text-muted-foreground/60" aria-hidden />
                {isLast ? (
                  <span className="rounded px-1.5 py-0.5 font-medium text-foreground" aria-current="page">
                    {c.label}
                  </span>
                ) : (
                  <Link to={c.to} className="rounded px-1.5 py-0.5 text-muted-foreground hover:bg-background hover:text-foreground">
                    {c.label}
                  </Link>
                )}
              </span>
            );
          })}
        </nav>
        <Link
          to="/dashboard"
          className="inline-flex items-center gap-1.5 rounded-md border border-border/70 bg-background px-2.5 py-1 text-xs font-medium text-foreground shadow-sm hover:bg-muted"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back to Dashboard
        </Link>
      </div>
    </div>
  );
}
