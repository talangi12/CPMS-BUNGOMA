import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "crypto";

// Payroll → CPMS one-way sync endpoint.
// External payroll systems POST a JSON payload of employee records.
// Each record is upserted into `profiles` keyed by id_number.
//
// Security: require either an HMAC-SHA256 signature in `x-payroll-signature`
// over the raw request body using process.env.PAYROLL_SYNC_SECRET, OR a
// matching bearer token via `authorization: Bearer <PAYROLL_SYNC_SECRET>`.
//
// Payload shape:
// {
//   "records": [
//     {
//       "id_number": "12345678",                  (required)
//       "personal_number": "EMP-001",             (optional — used as initial password)
//       "full_name": "Jane Doe",
//       "email": "jane@example.com",              (optional — synthetic if omitted)
//       "phone": "+254700000000",
//       "designation": "Officer",
//       "job_group": "K",
//       "department": "Health",
//       "directorate": "Public Health",
//       "work_station": "County HQ",
//       "employment_date": "2018-09-01",
//       "gender": "F",
//       "disability_status": "None",
//       "employee_no": "BGM-1234"
//     }
//   ]
// }

type Record = {
  id_number: string;
  personal_number?: string;
  full_name?: string;
  email?: string;
  phone?: string;
  designation?: string;
  job_group?: string;
  department?: string;
  directorate?: string;
  work_station?: string;
  employment_date?: string;
  gender?: string;
  disability_status?: string;
  employee_no?: string;
};

function verify(request: Request, raw: string): boolean {
  const secret = process.env.PAYROLL_SYNC_SECRET;
  if (!secret) return false;
  const sig = request.headers.get("x-payroll-signature");
  if (sig) {
    const expected = createHmac("sha256", secret).update(raw).digest("hex");
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  }
  const auth = request.headers.get("authorization") ?? "";
  if (auth.startsWith("Bearer ")) {
    const token = auth.slice(7);
    const a = Buffer.from(token);
    const b = Buffer.from(secret);
    return a.length === b.length && timingSafeEqual(a, b);
  }
  return false;
}

export const Route = createFileRoute("/api/public/payroll-sync")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const raw = await request.text();
        if (!verify(request, raw)) return new Response("Unauthorized", { status: 401 });

        let payload: { records?: Record[] };
        try { payload = JSON.parse(raw); } catch { return new Response("Invalid JSON", { status: 400 }); }
        const records = payload.records ?? [];
        if (!Array.isArray(records) || records.length === 0) {
          return new Response("No records", { status: 400 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        let created = 0, updated = 0, failed = 0;
        const errors: { id_number: string; error: string }[] = [];

        for (const r of records) {
          if (!r.id_number) { failed++; errors.push({ id_number: "(missing)", error: "id_number required" }); continue; }
          const email = r.email?.trim().toLowerCase() || `id_${r.id_number.toLowerCase()}@epms.bungoma.local`;
          const password = r.personal_number || r.id_number;

          // Look up existing profile by id_number
          let userId: string | undefined;
          const { data: existingProfile } = await supabaseAdmin
            .from("profiles").select("id").eq("id_number", r.id_number).maybeSingle();
          userId = existingProfile?.id;

          if (!userId) {
            const { data: cu, error: cerr } = await supabaseAdmin.auth.admin.createUser({
              email, password, email_confirm: true,
              user_metadata: {
                full_name: r.full_name ?? "",
                id_number: r.id_number,
                personal_number: r.personal_number ?? null,
                designation: r.designation ?? "Officer",
                department: r.department ?? "Administration",
                directorate: r.directorate ?? null,
                workstation: r.work_station ?? null,
                job_group: r.job_group ?? null,
                gender: r.gender ?? null,
                disability_status: r.disability_status ?? null,
                employee_no: r.employee_no ?? null,
                must_change_password: false,
              },
            });
            if (cerr || !cu.user) { failed++; errors.push({ id_number: r.id_number, error: cerr?.message ?? "create failed" }); continue; }
            userId = cu.user.id;
            created++;
          } else {
            updated++;
          }

          await supabaseAdmin.from("profiles").update({
            full_name: r.full_name ?? undefined,
            phone: r.phone ?? undefined,
            designation: r.designation ?? undefined,
            job_group: r.job_group ?? undefined,
            department: r.department ?? undefined,
            directorate: r.directorate ?? undefined,
            work_station: r.work_station ?? undefined,
            employment_date: r.employment_date ?? undefined,
            gender: r.gender ?? undefined,
            disability_status: r.disability_status ?? undefined,
            employee_no: r.employee_no ?? undefined,
            personal_number: r.personal_number ?? undefined,
            email,
          }).eq("id", userId);
        }

        return new Response(JSON.stringify({ ok: true, created, updated, failed, errors }), {
          status: 200, headers: { "content-type": "application/json" },
        });
      },
    },
  },
});

