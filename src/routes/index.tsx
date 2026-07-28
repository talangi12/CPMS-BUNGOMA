import { createFileRoute, Link } from "@tanstack/react-router";
import { AppHeader } from "@/components/AppHeader";
import landscape from "@/assets/bungoma-landscape.jpg";
import emblem from "@/assets/bungoma-emblem.png";
import { ArrowRight, Wheat, Sprout, Users, ShieldCheck, BarChart3, FileSignature } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Bungoma CPMS — Digital Staff Performance Appraisal" },
      { name: "description", content: "County Performance Management System for the County Government of Bungoma. Digitises the entire SPAS lifecycle for over 7,000 county employees." },
      { property: "og:title", content: "Bungoma CPMS — Digital Staff Performance Appraisal" },
      { property: "og:description", content: "County Performance Management System for the County Government of Bungoma. Digitises the entire SPAS lifecycle for over 7,000 county employees." },
    ],
  }),
  component: LandingPage,
});

function LandingPage() {
  return (
    <div className="min-h-screen">
      <AppHeader />

      {/* HERO */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 -z-10">
          <img src={landscape} alt="Maize fields below Mount Elgon in Bungoma County" className="h-full w-full object-cover" width={1920} height={1080} />
          <div className="absolute inset-0 bg-gradient-to-b from-background/40 via-background/70 to-background" />
          <div className="absolute inset-0 bg-gradient-to-r from-primary/30 to-transparent" />
        </div>

        <div className="mx-auto grid max-w-7xl gap-12 px-4 pb-24 pt-20 sm:px-6 md:grid-cols-[1.2fr_1fr] md:pt-28 lg:pb-32">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-background/80 px-3 py-1 text-xs font-semibold uppercase tracking-widest text-primary backdrop-blur">
              <Sprout className="h-3.5 w-3.5" /> County Government of Bungoma
            </div>
            <h1 className="mt-6 font-display text-4xl font-bold leading-[1.05] text-balance text-foreground sm:text-5xl md:text-6xl lg:text-7xl">
              Cultivating <span className="text-primary">excellence</span> in public service.
            </h1>
            <p className="mt-6 max-w-xl text-balance text-base text-muted-foreground sm:text-lg">
              The County Performance Management System digitises the County's Staff Performance
              Appraisal System (SPAS) end-to-end — target setting, mid-year review, evaluation,
              rewards, sanctions and appeals — for over 7,000 county employees.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link to="/auth" className="inline-flex items-center gap-2 rounded-md bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground shadow-elegant hover:opacity-90">
                Open the system <ArrowRight className="h-4 w-4" />
              </Link>
              <a href="#features" className="inline-flex items-center gap-2 rounded-md border border-border bg-background/80 px-6 py-3 text-sm font-semibold text-foreground backdrop-blur hover:bg-muted">
                Learn more
              </a>
            </div>

            <dl className="mt-12 grid max-w-lg grid-cols-3 gap-6">
              {[
                { k: "7,000+", v: "Active employees" },
                { k: "12", v: "Departments" },
                { k: "100%", v: "Paperless SPAS" },
              ].map((s) => (
                <div key={s.v}>
                  <dt className="font-display text-2xl font-bold text-primary sm:text-3xl">{s.k}</dt>
                  <dd className="mt-1 text-xs uppercase tracking-wider text-muted-foreground">{s.v}</dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="relative hidden md:block">
            <div className="absolute -right-10 -top-6 h-72 w-72 rounded-full bg-gold/20 blur-3xl" />
            <div className="relative rounded-2xl border border-border/70 bg-card/90 p-8 shadow-elegant backdrop-blur">
              <img src={emblem} alt="" className="mx-auto h-32 w-32 object-contain" width={128} height={128} />
              <div className="mt-4 text-center">
                <div className="font-display text-lg font-bold">County Government of Bungoma</div>
                <div className="text-xs uppercase tracking-widest text-muted-foreground">Performance · Integrity · Service</div>
              </div>
              <div className="mt-6 grid grid-cols-2 gap-3 text-center">
                {[
                  { i: Wheat, l: "Agriculture" },
                  { i: Sprout, l: "Coffee & Tea" },
                  { i: Users, l: "Public Service" },
                  { i: ShieldCheck, l: "Governance" },
                ].map(({ i: Icon, l }) => (
                  <div key={l} className="rounded-lg bg-muted/60 px-3 py-3">
                    <Icon className="mx-auto h-5 w-5 text-primary" />
                    <div className="mt-1 text-xs font-medium">{l}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* FEATURES */}
      <section id="features" className="border-t border-border bg-card">
        <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6">
          <div className="max-w-2xl">
            <div className="text-xs font-semibold uppercase tracking-widest text-primary">SPAS, end to end</div>
            <h2 className="mt-3 font-display text-3xl font-bold text-balance sm:text-4xl">
              Every section of the official appraisal — digitised.
            </h2>
            <p className="mt-4 text-muted-foreground">
              From target agreement through to mid-year review, final evaluation, recommendations and
              appeals — fully traceable, with digital signatures and an immutable audit log.
            </p>
          </div>

          <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {[
              { i: FileSignature, t: "Targets & signatures", d: "Section 2A targets with indicators, weights and evidence. Section 2C digital agreement with timestamping." },
              { i: BarChart3, t: "Automated rating matrix", d: "Excellent ≥101% · Very Good 85-100% · Good 65-84% · Fair 50-64% · Poor ≤49%. Calculated live as scores are entered." },
              { i: Users, t: "Workflow engine", d: "Draft → Supervisor → Department → HR → Committee. Automatic routing, reminders and approvals across 11 stages." },
              { i: ShieldCheck, t: "Government-grade security", d: "Role-based access, JWT, MFA-ready, encrypted data, immutable audit trail. Built for county compliance." },
              { i: Sprout, t: "Training & development", d: "Section 2B captures skill gaps and recommended training, prioritised and tracked by HR." },
              { i: Wheat, t: "Appeals & archive", d: "Section 7 appeals workflow with committee review. Every appraisal permanently archived and searchable." },
            ].map(({ i: Icon, t, d }) => (
              <div key={t} className="group rounded-xl border border-border bg-background p-6 shadow-card transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-elegant">
                <div className="inline-flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground">
                  <Icon className="h-5 w-5" />
                </div>
                <h3 className="mt-4 font-display text-lg font-bold">{t}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="relative overflow-hidden bg-gradient-hero text-primary-foreground">
        <div className="absolute inset-0 opacity-20" style={{ backgroundImage: `url(${landscape})`, backgroundSize: "cover", backgroundPosition: "center" }} />
        <div className="relative mx-auto max-w-4xl px-4 py-20 text-center sm:px-6">
          <h2 className="font-display text-3xl font-bold text-balance sm:text-4xl">
            Ready to begin your appraisal cycle?
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-primary-foreground/80">
            Sign in with your county email to set targets, track progress and submit your appraisal — anytime, anywhere.
          </p>
          <Link to="/auth" className="mt-8 inline-flex items-center gap-2 rounded-md bg-background px-6 py-3 text-sm font-semibold text-primary shadow-elegant hover:opacity-95">
            Sign in to CPMS <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>

      <footer className="border-t border-border bg-card">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-3 px-4 py-8 text-xs text-muted-foreground sm:flex-row sm:px-6">
          <div className="flex items-center gap-2">
            <img src={emblem} alt="" className="h-6 w-6 object-contain" width={24} height={24} loading="lazy" />
            <span>© {new Date().getFullYear()} County Government of Bungoma. All rights reserved.</span>
          </div>
          <div>County Performance Management System · v1.0</div>
        </div>
      </footer>
    </div>
  );
}
