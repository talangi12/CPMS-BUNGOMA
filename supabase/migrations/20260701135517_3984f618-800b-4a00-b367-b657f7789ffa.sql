-- Phase 1: Performance Contract foundations

-- Enums
DO $$ BEGIN
  CREATE TYPE public.contract_level AS ENUM ('governor','cec','chief_officer','director','supervisor','appraisee');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.contract_status AS ENUM (
    'draft','negotiation','returned_for_amendment','resubmitted',
    'submitted','under_review','approved','signed','locked','reopened','archived'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.matrix_category AS ENUM (
    'financial_stewardship','service_delivery','institutional_transformation','core_mandate','cross_cutting'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Performance Contracts
CREATE TABLE IF NOT EXISTS public.performance_contracts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  level public.contract_level NOT NULL,
  parent_contract_id UUID REFERENCES public.performance_contracts(id) ON DELETE SET NULL,
  supervisor_id UUID REFERENCES auth.users(id),
  cycle_id UUID REFERENCES public.appraisal_cycles(id),
  fy_label TEXT,
  fy_start DATE,
  fy_end DATE,
  directorate TEXT,
  department TEXT,
  title TEXT NOT NULL DEFAULT 'Performance Contract',
  -- Official sections
  statement_of_responsibility TEXT,
  vision_statement TEXT,
  mission_statement TEXT,
  strategic_objectives TEXT,
  statement_of_strategic_intent TEXT,
  commitments_and_obligations TEXT,
  reporting_requirements TEXT,
  contract_duration_start DATE,
  contract_duration_end DATE,
  status public.contract_status NOT NULL DEFAULT 'draft',
  submitted_at TIMESTAMPTZ,
  approved_at TIMESTAMPTZ,
  approved_by UUID REFERENCES auth.users(id),
  signed_at TIMESTAMPTZ,
  locked_at TIMESTAMPTZ,
  reopened_at TIMESTAMPTZ,
  reopened_by UUID REFERENCES auth.users(id),
  reopen_reason TEXT,
  return_reason TEXT,
  version INT NOT NULL DEFAULT 1,
  contract_number TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.performance_contracts TO authenticated;
GRANT ALL ON public.performance_contracts TO service_role;
ALTER TABLE public.performance_contracts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner reads own contract" ON public.performance_contracts
  FOR SELECT TO authenticated USING (
    owner_id = auth.uid()
    OR supervisor_id = auth.uid()
    OR public.has_role(auth.uid(),'system_admin')
    OR public.has_role(auth.uid(),'super_admin')
    OR public.has_role(auth.uid(),'hr')
    OR public.has_role(auth.uid(),'governor')
    OR public.can_view_profile(auth.uid(), owner_id)
  );

CREATE POLICY "owner writes own draft" ON public.performance_contracts
  FOR INSERT TO authenticated WITH CHECK (owner_id = auth.uid());

CREATE POLICY "owner or supervisor updates" ON public.performance_contracts
  FOR UPDATE TO authenticated USING (
    (owner_id = auth.uid() AND status IN ('draft','returned_for_amendment','resubmitted','reopened'))
    OR supervisor_id = auth.uid()
    OR public.has_role(auth.uid(),'system_admin')
    OR public.has_role(auth.uid(),'super_admin')
  );

CREATE POLICY "admin delete" ON public.performance_contracts
  FOR DELETE TO authenticated USING (
    public.has_role(auth.uid(),'system_admin') OR public.has_role(auth.uid(),'super_admin')
  );

CREATE INDEX IF NOT EXISTS idx_pc_owner ON public.performance_contracts(owner_id);
CREATE INDEX IF NOT EXISTS idx_pc_parent ON public.performance_contracts(parent_contract_id);
CREATE INDEX IF NOT EXISTS idx_pc_status ON public.performance_contracts(status);

CREATE TRIGGER pc_touch BEFORE UPDATE ON public.performance_contracts
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Objectives / Matrix rows
CREATE TABLE IF NOT EXISTS public.contract_objectives (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id UUID NOT NULL REFERENCES public.performance_contracts(id) ON DELETE CASCADE,
  category public.matrix_category NOT NULL,
  objective TEXT NOT NULL,
  indicator TEXT,
  target TEXT,
  weight NUMERIC(5,2) NOT NULL DEFAULT 0,
  baseline TEXT,
  data_source TEXT,
  achievement TEXT,
  raw_score NUMERIC(6,2),
  weighted_score NUMERIC(6,2),
  achievement_pct NUMERIC(6,2),
  sort_order INT DEFAULT 0,
  cascaded_from_id UUID REFERENCES public.contract_objectives(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.contract_objectives TO authenticated;
GRANT ALL ON public.contract_objectives TO service_role;
ALTER TABLE public.contract_objectives ENABLE ROW LEVEL SECURITY;

CREATE POLICY "objectives follow contract read" ON public.contract_objectives
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.performance_contracts c WHERE c.id = contract_id
            AND (c.owner_id = auth.uid() OR c.supervisor_id = auth.uid()
                 OR public.has_role(auth.uid(),'system_admin')
                 OR public.has_role(auth.uid(),'super_admin')
                 OR public.has_role(auth.uid(),'hr')
                 OR public.has_role(auth.uid(),'governor')
                 OR public.can_view_profile(auth.uid(), c.owner_id)))
  );

CREATE POLICY "objectives follow contract write" ON public.contract_objectives
  FOR ALL TO authenticated USING (
    EXISTS (SELECT 1 FROM public.performance_contracts c WHERE c.id = contract_id
            AND ((c.owner_id = auth.uid() AND c.status IN ('draft','returned_for_amendment','resubmitted','reopened'))
                 OR c.supervisor_id = auth.uid()
                 OR public.has_role(auth.uid(),'system_admin')
                 OR public.has_role(auth.uid(),'super_admin')))
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM public.performance_contracts c WHERE c.id = contract_id
            AND ((c.owner_id = auth.uid() AND c.status IN ('draft','returned_for_amendment','resubmitted','reopened'))
                 OR c.supervisor_id = auth.uid()
                 OR public.has_role(auth.uid(),'system_admin')
                 OR public.has_role(auth.uid(),'super_admin')))
  );

CREATE TRIGGER co_touch BEFORE UPDATE ON public.contract_objectives
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Sign-offs (typed digital signature)
CREATE TABLE IF NOT EXISTS public.contract_signoffs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id UUID NOT NULL REFERENCES public.performance_contracts(id) ON DELETE CASCADE,
  signer_id UUID NOT NULL REFERENCES auth.users(id),
  signer_role public.contract_level NOT NULL,
  signer_name TEXT NOT NULL,
  signer_position TEXT,
  signed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  comment TEXT,
  ip_address TEXT
);

GRANT SELECT, INSERT ON public.contract_signoffs TO authenticated;
GRANT ALL ON public.contract_signoffs TO service_role;
ALTER TABLE public.contract_signoffs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "signoffs read w/ contract" ON public.contract_signoffs
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.performance_contracts c WHERE c.id = contract_id
            AND (c.owner_id = auth.uid() OR c.supervisor_id = auth.uid()
                 OR public.has_role(auth.uid(),'system_admin')
                 OR public.has_role(auth.uid(),'super_admin')
                 OR public.has_role(auth.uid(),'hr')
                 OR public.can_view_profile(auth.uid(), c.owner_id)))
  );
CREATE POLICY "signer inserts own signoff" ON public.contract_signoffs
  FOR INSERT TO authenticated WITH CHECK (signer_id = auth.uid());

-- Contract audit trail (append-only, historical)
CREATE TABLE IF NOT EXISTS public.contract_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id UUID NOT NULL REFERENCES public.performance_contracts(id) ON DELETE CASCADE,
  actor_id UUID REFERENCES auth.users(id),
  event_type TEXT NOT NULL,
  from_status public.contract_status,
  to_status public.contract_status,
  comment TEXT,
  payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.contract_events TO authenticated;
GRANT ALL ON public.contract_events TO service_role;
ALTER TABLE public.contract_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "events read w/ contract" ON public.contract_events
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.performance_contracts c WHERE c.id = contract_id
            AND (c.owner_id = auth.uid() OR c.supervisor_id = auth.uid()
                 OR public.has_role(auth.uid(),'system_admin')
                 OR public.has_role(auth.uid(),'super_admin')
                 OR public.has_role(auth.uid(),'hr')
                 OR public.can_view_profile(auth.uid(), c.owner_id)))
  );
CREATE POLICY "actor inserts event" ON public.contract_events
  FOR INSERT TO authenticated WITH CHECK (actor_id = auth.uid() OR actor_id IS NULL);

-- RPC: can a subordinate start their contract? (parent must be signed/locked)
CREATE OR REPLACE FUNCTION public.can_start_contract(_owner UUID)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE sup UUID; parent_status public.contract_status;
BEGIN
  SELECT supervisor_id INTO sup FROM public.profiles WHERE id = _owner;
  IF sup IS NULL THEN RETURN true; END IF; -- top of chain (Governor)
  SELECT status INTO parent_status FROM public.performance_contracts
    WHERE owner_id = sup ORDER BY created_at DESC LIMIT 1;
  RETURN parent_status IN ('signed','locked');
END $$;

-- RPC: reopen contract (originating approver + one level up + admin)
CREATE OR REPLACE FUNCTION public.reopen_contract(_contract UUID, _reason TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE c public.performance_contracts%ROWTYPE; grand UUID; allowed BOOLEAN := false;
BEGIN
  SELECT * INTO c FROM public.performance_contracts WHERE id = _contract;
  IF c.id IS NULL THEN RAISE EXCEPTION 'Contract not found'; END IF;
  IF public.has_role(auth.uid(),'system_admin') OR public.has_role(auth.uid(),'super_admin') THEN
    allowed := true;
  ELSIF c.approved_by = auth.uid() OR c.supervisor_id = auth.uid() THEN
    allowed := true;
  ELSE
    -- one level up: supervisor of the approver
    SELECT supervisor_id INTO grand FROM public.profiles WHERE id = c.approved_by;
    IF grand = auth.uid() THEN allowed := true; END IF;
  END IF;
  IF NOT allowed THEN RAISE EXCEPTION 'Not authorised to reopen this contract'; END IF;

  UPDATE public.performance_contracts
    SET status='reopened', reopened_at=now(), reopened_by=auth.uid(),
        reopen_reason=_reason, locked_at=NULL, version=version+1
    WHERE id=_contract;

  INSERT INTO public.contract_events(contract_id, actor_id, event_type, from_status, to_status, comment)
  VALUES (_contract, auth.uid(), 'reopened', c.status, 'reopened', _reason);
END $$;

-- Trigger: auto-log status changes to contract_events + auto-issue contract_number on signing
CREATE OR REPLACE FUNCTION public.on_contract_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF TG_OP='UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.contract_events(contract_id, actor_id, event_type, from_status, to_status)
    VALUES (NEW.id, auth.uid(), 'status_change', OLD.status, NEW.status);

    IF NEW.status='signed' AND OLD.status<>'signed' AND NEW.contract_number IS NULL THEN
      NEW.contract_number := 'CGB/PC/' || to_char(now(),'YYYY') || '/' ||
                             lpad(nextval('public.report_number_seq')::text,6,'0');
      NEW.signed_at := now();
    END IF;
    IF NEW.status='locked' AND OLD.status<>'locked' THEN
      NEW.locked_at := now();
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_pc_change ON public.performance_contracts;
CREATE TRIGGER trg_pc_change BEFORE UPDATE ON public.performance_contracts
FOR EACH ROW EXECUTE FUNCTION public.on_contract_change();

-- Matrix reference (structure + total weights) - readable to all authenticated
CREATE TABLE IF NOT EXISTS public.matrix_reference (
  category public.matrix_category PRIMARY KEY,
  label TEXT NOT NULL,
  total_weight NUMERIC(5,2) NOT NULL,
  display_order INT NOT NULL
);
GRANT SELECT ON public.matrix_reference TO authenticated, anon;
GRANT ALL ON public.matrix_reference TO service_role;
ALTER TABLE public.matrix_reference ENABLE ROW LEVEL SECURITY;
CREATE POLICY "matrix ref readable" ON public.matrix_reference FOR SELECT TO authenticated, anon USING (true);

INSERT INTO public.matrix_reference(category,label,total_weight,display_order) VALUES
  ('financial_stewardship','Financial Stewardship & Discipline',10,1),
  ('service_delivery','Service Delivery',8,2),
  ('institutional_transformation','Institutional Transformation',10,3),
  ('core_mandate','Core Mandate',60,4),
  ('cross_cutting','Cross-Cutting Issues',12,5)
ON CONFLICT (category) DO UPDATE
  SET label=EXCLUDED.label, total_weight=EXCLUDED.total_weight, display_order=EXCLUDED.display_order;
