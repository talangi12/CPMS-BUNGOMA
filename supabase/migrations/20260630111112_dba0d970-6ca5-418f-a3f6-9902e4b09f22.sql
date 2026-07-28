
CREATE POLICY "wp_docs_insert_auth" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'workplan-documents');
CREATE POLICY "wp_docs_select_auth" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'workplan-documents');
CREATE POLICY "wp_docs_update_owner" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'workplan-documents' AND owner = auth.uid());
CREATE POLICY "wp_docs_delete_owner" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'workplan-documents' AND owner = auth.uid());
