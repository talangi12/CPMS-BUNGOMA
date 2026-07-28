-- =============================================================
-- EPMS / SPAS Enhancements – Performance Contract, Workplans & Reports
-- 2026-07-20
-- =============================================================

-- ─────────────────────────────────────────────────────────────
-- 1.  Add current_status to performance_matrix
-- ─────────────────────────────────────────────────────────────
ALTER TABLE performance_matrix ADD COLUMN IF NOT EXISTS current_status text;

-- ─────────────────────────────────────────────────────────────
-- 2.  Add current_status to contract_objectives
-- ─────────────────────────────────────────────────────────────
ALTER TABLE contract_objectives ADD COLUMN IF NOT EXISTS current_status text;

-- ─────────────────────────────────────────────────────────────
-- 3.  Performance categories  (replaces hardcoded CATEGORIES)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS performance_categories (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  department        text        NOT NULL,
  category_key      text        NOT NULL,
  label             text        NOT NULL,
  recommended_weight numeric    NOT NULL DEFAULT 20,
  description       text,
  guidance          text,
  sort_order        integer     NOT NULL DEFAULT 0,
  is_active         boolean     NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (department, category_key)
);

ALTER TABLE performance_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_read_performance_categories"
  ON performance_categories FOR SELECT TO authenticated USING (true);

CREATE POLICY "auth_write_performance_categories"
  ON performance_categories FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- Seed the 5 default categories for every department that already has
-- rows in performance_matrix.
INSERT INTO performance_categories
  (department, category_key, label, recommended_weight, sort_order)
SELECT DISTINCT
  pm.department,
  v.category_key,
  v.label,
  v.recommended_weight,
  v.sort_order
FROM performance_matrix pm
CROSS JOIN (VALUES
  ('financial_stewardship',        'Financial Stewardship and Discipline', 20, 1),
  ('service_delivery',             'Service Delivery',                     25, 2),
  ('institutional_transformation', 'Institutional Transformation',         20, 3),
  ('core_mandate',                 'Core Mandate',                         25, 4),
  ('cross_cutting',                'Cross-Cutting Issues',                 10, 5)
) AS v(category_key, label, recommended_weight, sort_order)
ON CONFLICT (department, category_key) DO NOTHING;

-- ─────────────────────────────────────────────────────────────
-- 4.  Configurable Current Status options (per department)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS matrix_status_options (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  department text        NOT NULL,
  label      text        NOT NULL,
  sort_order integer     NOT NULL DEFAULT 0,
  is_active  boolean     NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (department, label)
);

ALTER TABLE matrix_status_options ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_read_matrix_status_options"
  ON matrix_status_options FOR SELECT TO authenticated USING (true);

CREATE POLICY "auth_write_matrix_status_options"
  ON matrix_status_options FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- Seed default status options for every existing department
INSERT INTO matrix_status_options (department, label, sort_order)
SELECT DISTINCT pm.department, v.label, v.sort_order
FROM performance_matrix pm
CROSS JOIN (VALUES
  ('Not Started', 1),
  ('In Progress', 2),
  ('Completed',   3),
  ('Ongoing',     4),
  ('Delayed',     5),
  ('Deferred',    6)
) AS v(label, sort_order)
ON CONFLICT (department, label) DO NOTHING;

-- ─────────────────────────────────────────────────────────────
-- 5.  Workplan workflow fields
-- ─────────────────────────────────────────────────────────────
ALTER TABLE workplans ADD COLUMN IF NOT EXISTS submission_note text;
ALTER TABLE workplans ADD COLUMN IF NOT EXISTS reviewer_comment text;
-- The 'status' column (text) already exists.
-- Supported workflow values: draft | submitted | approved | returned

-- ─────────────────────────────────────────────────────────────
-- 6.  Signature image upload support
-- ─────────────────────────────────────────────────────────────
ALTER TABLE contract_signoffs ADD COLUMN IF NOT EXISTS signature_image_path text;

-- ─────────────────────────────────────────────────────────────
-- NOTE: Create a Supabase Storage bucket called "signatures"
-- (public: false, file size limit: 10 MB) via the Supabase
-- dashboard or CLI before using signature image upload.
-- ─────────────────────────────────────────────────────────────
