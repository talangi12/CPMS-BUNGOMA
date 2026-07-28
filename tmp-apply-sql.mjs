import { config } from 'dotenv';
config({ override: true });
import fs from 'node:fs';

const projectRef = process.env.SUPABASE_PROJECT_ID || process.env.VITE_SUPABASE_PROJECT_ID;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;

if (!projectRef || !serviceKey) {
  throw new Error('Missing Supabase project ref or service role key');
}

const sql = fs.readFileSync('supabase/migrations/20260722000000_fix_missing_import_and_profile_functions.sql', 'utf8');

const res = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${serviceKey}`,
    apikey: serviceKey,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ query: sql }),
});

const text = await res.text();
console.log('status', res.status);
console.log(text);
