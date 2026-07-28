export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      additional_assignments: {
        Row: {
          achievement_summary: string | null
          appraisal_id: string | null
          completed_at: string | null
          created_at: string
          date_assigned: string
          description: string | null
          due_date: string | null
          employee_id: string
          evidence_path: string | null
          id: string
          period: string | null
          quarter: number | null
          status: string
          supervisor_id: string
          title: string
          updated_at: string
        }
        Insert: {
          achievement_summary?: string | null
          appraisal_id?: string | null
          completed_at?: string | null
          created_at?: string
          date_assigned?: string
          description?: string | null
          due_date?: string | null
          employee_id: string
          evidence_path?: string | null
          id?: string
          period?: string | null
          quarter?: number | null
          status?: string
          supervisor_id: string
          title: string
          updated_at?: string
        }
        Update: {
          achievement_summary?: string | null
          appraisal_id?: string | null
          completed_at?: string | null
          created_at?: string
          date_assigned?: string
          description?: string | null
          due_date?: string | null
          employee_id?: string
          evidence_path?: string | null
          id?: string
          period?: string | null
          quarter?: number | null
          status?: string
          supervisor_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "additional_assignments_appraisal_id_fkey"
            columns: ["appraisal_id"]
            isOneToOne: false
            referencedRelation: "appraisals"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_reports: {
        Row: {
          appraisal_id: string
          created_at: string
          generated_by: string | null
          id: string
          metrics: Json | null
          model: string
          narrative: string
        }
        Insert: {
          appraisal_id: string
          created_at?: string
          generated_by?: string | null
          id?: string
          metrics?: Json | null
          model: string
          narrative: string
        }
        Update: {
          appraisal_id?: string
          created_at?: string
          generated_by?: string | null
          id?: string
          metrics?: Json | null
          model?: string
          narrative?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_reports_appraisal_id_fkey"
            columns: ["appraisal_id"]
            isOneToOne: false
            referencedRelation: "appraisals"
            referencedColumns: ["id"]
          },
        ]
      }
      appeals: {
        Row: {
          appellant_id: string
          appraisal_id: string
          committee_comments: string | null
          created_at: string
          desired_outcome: string | null
          evidence_paths: string[]
          grounds: string
          id: string
          reviewed_at: string | null
          reviewed_by: string | null
          ruling: string | null
          status: string
          updated_at: string
        }
        Insert: {
          appellant_id: string
          appraisal_id: string
          committee_comments?: string | null
          created_at?: string
          desired_outcome?: string | null
          evidence_paths?: string[]
          grounds: string
          id?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          ruling?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          appellant_id?: string
          appraisal_id?: string
          committee_comments?: string | null
          created_at?: string
          desired_outcome?: string | null
          evidence_paths?: string[]
          grounds?: string
          id?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          ruling?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      appraisal_cycles: {
        Row: {
          created_at: string
          created_by: string | null
          fy_end: string
          fy_label: string
          fy_start: string
          governor_signed_at: string | null
          governor_signed_by: string | null
          id: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          fy_end: string
          fy_label: string
          fy_start: string
          governor_signed_at?: string | null
          governor_signed_by?: string | null
          id?: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          fy_end?: string
          fy_label?: string
          fy_start?: string
          governor_signed_at?: string | null
          governor_signed_by?: string | null
          id?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      appraisal_versions: {
        Row: {
          appraisal_id: string
          change_summary: string | null
          changed_by: string | null
          created_at: string
          id: string
          snapshot: Json
          version_no: number
        }
        Insert: {
          appraisal_id: string
          change_summary?: string | null
          changed_by?: string | null
          created_at?: string
          id?: string
          snapshot: Json
          version_no: number
        }
        Update: {
          appraisal_id?: string
          change_summary?: string | null
          changed_by?: string | null
          created_at?: string
          id?: string
          snapshot?: Json
          version_no?: number
        }
        Relationships: []
      }
      appraisals: {
        Row: {
          chosen_supervisor_id: string | null
          created_at: string
          cycle_signoffs: Json
          employee_comments: string | null
          employee_id: string
          employee_signed_at: string | null
          endyear_completed_at: string | null
          endyear_unlocked_at: string | null
          escalated_at: string | null
          escalated_to: string | null
          escalation_count: number
          fy_start: string | null
          id: string
          last_reminder_24h_at: string | null
          last_reminder_48h_at: string | null
          last_reminder_60h_at: string | null
          locked_at: string | null
          midyear_completed_at: string | null
          midyear_unlocked_at: string | null
          pdf_generated_at: string | null
          pdf_path: string | null
          period: string
          rating: string | null
          recommendation: string | null
          rejection_reason: string | null
          resubmissions_count: number
          returned_at: string | null
          returns_count: number
          self_achievements: string | null
          self_additional: string | null
          self_additional_comments: string | null
          self_challenges: string | null
          self_commitments: string | null
          self_lessons: string | null
          self_overall_comment: string | null
          self_recommendations: string | null
          self_resources_needed: string | null
          self_training_needs: string | null
          status: string
          supervisor_comments: string | null
          supervisor_deadline: string | null
          supervisor_final_recommendation: string | null
          supervisor_reviewed_at: string | null
          supervisor_signed_at: string | null
          total_score: number | null
          updated_at: string
        }
        Insert: {
          chosen_supervisor_id?: string | null
          created_at?: string
          cycle_signoffs?: Json
          employee_comments?: string | null
          employee_id: string
          employee_signed_at?: string | null
          endyear_completed_at?: string | null
          endyear_unlocked_at?: string | null
          escalated_at?: string | null
          escalated_to?: string | null
          escalation_count?: number
          fy_start?: string | null
          id?: string
          last_reminder_24h_at?: string | null
          last_reminder_48h_at?: string | null
          last_reminder_60h_at?: string | null
          locked_at?: string | null
          midyear_completed_at?: string | null
          midyear_unlocked_at?: string | null
          pdf_generated_at?: string | null
          pdf_path?: string | null
          period: string
          rating?: string | null
          recommendation?: string | null
          rejection_reason?: string | null
          resubmissions_count?: number
          returned_at?: string | null
          returns_count?: number
          self_achievements?: string | null
          self_additional?: string | null
          self_additional_comments?: string | null
          self_challenges?: string | null
          self_commitments?: string | null
          self_lessons?: string | null
          self_overall_comment?: string | null
          self_recommendations?: string | null
          self_resources_needed?: string | null
          self_training_needs?: string | null
          status?: string
          supervisor_comments?: string | null
          supervisor_deadline?: string | null
          supervisor_final_recommendation?: string | null
          supervisor_reviewed_at?: string | null
          supervisor_signed_at?: string | null
          total_score?: number | null
          updated_at?: string
        }
        Update: {
          chosen_supervisor_id?: string | null
          created_at?: string
          cycle_signoffs?: Json
          employee_comments?: string | null
          employee_id?: string
          employee_signed_at?: string | null
          endyear_completed_at?: string | null
          endyear_unlocked_at?: string | null
          escalated_at?: string | null
          escalated_to?: string | null
          escalation_count?: number
          fy_start?: string | null
          id?: string
          last_reminder_24h_at?: string | null
          last_reminder_48h_at?: string | null
          last_reminder_60h_at?: string | null
          locked_at?: string | null
          midyear_completed_at?: string | null
          midyear_unlocked_at?: string | null
          pdf_generated_at?: string | null
          pdf_path?: string | null
          period?: string
          rating?: string | null
          recommendation?: string | null
          rejection_reason?: string | null
          resubmissions_count?: number
          returned_at?: string | null
          returns_count?: number
          self_achievements?: string | null
          self_additional?: string | null
          self_additional_comments?: string | null
          self_challenges?: string | null
          self_commitments?: string | null
          self_lessons?: string | null
          self_overall_comment?: string | null
          self_recommendations?: string | null
          self_resources_needed?: string | null
          self_training_needs?: string | null
          status?: string
          supervisor_comments?: string | null
          supervisor_deadline?: string | null
          supervisor_final_recommendation?: string | null
          supervisor_reviewed_at?: string | null
          supervisor_signed_at?: string | null
          total_score?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "appraisals_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          actor_email: string | null
          actor_id: string | null
          created_at: string
          entity_id: string | null
          entity_type: string | null
          id: string
          ip_address: string | null
          new_values: Json | null
          old_values: Json | null
          user_agent: string | null
        }
        Insert: {
          action: string
          actor_email?: string | null
          actor_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          ip_address?: string | null
          new_values?: Json | null
          old_values?: Json | null
          user_agent?: string | null
        }
        Update: {
          action?: string
          actor_email?: string | null
          actor_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          ip_address?: string | null
          new_values?: Json | null
          old_values?: Json | null
          user_agent?: string | null
        }
        Relationships: []
      }
      continuous_reviews: {
        Row: {
          achievement: string
          appraisal_id: string | null
          challenges: string | null
          created_at: string
          employee_id: string
          evidence_filename: string | null
          evidence_mime: string | null
          evidence_path: string | null
          id: string
          mitigation: string | null
          progress_comment: string | null
          progress_status: string
          supervisor_comment: string | null
          supervisor_commented_at: string | null
          supervisor_id: string | null
          target_id: string | null
          updated_at: string
          workplan_id: string | null
        }
        Insert: {
          achievement: string
          appraisal_id?: string | null
          challenges?: string | null
          created_at?: string
          employee_id: string
          evidence_filename?: string | null
          evidence_mime?: string | null
          evidence_path?: string | null
          id?: string
          mitigation?: string | null
          progress_comment?: string | null
          progress_status?: string
          supervisor_comment?: string | null
          supervisor_commented_at?: string | null
          supervisor_id?: string | null
          target_id?: string | null
          updated_at?: string
          workplan_id?: string | null
        }
        Update: {
          achievement?: string
          appraisal_id?: string | null
          challenges?: string | null
          created_at?: string
          employee_id?: string
          evidence_filename?: string | null
          evidence_mime?: string | null
          evidence_path?: string | null
          id?: string
          mitigation?: string | null
          progress_comment?: string | null
          progress_status?: string
          supervisor_comment?: string | null
          supervisor_commented_at?: string | null
          supervisor_id?: string | null
          target_id?: string | null
          updated_at?: string
          workplan_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "continuous_reviews_appraisal_id_fkey"
            columns: ["appraisal_id"]
            isOneToOne: false
            referencedRelation: "appraisals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "continuous_reviews_target_id_fkey"
            columns: ["target_id"]
            isOneToOne: false
            referencedRelation: "targets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "continuous_reviews_workplan_id_fkey"
            columns: ["workplan_id"]
            isOneToOne: false
            referencedRelation: "workplans"
            referencedColumns: ["id"]
          },
        ]
      }
      contract_events: {
        Row: {
          actor_id: string | null
          comment: string | null
          contract_id: string
          created_at: string
          event_type: string
          from_status: Database["public"]["Enums"]["contract_status"] | null
          id: string
          payload: Json | null
          to_status: Database["public"]["Enums"]["contract_status"] | null
        }
        Insert: {
          actor_id?: string | null
          comment?: string | null
          contract_id: string
          created_at?: string
          event_type: string
          from_status?: Database["public"]["Enums"]["contract_status"] | null
          id?: string
          payload?: Json | null
          to_status?: Database["public"]["Enums"]["contract_status"] | null
        }
        Update: {
          actor_id?: string | null
          comment?: string | null
          contract_id?: string
          created_at?: string
          event_type?: string
          from_status?: Database["public"]["Enums"]["contract_status"] | null
          id?: string
          payload?: Json | null
          to_status?: Database["public"]["Enums"]["contract_status"] | null
        }
        Relationships: [
          {
            foreignKeyName: "contract_events_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "performance_contracts"
            referencedColumns: ["id"]
          },
        ]
      }
      contract_objectives: {
        Row: {
          achievement: string | null
          achievement_pct: number | null
          baseline: string | null
          cascaded_from_id: string | null
          category: Database["public"]["Enums"]["matrix_category"]
          contract_id: string
          created_at: string
          data_source: string | null
          id: string
          indicator: string | null
          matrix_id: string | null
          objective: string
          raw_score: number | null
          sort_order: number | null
          source: string | null
          target: string | null
          type: string | null
          unit: string | null
          updated_at: string
          weight: number
          weighted_score: number | null
          current_status: string | null
        }
        Insert: {
          achievement?: string | null
          achievement_pct?: number | null
          baseline?: string | null
          cascaded_from_id?: string | null
          category: Database["public"]["Enums"]["matrix_category"]
          contract_id: string
          created_at?: string
          current_status?: string | null
          data_source?: string | null
          id?: string
          indicator?: string | null
          matrix_id?: string | null
          objective: string
          raw_score?: number | null
          sort_order?: number | null
          source?: string | null
          target?: string | null
          type?: string | null
          unit?: string | null
          updated_at?: string
          weight?: number
          weighted_score?: number | null
        }
        Update: {
          achievement?: string | null
          achievement_pct?: number | null
          baseline?: string | null
          cascaded_from_id?: string | null
          category?: Database["public"]["Enums"]["matrix_category"]
          contract_id?: string
          created_at?: string
          current_status?: string | null
          data_source?: string | null
          id?: string
          indicator?: string | null
          matrix_id?: string | null
          objective?: string
          raw_score?: number | null
          sort_order?: number | null
          source?: string | null
          target?: string | null
          type?: string | null
          unit?: string | null
          updated_at?: string
          weight?: number
          weighted_score?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "contract_objectives_cascaded_from_id_fkey"
            columns: ["cascaded_from_id"]
            isOneToOne: false
            referencedRelation: "contract_objectives"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contract_objectives_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "performance_contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contract_objectives_matrix_id_fkey"
            columns: ["matrix_id"]
            isOneToOne: false
            referencedRelation: "performance_matrix"
            referencedColumns: ["id"]
          },
        ]
      }
      contract_signoffs: {
        Row: {
          comment: string | null
          contract_id: string
          id: string
          ip_address: string | null
          is_owner: boolean
          signature_image_path: string | null
          signed_at: string
          signer_id: string
          signer_name: string
          signer_position: string | null
          signer_role: Database["public"]["Enums"]["contract_level"]
        }
        Insert: {
          comment?: string | null
          contract_id: string
          id?: string
          ip_address?: string | null
          is_owner?: boolean
          signature_image_path?: string | null
          signed_at?: string
          signer_id: string
          signer_name: string
          signer_position?: string | null
          signer_role: Database["public"]["Enums"]["contract_level"]
        }
        Update: {
          comment?: string | null
          contract_id?: string
          id?: string
          ip_address?: string | null
          is_owner?: boolean
          signature_image_path?: string | null
          signed_at?: string
          signer_id?: string
          signer_name?: string
          signer_position?: string | null
          signer_role?: Database["public"]["Enums"]["contract_level"]
        }
        Relationships: [
          {
            foreignKeyName: "contract_signoffs_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "performance_contracts"
            referencedColumns: ["id"]
          },
        ]
      }
      cycle_department_activations: {
        Row: {
          chief_officer_id: string | null
          chief_officer_signed_at: string | null
          cycle_id: string
          department: string
          director_id: string | null
          director_signed_at: string | null
          id: string
          supervisor_id: string | null
          supervisor_signed_at: string | null
          updated_at: string
        }
        Insert: {
          chief_officer_id?: string | null
          chief_officer_signed_at?: string | null
          cycle_id: string
          department: string
          director_id?: string | null
          director_signed_at?: string | null
          id?: string
          supervisor_id?: string | null
          supervisor_signed_at?: string | null
          updated_at?: string
        }
        Update: {
          chief_officer_id?: string | null
          chief_officer_signed_at?: string | null
          cycle_id?: string
          department?: string
          director_id?: string | null
          director_signed_at?: string | null
          id?: string
          supervisor_id?: string | null
          supervisor_signed_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cycle_department_activations_cycle_id_fkey"
            columns: ["cycle_id"]
            isOneToOne: false
            referencedRelation: "appraisal_cycles"
            referencedColumns: ["id"]
          },
        ]
      }
      departments: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
        }
        Relationships: []
      }
      employee_status_history: {
        Row: {
          changed_at: string
          changed_by: string | null
          employee_id: string
          id: string
          new_status: Database["public"]["Enums"]["employee_status"]
          previous_status: Database["public"]["Enums"]["employee_status"] | null
          reason: string | null
        }
        Insert: {
          changed_at?: string
          changed_by?: string | null
          employee_id: string
          id?: string
          new_status: Database["public"]["Enums"]["employee_status"]
          previous_status?:
            | Database["public"]["Enums"]["employee_status"]
            | null
          reason?: string | null
        }
        Update: {
          changed_at?: string
          changed_by?: string | null
          employee_id?: string
          id?: string
          new_status?: Database["public"]["Enums"]["employee_status"]
          previous_status?:
            | Database["public"]["Enums"]["employee_status"]
            | null
          reason?: string | null
        }
        Relationships: []
      }
      login_events: {
        Row: {
          created_at: string
          email: string | null
          failure_reason: string | null
          id: string
          id_number: string | null
          ip_address: string | null
          success: boolean
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          email?: string | null
          failure_reason?: string | null
          id?: string
          id_number?: string | null
          ip_address?: string | null
          success: boolean
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          email?: string | null
          failure_reason?: string | null
          id?: string
          id_number?: string | null
          ip_address?: string | null
          success?: boolean
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      matrix_reference: {
        Row: {
          category: Database["public"]["Enums"]["matrix_category"]
          display_order: number
          label: string
          total_weight: number
        }
        Insert: {
          category: Database["public"]["Enums"]["matrix_category"]
          display_order: number
          label: string
          total_weight: number
        }
        Update: {
          category?: Database["public"]["Enums"]["matrix_category"]
          display_order?: number
          label?: string
          total_weight?: number
        }
        Relationships: []
      }
      matrix_sources: {
        Row: {
          created_at: string
          department: string
          id: string
          is_active: boolean
          label: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          department: string
          id?: string
          is_active?: boolean
          label: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          department?: string
          id?: string
          is_active?: boolean
          label?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      notification_log: {
        Row: {
          body: string | null
          channel: string
          created_at: string
          error: string | null
          event_type: string
          id: string
          provider: string | null
          provider_response: string | null
          recipient: string
          recipient_user_id: string | null
          related_appraisal_id: string | null
          related_employee_id: string | null
          sent_at: string | null
          status: string
          subject: string | null
        }
        Insert: {
          body?: string | null
          channel: string
          created_at?: string
          error?: string | null
          event_type: string
          id?: string
          provider?: string | null
          provider_response?: string | null
          recipient: string
          recipient_user_id?: string | null
          related_appraisal_id?: string | null
          related_employee_id?: string | null
          sent_at?: string | null
          status?: string
          subject?: string | null
        }
        Update: {
          body?: string | null
          channel?: string
          created_at?: string
          error?: string | null
          event_type?: string
          id?: string
          provider?: string | null
          provider_response?: string | null
          recipient?: string
          recipient_user_id?: string | null
          related_appraisal_id?: string | null
          related_employee_id?: string | null
          sent_at?: string | null
          status?: string
          subject?: string | null
        }
        Relationships: []
      }
      notifications: {
        Row: {
          body: string | null
          created_at: string
          id: string
          link: string | null
          read_at: string | null
          related_appraisal_id: string | null
          title: string
          type: string
          user_id: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          id?: string
          link?: string | null
          read_at?: string | null
          related_appraisal_id?: string | null
          title: string
          type: string
          user_id: string
        }
        Update: {
          body?: string | null
          created_at?: string
          id?: string
          link?: string | null
          read_at?: string | null
          related_appraisal_id?: string | null
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: []
      }
      org_units: {
        Row: {
          created_at: string
          department: string
          directorate: string | null
          employee_count: number
          id: string
          section: string | null
          unit: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          department: string
          directorate?: string | null
          employee_count?: number
          id?: string
          section?: string | null
          unit?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          department?: string
          directorate?: string | null
          employee_count?: number
          id?: string
          section?: string | null
          unit?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      otp_codes: {
        Row: {
          attempts: number
          code_hash: string
          consumed_at: string | null
          created_at: string
          expires_at: string
          id: string
          id_number: string
          ip: string | null
          max_attempts: number
          phone_number: string
          purpose: string
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          attempts?: number
          code_hash: string
          consumed_at?: string | null
          created_at?: string
          expires_at: string
          id?: string
          id_number: string
          ip?: string | null
          max_attempts?: number
          phone_number: string
          purpose?: string
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          attempts?: number
          code_hash?: string
          consumed_at?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          id_number?: string
          ip?: string | null
          max_attempts?: number
          phone_number?: string
          purpose?: string
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      performance_contracts: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          commitments_and_obligations: string | null
          contract_duration_end: string | null
          contract_duration_start: string | null
          contract_number: string | null
          created_at: string
          cycle_id: string | null
          department: string | null
          directorate: string | null
          entity_type: Database["public"]["Enums"]["contract_entity_type"]
          fy_end: string | null
          fy_label: string | null
          fy_start: string | null
          id: string
          level: Database["public"]["Enums"]["contract_level"]
          locked_at: string | null
          mission_statement: string | null
          owner_id: string
          parent_contract_id: string | null
          reopen_reason: string | null
          reopened_at: string | null
          reopened_by: string | null
          reporting_requirements: string | null
          return_reason: string | null
          signed_at: string | null
          statement_of_responsibility: string | null
          statement_of_strategic_intent: string | null
          status: Database["public"]["Enums"]["contract_status"]
          strategic_objectives: string | null
          submitted_at: string | null
          supervisor_id: string | null
          title: string
          updated_at: string
          version: number
          vision_statement: string | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          commitments_and_obligations?: string | null
          contract_duration_end?: string | null
          contract_duration_start?: string | null
          contract_number?: string | null
          created_at?: string
          cycle_id?: string | null
          department?: string | null
          directorate?: string | null
          entity_type?: Database["public"]["Enums"]["contract_entity_type"]
          fy_end?: string | null
          fy_label?: string | null
          fy_start?: string | null
          id?: string
          level: Database["public"]["Enums"]["contract_level"]
          locked_at?: string | null
          mission_statement?: string | null
          owner_id: string
          parent_contract_id?: string | null
          reopen_reason?: string | null
          reopened_at?: string | null
          reopened_by?: string | null
          reporting_requirements?: string | null
          return_reason?: string | null
          signed_at?: string | null
          statement_of_responsibility?: string | null
          statement_of_strategic_intent?: string | null
          status?: Database["public"]["Enums"]["contract_status"]
          strategic_objectives?: string | null
          submitted_at?: string | null
          supervisor_id?: string | null
          title?: string
          updated_at?: string
          version?: number
          vision_statement?: string | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          commitments_and_obligations?: string | null
          contract_duration_end?: string | null
          contract_duration_start?: string | null
          contract_number?: string | null
          created_at?: string
          cycle_id?: string | null
          department?: string | null
          directorate?: string | null
          entity_type?: Database["public"]["Enums"]["contract_entity_type"]
          fy_end?: string | null
          fy_label?: string | null
          fy_start?: string | null
          id?: string
          level?: Database["public"]["Enums"]["contract_level"]
          locked_at?: string | null
          mission_statement?: string | null
          owner_id?: string
          parent_contract_id?: string | null
          reopen_reason?: string | null
          reopened_at?: string | null
          reopened_by?: string | null
          reporting_requirements?: string | null
          return_reason?: string | null
          signed_at?: string | null
          statement_of_responsibility?: string | null
          statement_of_strategic_intent?: string | null
          status?: Database["public"]["Enums"]["contract_status"]
          strategic_objectives?: string | null
          submitted_at?: string | null
          supervisor_id?: string | null
          title?: string
          updated_at?: string
          version?: number
          vision_statement?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "performance_contracts_cycle_id_fkey"
            columns: ["cycle_id"]
            isOneToOne: false
            referencedRelation: "appraisal_cycles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "performance_contracts_parent_contract_id_fkey"
            columns: ["parent_contract_id"]
            isOneToOne: false
            referencedRelation: "performance_contracts"
            referencedColumns: ["id"]
          },
        ]
      }
      performance_matrix: {
        Row: {
          category: string
          created_at: string
          created_by: string | null
          department: string
          id: string
          is_active: boolean
          sort_order: number
          source: string | null
          target: string
          type: string
          unit: string
          updated_at: string
          weight: number
          current_status: string | null
        }
        Insert: {
          category: string
          created_at?: string
          created_by?: string | null
          current_status?: string | null
          department: string
          id?: string
          is_active?: boolean
          sort_order?: number
          source?: string | null
          target: string
          type?: string
          unit?: string
          updated_at?: string
          weight?: number
        }
        Update: {
          category?: string
          created_at?: string
          created_by?: string | null
          current_status?: string | null
          department?: string
          id?: string
          is_active?: boolean
          sort_order?: number
          source?: string | null
          target?: string
          type?: string
          unit?: string
          updated_at?: string
          weight?: number
        }
        Relationships: []
      }
      performance_categories: {
        Row: {
          category_key: string
          created_at: string
          department: string
          description: string | null
          guidance: string | null
          id: string
          is_active: boolean
          label: string
          recommended_weight: number
          sort_order: number
          updated_at: string
        }
        Insert: {
          category_key: string
          created_at?: string
          department: string
          description?: string | null
          guidance?: string | null
          id?: string
          is_active?: boolean
          label: string
          recommended_weight?: number
          sort_order?: number
          updated_at?: string
        }
        Update: {
          category_key?: string
          created_at?: string
          department?: string
          description?: string | null
          guidance?: string | null
          id?: string
          is_active?: boolean
          label?: string
          recommended_weight?: number
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      matrix_status_options: {
        Row: {
          created_at: string
          department: string
          id: string
          is_active: boolean
          label: string
          sort_order: number
        }
        Insert: {
          created_at?: string
          department: string
          id?: string
          is_active?: boolean
          label: string
          sort_order?: number
        }
        Update: {
          created_at?: string
          department?: string
          id?: string
          is_active?: boolean
          label?: string
          sort_order?: number
        }
        Relationships: []
      }
      profiles: {
        Row: {
          chief_officer_id: string | null
          contract_end_date: string | null
          contract_start_date: string | null
          created_at: string
          department: string | null
          designation: string | null
          director_id: string | null
          directorate: string | null
          disability_status: string | null
          division: string | null
          email: string | null
          employee_no: string | null
          employee_status: Database["public"]["Enums"]["employee_status"]
          employment_date: string | null
          employment_status: string | null
          employment_type: string | null
          full_name: string
          gender: string | null
          id: string
          id_number: string | null
          imported_at: string | null
          imported_by: string | null
          job_group: string | null
          must_change_password: boolean
          national_id: string | null
          notify_channel: string
          notify_email: boolean
          notify_sms: boolean
          personal_email: string | null
          personal_number: string | null
          phone: string | null
          phone_number: string | null
          photo_url: string | null
          section: string | null
          status_change_reason: string | null
          status_changed_at: string | null
          status_changed_by: string | null
          supervisor_id: string | null
          unit: string | null
          updated_at: string
          work_station: string | null
        }
        Insert: {
          chief_officer_id?: string | null
          contract_end_date?: string | null
          contract_start_date?: string | null
          created_at?: string
          department?: string | null
          designation?: string | null
          director_id?: string | null
          directorate?: string | null
          disability_status?: string | null
          division?: string | null
          email?: string | null
          employee_no?: string | null
          employee_status?: Database["public"]["Enums"]["employee_status"]
          employment_date?: string | null
          employment_status?: string | null
          employment_type?: string | null
          full_name: string
          gender?: string | null
          id: string
          id_number?: string | null
          imported_at?: string | null
          imported_by?: string | null
          job_group?: string | null
          must_change_password?: boolean
          national_id?: string | null
          notify_channel?: string
          notify_email?: boolean
          notify_sms?: boolean
          personal_email?: string | null
          personal_number?: string | null
          phone?: string | null
          phone_number?: string | null
          photo_url?: string | null
          section?: string | null
          status_change_reason?: string | null
          status_changed_at?: string | null
          status_changed_by?: string | null
          supervisor_id?: string | null
          unit?: string | null
          updated_at?: string
          work_station?: string | null
        }
        Update: {
          chief_officer_id?: string | null
          contract_end_date?: string | null
          contract_start_date?: string | null
          created_at?: string
          department?: string | null
          designation?: string | null
          director_id?: string | null
          directorate?: string | null
          disability_status?: string | null
          division?: string | null
          email?: string | null
          employee_no?: string | null
          employee_status?: Database["public"]["Enums"]["employee_status"]
          employment_date?: string | null
          employment_status?: string | null
          employment_type?: string | null
          full_name?: string
          gender?: string | null
          id?: string
          id_number?: string | null
          imported_at?: string | null
          imported_by?: string | null
          job_group?: string | null
          must_change_password?: boolean
          national_id?: string | null
          notify_channel?: string
          notify_email?: boolean
          notify_sms?: boolean
          personal_email?: string | null
          personal_number?: string | null
          phone?: string | null
          phone_number?: string | null
          photo_url?: string | null
          section?: string | null
          status_change_reason?: string | null
          status_changed_at?: string | null
          status_changed_by?: string | null
          supervisor_id?: string | null
          unit?: string | null
          updated_at?: string
          work_station?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_chief_officer_id_fkey"
            columns: ["chief_officer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_director_id_fkey"
            columns: ["director_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_supervisor_id_fkey"
            columns: ["supervisor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      report_registry: {
        Row: {
          cycle_id: string | null
          department: string | null
          directorate: string | null
          fiscal_year: string | null
          generated_at: string
          generated_by: string | null
          id: string
          metadata: Json
          pdf_path: string | null
          quarter: number | null
          related_appraisal_id: string | null
          related_employee_id: string | null
          related_workplan_id: string | null
          report_number: string
          report_type: string
        }
        Insert: {
          cycle_id?: string | null
          department?: string | null
          directorate?: string | null
          fiscal_year?: string | null
          generated_at?: string
          generated_by?: string | null
          id?: string
          metadata?: Json
          pdf_path?: string | null
          quarter?: number | null
          related_appraisal_id?: string | null
          related_employee_id?: string | null
          related_workplan_id?: string | null
          report_number: string
          report_type: string
        }
        Update: {
          cycle_id?: string | null
          department?: string | null
          directorate?: string | null
          fiscal_year?: string | null
          generated_at?: string
          generated_by?: string | null
          id?: string
          metadata?: Json
          pdf_path?: string | null
          quarter?: number | null
          related_appraisal_id?: string | null
          related_employee_id?: string | null
          related_workplan_id?: string | null
          report_number?: string
          report_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "report_registry_cycle_id_fkey"
            columns: ["cycle_id"]
            isOneToOne: false
            referencedRelation: "appraisal_cycles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_registry_related_appraisal_id_fkey"
            columns: ["related_appraisal_id"]
            isOneToOne: false
            referencedRelation: "appraisals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_registry_related_workplan_id_fkey"
            columns: ["related_workplan_id"]
            isOneToOne: false
            referencedRelation: "workplans"
            referencedColumns: ["id"]
          },
        ]
      }
      report_signoffs: {
        Row: {
          id: string
          remarks: string | null
          report_id: string
          signed_at: string
          signer_id: string
          signer_name: string
          signer_position: string
          stage: string
          status: string
        }
        Insert: {
          id?: string
          remarks?: string | null
          report_id: string
          signed_at?: string
          signer_id: string
          signer_name: string
          signer_position: string
          stage: string
          status?: string
        }
        Update: {
          id?: string
          remarks?: string | null
          report_id?: string
          signed_at?: string
          signer_id?: string
          signer_name?: string
          signer_position?: string
          stage?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "report_signoffs_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "report_registry"
            referencedColumns: ["id"]
          },
        ]
      }
      sync_logs: {
        Row: {
          created: number
          details: Json | null
          errors: number
          finished_at: string | null
          id: string
          processed: number
          source: string
          started_at: string
          status: string
          updated: number
        }
        Insert: {
          created?: number
          details?: Json | null
          errors?: number
          finished_at?: string | null
          id?: string
          processed?: number
          source: string
          started_at?: string
          status: string
          updated?: number
        }
        Update: {
          created?: number
          details?: Json | null
          errors?: number
          finished_at?: string | null
          id?: string
          processed?: number
          source?: string
          started_at?: string
          status?: string
          updated?: number
        }
        Relationships: []
      }
      sync_schedule: {
        Row: {
          endpoint_url: string | null
          frequency: string
          id: number
          last_run_at: string | null
          updated_at: string
        }
        Insert: {
          endpoint_url?: string | null
          frequency?: string
          id?: number
          last_run_at?: string | null
          updated_at?: string
        }
        Update: {
          endpoint_url?: string | null
          frequency?: string
          id?: number
          last_run_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      target_quarter_progress: {
        Row: {
          achieved_value: string | null
          appraisal_id: string
          created_at: string
          evidence_url: string | null
          id: string
          progress_note: string | null
          quarter: number
          reviewed_at: string | null
          self_score: number | null
          submitted_at: string | null
          supervisor_comment: string | null
          supervisor_score: number | null
          target_id: string
          updated_at: string
        }
        Insert: {
          achieved_value?: string | null
          appraisal_id: string
          created_at?: string
          evidence_url?: string | null
          id?: string
          progress_note?: string | null
          quarter: number
          reviewed_at?: string | null
          self_score?: number | null
          submitted_at?: string | null
          supervisor_comment?: string | null
          supervisor_score?: number | null
          target_id: string
          updated_at?: string
        }
        Update: {
          achieved_value?: string | null
          appraisal_id?: string
          created_at?: string
          evidence_url?: string | null
          id?: string
          progress_note?: string | null
          quarter?: number
          reviewed_at?: string | null
          self_score?: number | null
          submitted_at?: string | null
          supervisor_comment?: string | null
          supervisor_score?: number | null
          target_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "target_quarter_progress_appraisal_id_fkey"
            columns: ["appraisal_id"]
            isOneToOne: false
            referencedRelation: "appraisals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "target_quarter_progress_target_id_fkey"
            columns: ["target_id"]
            isOneToOne: false
            referencedRelation: "targets"
            referencedColumns: ["id"]
          },
        ]
      }
      targets: {
        Row: {
          achieved_result: string | null
          appraisal_id: string
          created_at: string
          endyear_actual: string | null
          endyear_self_comment: string | null
          endyear_self_score: number | null
          endyear_supervisor_comment: string | null
          endyear_supervisor_score: number | null
          evidence_url: string | null
          expected_outcome: string | null
          id: string
          indicator: string | null
          midyear_progress: string | null
          midyear_score: number | null
          midyear_supervisor_comment: string | null
          score: number | null
          sort_order: number
          supervisor_review: string | null
          target: string
          weight: number
        }
        Insert: {
          achieved_result?: string | null
          appraisal_id: string
          created_at?: string
          endyear_actual?: string | null
          endyear_self_comment?: string | null
          endyear_self_score?: number | null
          endyear_supervisor_comment?: string | null
          endyear_supervisor_score?: number | null
          evidence_url?: string | null
          expected_outcome?: string | null
          id?: string
          indicator?: string | null
          midyear_progress?: string | null
          midyear_score?: number | null
          midyear_supervisor_comment?: string | null
          score?: number | null
          sort_order?: number
          supervisor_review?: string | null
          target: string
          weight?: number
        }
        Update: {
          achieved_result?: string | null
          appraisal_id?: string
          created_at?: string
          endyear_actual?: string | null
          endyear_self_comment?: string | null
          endyear_self_score?: number | null
          endyear_supervisor_comment?: string | null
          endyear_supervisor_score?: number | null
          evidence_url?: string | null
          expected_outcome?: string | null
          id?: string
          indicator?: string | null
          midyear_progress?: string | null
          midyear_score?: number | null
          midyear_supervisor_comment?: string | null
          score?: number | null
          sort_order?: number
          supervisor_review?: string | null
          target?: string
          weight?: number
        }
        Relationships: [
          {
            foreignKeyName: "targets_appraisal_id_fkey"
            columns: ["appraisal_id"]
            isOneToOne: false
            referencedRelation: "appraisals"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          department: string | null
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          department?: string | null
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          department?: string | null
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      workplan_versions: {
        Row: {
          change_reason: string | null
          changed_by: string | null
          created_at: string
          id: string
          snapshot: Json
          version: number
          workplan_id: string
        }
        Insert: {
          change_reason?: string | null
          changed_by?: string | null
          created_at?: string
          id?: string
          snapshot: Json
          version: number
          workplan_id: string
        }
        Update: {
          change_reason?: string | null
          changed_by?: string | null
          created_at?: string
          id?: string
          snapshot?: Json
          version?: number
          workplan_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workplan_versions_workplan_id_fkey"
            columns: ["workplan_id"]
            isOneToOne: false
            referencedRelation: "workplans"
            referencedColumns: ["id"]
          },
        ]
      }
      workplans: {
        Row: {
          activity: string
          approved_at: string | null
          approved_by: string | null
          assigned_by: string | null
          assignee_id: string
          created_at: string
          cycle_id: string | null
          department: string | null
          directorate: string | null
          document_name: string | null
          document_path: string | null
          document_size: number | null
          document_type: string | null
          expected_deliverable: string | null
          id: string
          kpi: string
          parent_workplan_id: string | null
          period: string
          pulled_into_appraisal_at: string | null
          quarter: number | null
          reporting_period: string | null
          resources_required: string | null
          status: string
          strategic_objective: string
          target_value: string
          timeline: string | null
          updated_at: string
          version: number
          reviewer_comment: string | null
          submission_note: string | null
          weight: number | null
          workplan_type: string
        }
        Insert: {
          activity: string
          approved_at?: string | null
          approved_by?: string | null
          assigned_by?: string | null
          assignee_id: string
          created_at?: string
          cycle_id?: string | null
          department?: string | null
          directorate?: string | null
          document_name?: string | null
          document_path?: string | null
          document_size?: number | null
          document_type?: string | null
          expected_deliverable?: string | null
          id?: string
          kpi: string
          parent_workplan_id?: string | null
          period: string
          pulled_into_appraisal_at?: string | null
          quarter?: number | null
          reporting_period?: string | null
          resources_required?: string | null
          status?: string
          strategic_objective: string
          target_value: string
          timeline?: string | null
          updated_at?: string
          version?: number
          weight?: number | null
          workplan_type?: string
        }
        Update: {
          activity?: string
          approved_at?: string | null
          approved_by?: string | null
          assigned_by?: string | null
          assignee_id?: string
          created_at?: string
          cycle_id?: string | null
          department?: string | null
          directorate?: string | null
          document_name?: string | null
          document_path?: string | null
          document_size?: number | null
          document_type?: string | null
          expected_deliverable?: string | null
          id?: string
          kpi?: string
          parent_workplan_id?: string | null
          period?: string
          pulled_into_appraisal_at?: string | null
          quarter?: number | null
          reporting_period?: string | null
          resources_required?: string | null
          status?: string
          strategic_objective?: string
          target_value?: string
          timeline?: string | null
          updated_at?: string
          version?: number
          reviewer_comment?: string | null
          submission_note?: string | null
          weight?: number | null
          workplan_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "workplans_cycle_id_fkey"
            columns: ["cycle_id"]
            isOneToOne: false
            referencedRelation: "appraisal_cycles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workplans_parent_workplan_id_fkey"
            columns: ["parent_workplan_id"]
            isOneToOne: false
            referencedRelation: "workplans"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      appraisal_calendar: { Args: { _uid: string }; Returns: Json }
      appraisal_timeline: {
        Args: { _appraisal_id: string }
        Returns: {
          action: string
          actor_email: string
          actor_id: string
          actor_name: string
          at: string
          details: Json
          id: string
        }[]
      }
      archive_expired_contracts: { Args: never; Returns: number }
      can_import: {
        Args: {
          _actor: string
          _dept: string
          _directorate: string
          _target_role: Database["public"]["Enums"]["app_role"]
        }
        Returns: boolean
      }
      can_sign_as_supervisor: {
        Args: { _actor: string; _employee: string }
        Returns: boolean
      }
      can_start_contract: { Args: { _owner: string }; Returns: boolean }
      can_view_profile: {
        Args: { _actor: string; _target: string }
        Returns: boolean
      }
      change_employee_status: {
        Args: {
          _employee: string
          _new: Database["public"]["Enums"]["employee_status"]
          _reason: string
        }
        Returns: undefined
      }
      classify_rating: { Args: { pct: number }; Returns: string }
      contract_action: {
        Args: {
          _action: string
          _employee: string
          _new_end: string
          _reason: string
        }
        Returns: undefined
      }
      current_quarter: { Args: { _fy_start: string }; Returns: number }
      cycle_active_for_dept: { Args: { _dept: string }; Returns: boolean }
      dashboard_stats_for_role: { Args: { _uid: string }; Returns: Json }
      default_employee_password: { Args: never; Returns: string }
      department_progress_for_role: {
        Args: { _cycle_id?: string; _uid: string }
        Returns: Json
      }
      department_progress_history: { Args: { _uid: string }; Returns: Json }
      department_signoff_status: { Args: { _uid: string }; Returns: Json }
      endyear_unlocked: { Args: { _appraisal_id: string }; Returns: boolean }
      escalate_overdue_appraisals: { Args: never; Returns: number }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      has_role_in_dept: {
        Args: {
          _dept: string
          _role: Database["public"]["Enums"]["app_role"]
          _uid: string
        }
        Returns: boolean
      }
      has_signed_contract: { Args: { _owner: string }; Returns: boolean }
      hierarchy_reports: { Args: { _actor: string }; Returns: Json }
      is_admin_viewer: { Args: { _uid: string }; Returns: boolean }
      list_supervisors: {
        Args: never
        Returns: {
          department: string
          designation: string
          full_name: string
          id: string
        }[]
      }
      list_supervisors_for_dept: {
        Args: { _dept: string }
        Returns: {
          department: string
          designation: string
          directorate: string
          full_name: string
          id: string
          photo_url: string
        }[]
      }
      log_audit: {
        Args: {
          _action: string
          _entity_id?: string
          _entity_type?: string
          _new?: Json
          _old?: Json
        }
        Returns: undefined
      }
      midyear_unlocked: { Args: { _appraisal_id: string }; Returns: boolean }
      monitor_contracts: { Args: never; Returns: Json }
      next_report_number: {
        Args: { _quarter?: number; _type: string }
        Returns: string
      }
      process_appraisal_reminders: { Args: never; Returns: Json }
      reopen_contract: {
        Args: { _contract: string; _reason: string }
        Returns: undefined
      }
      resolve_identifier: {
        Args: { _identifier: string }
        Returns: {
          email: string
          employee_status: Database["public"]["Enums"]["employee_status"]
          full_name: string
          must_change_password: boolean
          personal_email: string
          phone_number: string
          user_id: string
        }[]
      }
      top_performers_for_role: {
        Args: { _cycle_id?: string; _limit?: number; _uid: string }
        Returns: Json
      }
      user_role_dept: {
        Args: { _role: Database["public"]["Enums"]["app_role"]; _uid: string }
        Returns: string
      }
    }
    Enums: {
      app_role:
        | "employee"
        | "supervisor"
        | "department_head"
        | "hr_officer"
        | "cpmc"
        | "board"
        | "chief_officer"
        | "county_administrator"
        | "admin"
        | "super_admin"
        | "hr"
        | "system_admin"
        | "appeals_committee"
        | "governor"
        | "director"
        | "cec"
        | "dept_admin"
      contract_entity_type:
        | "county_government"
        | "county_executive_board"
        | "county_public_office"
      contract_level:
        | "governor"
        | "cec"
        | "chief_officer"
        | "director"
        | "supervisor"
        | "appraisee"
      contract_status:
        | "draft"
        | "negotiation"
        | "returned_for_amendment"
        | "resubmitted"
        | "submitted"
        | "under_review"
        | "approved"
        | "signed"
        | "locked"
        | "reopened"
        | "archived"
      employee_status:
        | "active"
        | "archived"
        | "on_leave"
        | "suspended"
        | "transferred"
        | "retired"
        | "terminated"
      employment_type: "permanent" | "pensionable" | "contract" | "casual"
      matrix_category:
        | "financial_stewardship"
        | "service_delivery"
        | "institutional_transformation"
        | "core_mandate"
        | "cross_cutting"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: [
        "employee",
        "supervisor",
        "department_head",
        "hr_officer",
        "cpmc",
        "board",
        "chief_officer",
        "county_administrator",
        "admin",
        "super_admin",
        "hr",
        "system_admin",
        "appeals_committee",
        "governor",
        "director",
        "cec",
        "dept_admin",
      ],
      contract_entity_type: [
        "county_government",
        "county_executive_board",
        "county_public_office",
      ],
      contract_level: [
        "governor",
        "cec",
        "chief_officer",
        "director",
        "supervisor",
        "appraisee",
      ],
      contract_status: [
        "draft",
        "negotiation",
        "returned_for_amendment",
        "resubmitted",
        "submitted",
        "under_review",
        "approved",
        "signed",
        "locked",
        "reopened",
        "archived",
      ],
      employee_status: [
        "active",
        "archived",
        "on_leave",
        "suspended",
        "transferred",
        "retired",
        "terminated",
      ],
      employment_type: ["permanent", "pensionable", "contract", "casual"],
      matrix_category: [
        "financial_stewardship",
        "service_delivery",
        "institutional_transformation",
        "core_mandate",
        "cross_cutting",
      ],
    },
  },
} as const
