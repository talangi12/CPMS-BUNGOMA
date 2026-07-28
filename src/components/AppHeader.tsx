import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import emblem from "@/assets/bungoma-emblem.png";
import { LogOut, Menu, LayoutDashboard, FileText, Inbox, CalendarDays, CalendarRange, CalendarCheck, Gavel, ClipboardList, Activity, BarChart3, User, ShieldCheck, Users2, ChevronDown } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { NotificationBell } from "@/components/NotificationBell";
import { useRoles, hasAnyRole, hasAdminAccess, ROLE_LABELS } from "@/hooks/useRoles";
import { useAppraisalToasts } from "@/hooks/useAppraisalToasts";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger, SheetClose } from "@/components/ui/sheet";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuLabel, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { getPortalRouteForRoles } from "@/lib/authGuard";



type NavItem = { to: string; label: string; icon: React.ComponentType<{ className?: string }>; show?: boolean };

export function AppHeader({ authenticated = false, userId }: { authenticated?: boolean; userId?: string }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: roles } = useRoles(userId);
  const { data: profile } = useQuery({
    queryKey: ["admin-profile-hint", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("designation, id_number, email")
        .eq("id", userId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  useAppraisalToasts(authenticated ? userId : undefined);
  const [open, setOpen] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  async function signOut() {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  const primaryRole = roles?.[0];
  const portalPath = getPortalRouteForRoles(roles);
  const isSupervisor = hasAnyRole(roles, ["supervisor"]);
  const isAdmin = hasAdminAccess(roles);
  const isDeptAdmin = hasAnyRole(roles, ["dept_admin"]);
  const isCommittee = hasAnyRole(roles, ["appeals_committee", "super_admin"]);

  const primary: NavItem[] = [
    { to: portalPath, label: portalPath === "/dashboard" ? "Dashboard" : "Portal", icon: LayoutDashboard, show: true },
    { to: "/appraisal", label: "My Appraisal", icon: FileText, show: true },
    { to: "/supervisor/inbox", label: "Inbox", icon: Inbox, show: isSupervisor },
    { to: "/dept-admin", label: "Dept Admin", icon: ShieldCheck, show: isDeptAdmin && !isAdmin },
  ];

  const cycle: NavItem[] = [
    { to: "/quarterly", label: "Quarterly", icon: CalendarDays, show: true },
    { to: "/midyear", label: "Mid-Year", icon: CalendarRange, show: true },
    { to: "/endyear", label: "End-Year", icon: CalendarCheck, show: true },
  ];

  const performance: NavItem[] = [
    { to: "/contracts", label: "Performance Contract", icon: FileText, show: true },
    { to: "/sign-off", label: "Sign-Off Console", icon: ShieldCheck, show: hasAnyRole(roles, ["governor","cec","chief_officer","director","supervisor"]) },
    { to: "/workplans", label: "Workplans", icon: ClipboardList, show: true },
    { to: "/additional-assignments", label: "Additional Assignments", icon: ClipboardList, show: true },
    { to: "/continuous-review", label: "Continuous Review", icon: Activity, show: true },
    { to: "/appeals", label: "Appeals", icon: Gavel, show: true },
    { to: "/committee/appeals", label: "Committee", icon: Users2, show: isCommittee },
  ];


  const insights: NavItem[] = [
    { to: "/reports", label: "Reports", icon: FileText, show: true },
    { to: "/spas-reports", label: "SPAS Forms", icon: FileText, show: isSupervisor || isAdmin },
    { to: "/analytics", label: "Analytics", icon: BarChart3, show: true },
  ];

  const visible = (items: NavItem[]) => items.filter((i) => i.show !== false);
  const isActive = (to: string) => pathname === to || pathname.startsWith(to + "/");

  return (
    <>
    <header className="sticky top-0 z-40 border-b border-border/70 bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/60">

      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-3 px-4 sm:px-6">
        <Link to={authenticated ? portalPath : "/"} className="flex items-center gap-3 shrink-0">
          <img src={emblem} alt="County Government of Bungoma emblem" className="h-10 w-10 object-contain" width={40} height={40} />
          <div className="leading-tight">
            <div className="font-display text-base font-bold text-primary">Bungoma CPMS</div>
            <div className="hidden text-[10px] uppercase tracking-widest text-muted-foreground sm:block">County Government of Bungoma</div>
          </div>
        </Link>

        {authenticated ? (
          <>
            {/* Desktop nav */}
            <nav className="hidden items-center gap-1 lg:flex">
              {visible(primary).map((it) => (
                <NavLink key={it.to} {...it} active={isActive(it.to)} />
              ))}
              <NavGroup label="Cycle" items={visible(cycle)} pathname={pathname} />
              <NavGroup label="Performance" items={visible(performance)} pathname={pathname} />
              <NavGroup label="Insights" items={visible(insights)} pathname={pathname} />
              <Link to="/profile" className={`rounded-md px-3 py-1.5 text-sm font-medium hover:bg-muted ${isActive("/profile") ? "bg-muted" : ""}`}>
                <User className="inline h-4 w-4" />
              </Link>
            </nav>

            <div className="flex items-center gap-1.5">
              {primaryRole && (
                <span className="hidden rounded-full border border-primary/30 bg-primary/5 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary xl:inline-block">
                  {ROLE_LABELS[primaryRole]}
                </span>
              )}
              {userId && <NotificationBell userId={userId} />}
              <Button variant="outline" size="sm" onClick={signOut} className="hidden sm:inline-flex">
                <LogOut className="mr-1.5 h-4 w-4" /> Sign out
              </Button>

              {/* Mobile / tablet menu */}
              <Sheet open={open} onOpenChange={setOpen}>
                <SheetTrigger asChild>
                  <Button variant="outline" size="icon" className="lg:hidden" aria-label="Open menu">
                    <Menu className="h-5 w-5" />
                  </Button>
                </SheetTrigger>
                <SheetContent side="right" className="w-[300px] overflow-y-auto p-0">
                  <SheetHeader className="border-b px-5 py-4 text-left">
                    <SheetTitle className="font-display text-primary">Navigation</SheetTitle>
                    {primaryRole && (
                      <span className="mt-1 inline-block w-fit rounded-full border border-primary/30 bg-primary/5 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary">
                        {ROLE_LABELS[primaryRole]}
                      </span>
                    )}
                  </SheetHeader>
                  <div className="px-3 py-4">
                    <MobileSection title="Main" items={visible(primary)} pathname={pathname} onNav={() => setOpen(false)} />
                    <MobileSection title="Appraisal cycle" items={visible(cycle)} pathname={pathname} onNav={() => setOpen(false)} />
                    <MobileSection title="Performance" items={visible(performance)} pathname={pathname} onNav={() => setOpen(false)} />
                    <MobileSection title="Insights" items={visible(insights)} pathname={pathname} onNav={() => setOpen(false)} />
                    <MobileSection title="Account" items={[{ to: "/profile", label: "Profile", icon: User, show: true }]} pathname={pathname} onNav={() => setOpen(false)} />
                    <div className="mt-4 border-t px-2 pt-4">
                      <Button variant="outline" size="sm" className="w-full" onClick={() => { setOpen(false); signOut(); }}>
                        <LogOut className="mr-1.5 h-4 w-4" /> Sign out
                      </Button>
                    </div>
                  </div>
                </SheetContent>
              </Sheet>
            </div>
          </>
        ) : (
          <nav className="flex items-center gap-1.5">
            <Link to="/auth" className="rounded-md px-3 py-1.5 text-sm font-medium hover:bg-muted">Sign in</Link>
            <Link to="/auth" className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground shadow-card hover:opacity-90">Get started</Link>
          </nav>
        )}
      </div>
    </header>
    {authenticated && <Breadcrumbs />}
    </>
  );
}


function NavLink({ to, label, icon: Icon, active }: NavItem & { active: boolean }) {
  return (
    <Link to={to} className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium hover:bg-muted ${active ? "bg-muted text-primary" : "text-foreground"}`}>
      <Icon className="h-4 w-4" /> {label}
    </Link>
  );
}

function NavGroup({ label, items, pathname }: { label: string; items: NavItem[]; pathname: string }) {
  if (items.length === 0) return null;
  const active = items.some((i) => pathname === i.to || pathname.startsWith(i.to + "/"));
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className={`inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-sm font-medium hover:bg-muted ${active ? "bg-muted text-primary" : "text-foreground"}`}>
          {label} <ChevronDown className="h-3.5 w-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {items.map((it) => (
          <DropdownMenuItem key={it.to} asChild>
            <Link to={it.to} className="flex items-center gap-2">
              <it.icon className="h-4 w-4" /> {it.label}
            </Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function MobileSection({ title, items, pathname, onNav }: { title: string; items: NavItem[]; pathname: string; onNav: () => void }) {
  if (items.length === 0) return null;
  return (
    <div className="mb-4">
      <div className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</div>
      <div className="flex flex-col">
        {items.map((it) => {
          const active = pathname === it.to || pathname.startsWith(it.to + "/");
          return (
            <SheetClose asChild key={it.to}>
              <Link
                to={it.to}
                onClick={onNav}
                className={`flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium ${active ? "bg-primary/10 text-primary" : "text-foreground hover:bg-muted"}`}
              >
                <it.icon className="h-4 w-4" /> {it.label}
              </Link>
            </SheetClose>
          );
        })}
      </div>
    </div>
  );
}
