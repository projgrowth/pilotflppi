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
      activity_log: {
        Row: {
          actor_id: string | null
          actor_type: string
          created_at: string
          description: string
          event_type: string
          firm_id: string | null
          id: string
          metadata: Json | null
          project_id: string | null
        }
        Insert: {
          actor_id?: string | null
          actor_type?: string
          created_at?: string
          description: string
          event_type: string
          firm_id?: string | null
          id?: string
          metadata?: Json | null
          project_id?: string | null
        }
        Update: {
          actor_id?: string | null
          actor_type?: string
          created_at?: string
          description?: string
          event_type?: string
          firm_id?: string | null
          id?: string
          metadata?: Json | null
          project_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "activity_log_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_outputs: {
        Row: {
          confidence_score: number | null
          correction_augmented: boolean | null
          created_at: string | null
          firm_id: string | null
          id: string
          input_data: Json | null
          model_version: string | null
          prediction: string | null
          project_id: string | null
          severity: string | null
        }
        Insert: {
          confidence_score?: number | null
          correction_augmented?: boolean | null
          created_at?: string | null
          firm_id?: string | null
          id?: string
          input_data?: Json | null
          model_version?: string | null
          prediction?: string | null
          project_id?: string | null
          severity?: string | null
        }
        Update: {
          confidence_score?: number | null
          correction_augmented?: boolean | null
          created_at?: string | null
          firm_id?: string | null
          id?: string
          input_data?: Json | null
          model_version?: string | null
          prediction?: string | null
          project_id?: string | null
          severity?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_outputs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      contractors: {
        Row: {
          created_at: string
          email: string | null
          firm_id: string | null
          id: string
          license_number: string | null
          name: string
          phone: string | null
          portal_access: boolean
          updated_at: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          email?: string | null
          firm_id?: string | null
          id?: string
          license_number?: string | null
          name: string
          phone?: string | null
          portal_access?: boolean
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          email?: string | null
          firm_id?: string | null
          id?: string
          license_number?: string | null
          name?: string
          phone?: string | null
          portal_access?: boolean
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      corrections: {
        Row: {
          context_notes: string | null
          corrected_value: string | null
          correction_type: string | null
          created_at: string | null
          fbc_section: string | null
          firm_id: string | null
          id: string
          original_value: string | null
          output_id: string | null
          user_id: string
        }
        Insert: {
          context_notes?: string | null
          corrected_value?: string | null
          correction_type?: string | null
          created_at?: string | null
          fbc_section?: string | null
          firm_id?: string | null
          id?: string
          original_value?: string | null
          output_id?: string | null
          user_id: string
        }
        Update: {
          context_notes?: string | null
          corrected_value?: string | null
          correction_type?: string | null
          created_at?: string | null
          fbc_section?: string | null
          firm_id?: string | null
          id?: string
          original_value?: string | null
          output_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "corrections_output_id_fkey"
            columns: ["output_id"]
            isOneToOne: false
            referencedRelation: "ai_outputs"
            referencedColumns: ["id"]
          },
        ]
      }
      deadline_alerts: {
        Row: {
          acknowledged: boolean
          alert_type: string
          firm_id: string | null
          id: string
          project_id: string
          triggered_at: string
        }
        Insert: {
          acknowledged?: boolean
          alert_type: string
          firm_id?: string | null
          id?: string
          project_id: string
          triggered_at?: string
        }
        Update: {
          acknowledged?: boolean
          alert_type?: string
          firm_id?: string | null
          id?: string
          project_id?: string
          triggered_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "deadline_alerts_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      deferred_scope_items: {
        Row: {
          category: string
          confidence_score: number | null
          created_at: string
          description: string
          evidence: string[] | null
          firm_id: string | null
          id: string
          plan_review_id: string
          required_submittal: string | null
          responsible_party: string | null
          reviewer_notes: string | null
          sheet_refs: string[] | null
          status: string
          updated_at: string
        }
        Insert: {
          category: string
          confidence_score?: number | null
          created_at?: string
          description: string
          evidence?: string[] | null
          firm_id?: string | null
          id?: string
          plan_review_id: string
          required_submittal?: string | null
          responsible_party?: string | null
          reviewer_notes?: string | null
          sheet_refs?: string[] | null
          status?: string
          updated_at?: string
        }
        Update: {
          category?: string
          confidence_score?: number | null
          created_at?: string
          description?: string
          evidence?: string[] | null
          firm_id?: string | null
          id?: string
          plan_review_id?: string
          required_submittal?: string | null
          responsible_party?: string | null
          reviewer_notes?: string | null
          sheet_refs?: string[] | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "deferred_scope_items_plan_review_id_fkey"
            columns: ["plan_review_id"]
            isOneToOne: false
            referencedRelation: "plan_reviews"
            referencedColumns: ["id"]
          },
        ]
      }
      deficiencies: {
        Row: {
          created_at: string | null
          description: string | null
          discipline: string | null
          fbc_section: string
          firm_id: string | null
          id: string
          is_florida_specific: boolean | null
          severity: string | null
          standard_comment_language: string | null
          title: string
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          discipline?: string | null
          fbc_section: string
          firm_id?: string | null
          id?: string
          is_florida_specific?: boolean | null
          severity?: string | null
          standard_comment_language?: string | null
          title: string
        }
        Update: {
          created_at?: string | null
          description?: string | null
          discipline?: string | null
          fbc_section?: string
          firm_id?: string | null
          id?: string
          is_florida_specific?: boolean | null
          severity?: string | null
          standard_comment_language?: string | null
          title?: string
        }
        Relationships: []
      }
      deficiencies_v2: {
        Row: {
          code_reference: Json | null
          confidence_basis: string | null
          confidence_score: number | null
          created_at: string
          def_number: string
          discipline: string
          evidence: string[] | null
          finding: string
          firm_id: string | null
          human_review_method: string | null
          human_review_reason: string | null
          human_review_verify: string | null
          id: string
          liability_flag: boolean
          life_safety_flag: boolean
          model_version: string | null
          permit_blocker: boolean
          plan_review_id: string
          priority: string
          prompt_version_id: string | null
          required_action: string
          requires_human_review: boolean
          reviewer_disposition: string | null
          reviewer_notes: string | null
          sheet_refs: string[] | null
          status: string
          updated_at: string
          verification_notes: string
          verification_status: string
        }
        Insert: {
          code_reference?: Json | null
          confidence_basis?: string | null
          confidence_score?: number | null
          created_at?: string
          def_number: string
          discipline: string
          evidence?: string[] | null
          finding: string
          firm_id?: string | null
          human_review_method?: string | null
          human_review_reason?: string | null
          human_review_verify?: string | null
          id?: string
          liability_flag?: boolean
          life_safety_flag?: boolean
          model_version?: string | null
          permit_blocker?: boolean
          plan_review_id: string
          priority?: string
          prompt_version_id?: string | null
          required_action: string
          requires_human_review?: boolean
          reviewer_disposition?: string | null
          reviewer_notes?: string | null
          sheet_refs?: string[] | null
          status?: string
          updated_at?: string
          verification_notes?: string
          verification_status?: string
        }
        Update: {
          code_reference?: Json | null
          confidence_basis?: string | null
          confidence_score?: number | null
          created_at?: string
          def_number?: string
          discipline?: string
          evidence?: string[] | null
          finding?: string
          firm_id?: string | null
          human_review_method?: string | null
          human_review_reason?: string | null
          human_review_verify?: string | null
          id?: string
          liability_flag?: boolean
          life_safety_flag?: boolean
          model_version?: string | null
          permit_blocker?: boolean
          plan_review_id?: string
          priority?: string
          prompt_version_id?: string | null
          required_action?: string
          requires_human_review?: boolean
          reviewer_disposition?: string | null
          reviewer_notes?: string | null
          sheet_refs?: string[] | null
          status?: string
          updated_at?: string
          verification_notes?: string
          verification_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "deficiencies_v2_plan_review_id_fkey"
            columns: ["plan_review_id"]
            isOneToOne: false
            referencedRelation: "plan_reviews"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deficiencies_v2_prompt_version_id_fkey"
            columns: ["prompt_version_id"]
            isOneToOne: false
            referencedRelation: "prompt_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      discipline_negative_space: {
        Row: {
          created_at: string
          description: string
          discipline: string
          fbc_section: string | null
          id: string
          is_active: boolean
          item_key: string
          sort_order: number
          trigger_condition: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          description: string
          discipline: string
          fbc_section?: string | null
          id?: string
          is_active?: boolean
          item_key: string
          sort_order?: number
          trigger_condition?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string
          discipline?: string
          fbc_section?: string | null
          id?: string
          is_active?: boolean
          item_key?: string
          sort_order?: number
          trigger_condition?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      fee_schedules: {
        Row: {
          base_fee: number
          county: string
          created_at: string
          description: string
          firm_id: string | null
          id: string
          is_active: boolean
          service_type: string
          trade_type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          base_fee?: number
          county?: string
          created_at?: string
          description?: string
          firm_id?: string | null
          id?: string
          is_active?: boolean
          service_type?: string
          trade_type?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          base_fee?: number
          county?: string
          created_at?: string
          description?: string
          firm_id?: string | null
          id?: string
          is_active?: boolean
          service_type?: string
          trade_type?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      finding_status_history: {
        Row: {
          changed_at: string
          changed_by: string
          finding_index: number
          firm_id: string | null
          id: string
          new_status: string
          note: string | null
          old_status: string
          plan_review_id: string
        }
        Insert: {
          changed_at?: string
          changed_by: string
          finding_index: number
          firm_id?: string | null
          id?: string
          new_status: string
          note?: string | null
          old_status?: string
          plan_review_id: string
        }
        Update: {
          changed_at?: string
          changed_by?: string
          finding_index?: number
          firm_id?: string | null
          id?: string
          new_status?: string
          note?: string | null
          old_status?: string
          plan_review_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "finding_status_history_plan_review_id_fkey"
            columns: ["plan_review_id"]
            isOneToOne: false
            referencedRelation: "plan_reviews"
            referencedColumns: ["id"]
          },
        ]
      }
      firm_members: {
        Row: {
          created_at: string
          firm_id: string
          id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          firm_id: string
          id?: string
          user_id: string
        }
        Update: {
          created_at?: string
          firm_id?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "firm_members_firm_id_fkey"
            columns: ["firm_id"]
            isOneToOne: false
            referencedRelation: "firms"
            referencedColumns: ["id"]
          },
        ]
      }
      firm_settings: {
        Row: {
          address: string | null
          closing_language: string | null
          created_at: string
          email: string | null
          firm_name: string
          id: string
          jurisdictions: Json | null
          license_number: string | null
          logo_url: string | null
          phone: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          address?: string | null
          closing_language?: string | null
          created_at?: string
          email?: string | null
          firm_name?: string
          id?: string
          jurisdictions?: Json | null
          license_number?: string | null
          logo_url?: string | null
          phone?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          address?: string | null
          closing_language?: string | null
          created_at?: string
          email?: string | null
          firm_name?: string
          id?: string
          jurisdictions?: Json | null
          license_number?: string | null
          logo_url?: string | null
          phone?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      firms: {
        Row: {
          created_at: string
          id: string
          name: string
          owner_user_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          owner_user_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          owner_user_id?: string | null
        }
        Relationships: []
      }
      flag_embeddings: {
        Row: {
          correction_id: string | null
          created_at: string | null
          embedding: string | null
          id: string
        }
        Insert: {
          correction_id?: string | null
          created_at?: string | null
          embedding?: string | null
          id?: string
        }
        Update: {
          correction_id?: string | null
          created_at?: string | null
          embedding?: string | null
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "flag_embeddings_correction_id_fkey"
            columns: ["correction_id"]
            isOneToOne: false
            referencedRelation: "corrections"
            referencedColumns: ["id"]
          },
        ]
      }
      inspections: {
        Row: {
          certificate_issued: boolean
          created_at: string
          firm_id: string | null
          id: string
          inspection_type: string
          inspector_id: string | null
          notes: string | null
          project_id: string
          result: Database["public"]["Enums"]["inspection_result"]
          scheduled_at: string | null
          updated_at: string
          video_call_url: string | null
          virtual: boolean
        }
        Insert: {
          certificate_issued?: boolean
          created_at?: string
          firm_id?: string | null
          id?: string
          inspection_type?: string
          inspector_id?: string | null
          notes?: string | null
          project_id: string
          result?: Database["public"]["Enums"]["inspection_result"]
          scheduled_at?: string | null
          updated_at?: string
          video_call_url?: string | null
          virtual?: boolean
        }
        Update: {
          certificate_issued?: boolean
          created_at?: string
          firm_id?: string | null
          id?: string
          inspection_type?: string
          inspector_id?: string | null
          notes?: string | null
          project_id?: string
          result?: Database["public"]["Enums"]["inspection_result"]
          scheduled_at?: string | null
          updated_at?: string
          video_call_url?: string | null
          virtual?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "inspections_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_line_items: {
        Row: {
          created_at: string
          description: string
          firm_id: string | null
          id: string
          invoice_id: string
          quantity: number
          service_type: string | null
          sort_order: number
          total: number
          unit_price: number
        }
        Insert: {
          created_at?: string
          description?: string
          firm_id?: string | null
          id?: string
          invoice_id: string
          quantity?: number
          service_type?: string | null
          sort_order?: number
          total?: number
          unit_price?: number
        }
        Update: {
          created_at?: string
          description?: string
          firm_id?: string | null
          id?: string
          invoice_id?: string
          quantity?: number
          service_type?: string | null
          sort_order?: number
          total?: number
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "invoice_line_items_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          amount_paid: number
          contractor_id: string | null
          created_at: string
          custom_footer: string
          due_at: string | null
          firm_id: string | null
          id: string
          invoice_number: string
          issued_at: string | null
          notes: string
          paid_at: string | null
          project_id: string
          status: string
          subtotal: number
          tax_amount: number
          tax_rate: number
          total: number
          updated_at: string
          user_id: string
        }
        Insert: {
          amount_paid?: number
          contractor_id?: string | null
          created_at?: string
          custom_footer?: string
          due_at?: string | null
          firm_id?: string | null
          id?: string
          invoice_number?: string
          issued_at?: string | null
          notes?: string
          paid_at?: string | null
          project_id: string
          status?: string
          subtotal?: number
          tax_amount?: number
          tax_rate?: number
          total?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          amount_paid?: number
          contractor_id?: string | null
          created_at?: string
          custom_footer?: string
          due_at?: string | null
          firm_id?: string | null
          id?: string
          invoice_number?: string
          issued_at?: string | null
          notes?: string
          paid_at?: string | null
          project_id?: string
          status?: string
          subtotal?: number
          tax_amount?: number
          tax_rate?: number
          total?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoices_contractor_id_fkey"
            columns: ["contractor_id"]
            isOneToOne: false
            referencedRelation: "contractors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      jurisdictions_fl: {
        Row: {
          coastal: boolean
          county: string
          created_at: string
          fbc_edition: string
          flood_zone_critical: boolean
          high_volume: boolean
          hvhz: boolean
          id: string
          local_amendments_url: string | null
          notes: string | null
          updated_at: string
        }
        Insert: {
          coastal?: boolean
          county: string
          created_at?: string
          fbc_edition?: string
          flood_zone_critical?: boolean
          high_volume?: boolean
          hvhz?: boolean
          id?: string
          local_amendments_url?: string | null
          notes?: string | null
          updated_at?: string
        }
        Update: {
          coastal?: boolean
          county?: string
          created_at?: string
          fbc_edition?: string
          flood_zone_critical?: boolean
          high_volume?: boolean
          hvhz?: boolean
          id?: string
          local_amendments_url?: string | null
          notes?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      milestone_buildings: {
        Row: {
          address: string
          building_name: string
          co_issued_date: string | null
          contact_email: string | null
          contact_name: string | null
          contact_phone: string | null
          created_at: string
          firm_id: string | null
          id: string
          milestone_deadline: string | null
          status: Database["public"]["Enums"]["milestone_status"]
          stories: number
          updated_at: string
        }
        Insert: {
          address: string
          building_name: string
          co_issued_date?: string | null
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          firm_id?: string | null
          id?: string
          milestone_deadline?: string | null
          status?: Database["public"]["Enums"]["milestone_status"]
          stories?: number
          updated_at?: string
        }
        Update: {
          address?: string
          building_name?: string
          co_issued_date?: string | null
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          firm_id?: string | null
          id?: string
          milestone_deadline?: string | null
          status?: Database["public"]["Enums"]["milestone_status"]
          stories?: number
          updated_at?: string
        }
        Relationships: []
      }
      permit_leads: {
        Row: {
          address: string
          contractor_id: string | null
          contractor_name: string | null
          county: string
          created_at: string
          detected_at: string
          firm_id: string | null
          id: string
          outreach_status: Database["public"]["Enums"]["outreach_status"]
          permit_type: string
          project_value: number | null
          updated_at: string
        }
        Insert: {
          address: string
          contractor_id?: string | null
          contractor_name?: string | null
          county?: string
          created_at?: string
          detected_at?: string
          firm_id?: string | null
          id?: string
          outreach_status?: Database["public"]["Enums"]["outreach_status"]
          permit_type?: string
          project_value?: number | null
          updated_at?: string
        }
        Update: {
          address?: string
          contractor_id?: string | null
          contractor_name?: string | null
          county?: string
          created_at?: string
          detected_at?: string
          firm_id?: string | null
          id?: string
          outreach_status?: Database["public"]["Enums"]["outreach_status"]
          permit_type?: string
          project_value?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "permit_leads_contractor_id_fkey"
            columns: ["contractor_id"]
            isOneToOne: false
            referencedRelation: "contractors"
            referencedColumns: ["id"]
          },
        ]
      }
      plan_review_files: {
        Row: {
          file_path: string
          firm_id: string | null
          id: string
          plan_review_id: string
          round: number
          uploaded_at: string
          uploaded_by: string | null
        }
        Insert: {
          file_path: string
          firm_id?: string | null
          id?: string
          plan_review_id: string
          round?: number
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Update: {
          file_path?: string
          firm_id?: string | null
          id?: string
          plan_review_id?: string
          round?: number
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "plan_review_files_plan_review_id_fkey"
            columns: ["plan_review_id"]
            isOneToOne: false
            referencedRelation: "plan_reviews"
            referencedColumns: ["id"]
          },
        ]
      }
      plan_reviews: {
        Row: {
          ai_check_status: string
          ai_findings: Json | null
          ai_run_progress: Json | null
          checklist_state: Json | null
          comment_letter_draft: string
          created_at: string
          fbc_edition: string | null
          file_urls: string[]
          finding_statuses: Json | null
          firm_id: string | null
          id: string
          previous_findings: Json | null
          project_id: string
          qc_notes: string | null
          qc_reviewer_id: string | null
          qc_status: string
          reviewer_id: string | null
          round: number
          updated_at: string
        }
        Insert: {
          ai_check_status?: string
          ai_findings?: Json | null
          ai_run_progress?: Json | null
          checklist_state?: Json | null
          comment_letter_draft?: string
          created_at?: string
          fbc_edition?: string | null
          file_urls?: string[]
          finding_statuses?: Json | null
          firm_id?: string | null
          id?: string
          previous_findings?: Json | null
          project_id: string
          qc_notes?: string | null
          qc_reviewer_id?: string | null
          qc_status?: string
          reviewer_id?: string | null
          round?: number
          updated_at?: string
        }
        Update: {
          ai_check_status?: string
          ai_findings?: Json | null
          ai_run_progress?: Json | null
          checklist_state?: Json | null
          comment_letter_draft?: string
          created_at?: string
          fbc_edition?: string | null
          file_urls?: string[]
          finding_statuses?: Json | null
          firm_id?: string | null
          id?: string
          previous_findings?: Json | null
          project_id?: string
          qc_notes?: string | null
          qc_reviewer_id?: string | null
          qc_status?: string
          reviewer_id?: string | null
          round?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "plan_reviews_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          full_name: string
          id: string
          role: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          full_name?: string
          id: string
          role?: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          full_name?: string
          id?: string
          role?: string
          updated_at?: string
        }
        Relationships: []
      }
      project_dna: {
        Row: {
          ambiguous_fields: string[] | null
          construction_type: string | null
          county: string | null
          exposure_category: string | null
          extracted_at: string
          fbc_edition: string | null
          firm_id: string | null
          flood_zone: string | null
          has_mezzanine: boolean | null
          hvhz: boolean | null
          id: string
          is_high_rise: boolean | null
          jurisdiction: string | null
          missing_fields: string[] | null
          mixed_occupancy: boolean | null
          occupancy_classification: string | null
          plan_review_id: string
          raw_extraction: Json | null
          risk_category: string | null
          seismic_design_category: string | null
          stories: number | null
          total_sq_ft: number | null
          updated_at: string
          wind_speed_vult: number | null
        }
        Insert: {
          ambiguous_fields?: string[] | null
          construction_type?: string | null
          county?: string | null
          exposure_category?: string | null
          extracted_at?: string
          fbc_edition?: string | null
          firm_id?: string | null
          flood_zone?: string | null
          has_mezzanine?: boolean | null
          hvhz?: boolean | null
          id?: string
          is_high_rise?: boolean | null
          jurisdiction?: string | null
          missing_fields?: string[] | null
          mixed_occupancy?: boolean | null
          occupancy_classification?: string | null
          plan_review_id: string
          raw_extraction?: Json | null
          risk_category?: string | null
          seismic_design_category?: string | null
          stories?: number | null
          total_sq_ft?: number | null
          updated_at?: string
          wind_speed_vult?: number | null
        }
        Update: {
          ambiguous_fields?: string[] | null
          construction_type?: string | null
          county?: string | null
          exposure_category?: string | null
          extracted_at?: string
          fbc_edition?: string | null
          firm_id?: string | null
          flood_zone?: string | null
          has_mezzanine?: boolean | null
          hvhz?: boolean | null
          id?: string
          is_high_rise?: boolean | null
          jurisdiction?: string | null
          missing_fields?: string[] | null
          mixed_occupancy?: boolean | null
          occupancy_classification?: string | null
          plan_review_id?: string
          raw_extraction?: Json | null
          risk_category?: string | null
          seismic_design_category?: string | null
          stories?: number | null
          total_sq_ft?: number | null
          updated_at?: string
          wind_speed_vult?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "project_dna_plan_review_id_fkey"
            columns: ["plan_review_id"]
            isOneToOne: true
            referencedRelation: "plan_reviews"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          address: string
          assigned_to: string | null
          contractor_id: string | null
          county: string
          created_at: string
          deadline_at: string | null
          firm_id: string | null
          hold_reason: string | null
          id: string
          inspection_clock_started_at: string | null
          jurisdiction: string
          name: string
          notice_filed_at: string | null
          review_clock_paused_at: string | null
          review_clock_started_at: string | null
          services: string[]
          status: Database["public"]["Enums"]["project_status"]
          statutory_deadline_at: string | null
          statutory_inspection_days: number
          statutory_review_days: number
          trade_type: string
          updated_at: string
          zoning_data: Json | null
        }
        Insert: {
          address: string
          assigned_to?: string | null
          contractor_id?: string | null
          county?: string
          created_at?: string
          deadline_at?: string | null
          firm_id?: string | null
          hold_reason?: string | null
          id?: string
          inspection_clock_started_at?: string | null
          jurisdiction?: string
          name: string
          notice_filed_at?: string | null
          review_clock_paused_at?: string | null
          review_clock_started_at?: string | null
          services?: string[]
          status?: Database["public"]["Enums"]["project_status"]
          statutory_deadline_at?: string | null
          statutory_inspection_days?: number
          statutory_review_days?: number
          trade_type?: string
          updated_at?: string
          zoning_data?: Json | null
        }
        Update: {
          address?: string
          assigned_to?: string | null
          contractor_id?: string | null
          county?: string
          created_at?: string
          deadline_at?: string | null
          firm_id?: string | null
          hold_reason?: string | null
          id?: string
          inspection_clock_started_at?: string | null
          jurisdiction?: string
          name?: string
          notice_filed_at?: string | null
          review_clock_paused_at?: string | null
          review_clock_started_at?: string | null
          services?: string[]
          status?: Database["public"]["Enums"]["project_status"]
          statutory_deadline_at?: string | null
          statutory_inspection_days?: number
          statutory_review_days?: number
          trade_type?: string
          updated_at?: string
          zoning_data?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "projects_contractor_id_fkey"
            columns: ["contractor_id"]
            isOneToOne: false
            referencedRelation: "contractors"
            referencedColumns: ["id"]
          },
        ]
      }
      prompt_versions: {
        Row: {
          created_at: string
          created_by: string | null
          effective_at: string
          fbc_edition: string | null
          id: string
          is_active: boolean
          notes: string | null
          prompt_key: string
          system_prompt: string
          version: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          effective_at?: string
          fbc_edition?: string | null
          id?: string
          is_active?: boolean
          notes?: string | null
          prompt_key: string
          system_prompt: string
          version: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          effective_at?: string
          fbc_edition?: string | null
          id?: string
          is_active?: boolean
          notes?: string | null
          prompt_key?: string
          system_prompt?: string
          version?: number
        }
        Relationships: []
      }
      review_feedback: {
        Row: {
          created_at: string
          deficiency_id: string | null
          feedback_type: string
          firm_id: string | null
          id: string
          notes: string | null
          plan_review_id: string
          reviewer_id: string | null
        }
        Insert: {
          created_at?: string
          deficiency_id?: string | null
          feedback_type: string
          firm_id?: string | null
          id?: string
          notes?: string | null
          plan_review_id: string
          reviewer_id?: string | null
        }
        Update: {
          created_at?: string
          deficiency_id?: string | null
          feedback_type?: string
          firm_id?: string | null
          id?: string
          notes?: string | null
          plan_review_id?: string
          reviewer_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "review_feedback_deficiency_id_fkey"
            columns: ["deficiency_id"]
            isOneToOne: false
            referencedRelation: "deficiencies_v2"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "review_feedback_plan_review_id_fkey"
            columns: ["plan_review_id"]
            isOneToOne: false
            referencedRelation: "plan_reviews"
            referencedColumns: ["id"]
          },
        ]
      }
      review_flags: {
        Row: {
          confidence: string | null
          created_at: string | null
          description: string | null
          detail_ref: string | null
          fbc_section: string | null
          firm_id: string | null
          id: string
          project_id: string | null
          resolved_at: string | null
          resolved_by: string | null
          severity: string | null
          sheet_ref: string | null
          status: string | null
        }
        Insert: {
          confidence?: string | null
          created_at?: string | null
          description?: string | null
          detail_ref?: string | null
          fbc_section?: string | null
          firm_id?: string | null
          id?: string
          project_id?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string | null
          sheet_ref?: string | null
          status?: string | null
        }
        Update: {
          confidence?: string | null
          created_at?: string | null
          description?: string | null
          detail_ref?: string | null
          fbc_section?: string | null
          firm_id?: string | null
          id?: string
          project_id?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string | null
          sheet_ref?: string | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "review_flags_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      review_pipeline_status: {
        Row: {
          completed_at: string | null
          error_message: string | null
          firm_id: string | null
          id: string
          metadata: Json | null
          plan_review_id: string
          stage: string
          started_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          error_message?: string | null
          firm_id?: string | null
          id?: string
          metadata?: Json | null
          plan_review_id: string
          stage: string
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          error_message?: string | null
          firm_id?: string | null
          id?: string
          metadata?: Json | null
          plan_review_id?: string
          stage?: string
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "review_pipeline_status_plan_review_id_fkey"
            columns: ["plan_review_id"]
            isOneToOne: false
            referencedRelation: "plan_reviews"
            referencedColumns: ["id"]
          },
        ]
      }
      sheet_coverage: {
        Row: {
          created_at: string
          discipline: string | null
          expected: boolean
          firm_id: string | null
          id: string
          page_index: number | null
          plan_review_id: string
          sheet_ref: string
          sheet_title: string | null
          status: string
        }
        Insert: {
          created_at?: string
          discipline?: string | null
          expected?: boolean
          firm_id?: string | null
          id?: string
          page_index?: number | null
          plan_review_id: string
          sheet_ref: string
          sheet_title?: string | null
          status?: string
        }
        Update: {
          created_at?: string
          discipline?: string | null
          expected?: boolean
          firm_id?: string | null
          id?: string
          page_index?: number | null
          plan_review_id?: string
          sheet_ref?: string
          sheet_title?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "sheet_coverage_plan_review_id_fkey"
            columns: ["plan_review_id"]
            isOneToOne: false
            referencedRelation: "plan_reviews"
            referencedColumns: ["id"]
          },
        ]
      }
      statutory_alerts: {
        Row: {
          acknowledged: boolean
          alert_type: string
          firm_id: string | null
          id: string
          project_id: string
          triggered_at: string
        }
        Insert: {
          acknowledged?: boolean
          alert_type: string
          firm_id?: string | null
          id?: string
          project_id: string
          triggered_at?: string
        }
        Update: {
          acknowledged?: boolean
          alert_type?: string
          firm_id?: string | null
          id?: string
          project_id?: string
          triggered_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "statutory_alerts_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      check_deadline_alerts: { Args: never; Returns: undefined }
      compute_statutory_deadline: {
        Args: { business_days: number; start_date: string }
        Returns: string
      }
      generate_invoice_number: { Args: never; Returns: string }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      user_firm_id: { Args: { _user: string }; Returns: string }
    }
    Enums: {
      app_role: "admin" | "reviewer" | "qc" | "viewer"
      inspection_result: "pass" | "fail" | "partial" | "pending"
      milestone_status:
        | "compliant"
        | "due_soon"
        | "overdue"
        | "inspection_scheduled"
      outreach_status:
        | "new"
        | "contacted"
        | "responded"
        | "converted"
        | "declined"
      project_status:
        | "intake"
        | "plan_review"
        | "comments_sent"
        | "resubmitted"
        | "approved"
        | "permit_issued"
        | "inspection_scheduled"
        | "inspection_complete"
        | "certificate_issued"
        | "on_hold"
        | "cancelled"
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
      app_role: ["admin", "reviewer", "qc", "viewer"],
      inspection_result: ["pass", "fail", "partial", "pending"],
      milestone_status: [
        "compliant",
        "due_soon",
        "overdue",
        "inspection_scheduled",
      ],
      outreach_status: [
        "new",
        "contacted",
        "responded",
        "converted",
        "declined",
      ],
      project_status: [
        "intake",
        "plan_review",
        "comments_sent",
        "resubmitted",
        "approved",
        "permit_issued",
        "inspection_scheduled",
        "inspection_complete",
        "certificate_issued",
        "on_hold",
        "cancelled",
      ],
    },
  },
} as const
