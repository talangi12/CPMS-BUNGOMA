
CREATE POLICY "Read own appraisal pdfs"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'appraisal-pdfs'
    AND EXISTS (
      SELECT 1 FROM public.appraisals a
      WHERE a.pdf_path = storage.objects.name
        AND (
          a.employee_id = auth.uid()
          OR a.chosen_supervisor_id = auth.uid()
          OR public.is_admin_viewer(auth.uid())
        )
    )
  );
