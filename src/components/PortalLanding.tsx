import { Link } from "@tanstack/react-router";
import { AppHeader } from "@/components/AppHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { ComponentType, SVGProps } from "react";

export type PortalAction = {
  to: string;
  label: string;
  description: string;
  icon?: ComponentType<{ className?: string }>;
};

export function PortalLanding({
  userId,
  title,
  description,
  badge,
  actions,
}: {
  userId: string;
  title: string;
  description: string;
  badge: string;
  actions: PortalAction[];
}) {
  return (
    <div className="min-h-screen bg-background">
      <AppHeader authenticated userId={userId} />
      <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <div>
          <div className="text-xs font-semibold uppercase tracking-widest text-primary">{badge}</div>
          <h1 className="mt-2 font-display text-3xl font-bold">{title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        </div>

        <div className="mt-8 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {actions.map((action) => {
            const Icon = action.icon;
            return (
              <Card key={action.to} className="p-5">
                {Icon ? (
                  <div className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                    <Icon className="h-5 w-5" />
                  </div>
                ) : null}
                <h3 className="mt-3 font-display text-base font-bold">{action.label}</h3>
                <p className="mt-1 text-xs text-muted-foreground">{action.description}</p>
                <Link to={action.to} className="mt-3 inline-block">
                  <Button size="sm" variant="outline">Open</Button>
                </Link>
              </Card>
            );
          })}
        </div>
      </main>
    </div>
  );
}
