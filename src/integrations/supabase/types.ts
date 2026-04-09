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
      contractors: {
        Row: {
          created_at: string
          email: string | null
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
      deadline_alerts: {
        Row: {
          acknowledged: boolean
          alert_type: string
          id: string
          project_id: string
          triggered_at: string
        }
        Insert: {
          acknowledged?: boolean
          alert_type: string
          id?: string
          project_id: string
          triggered_at?: string
        }
        Update: {
          acknowledged?: boolean
          alert_type?: string
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
      finding_status_history: {
        Row: {
          changed_at: string
          changed_by: string
          finding_index: number
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
      firm_settings: {
        Row: {
          address: string | null
          closing_language: string | null
          created_at: string
          email: string | null
          firm_name: string
          id: string
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
          license_number?: string | null
          logo_url?: string | null
          phone?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      inspections: {
        Row: {
          certificate_issued: boolean
          created_at: string
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
      milestone_buildings: {
        Row: {
          address: string
          building_name: string
          co_issued_date: string | null
          contact_email: string | null
          contact_name: string | null
          contact_phone: string | null
          created_at: string
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
          contractor_name: string | null
          county: string
          created_at: string
          detected_at: string
          id: string
          outreach_status: Database["public"]["Enums"]["outreach_status"]
          permit_type: string
          project_value: number | null
          updated_at: string
        }
        Insert: {
          address: string
          contractor_name?: string | null
          county?: string
          created_at?: string
          detected_at?: string
          id?: string
          outreach_status?: Database["public"]["Enums"]["outreach_status"]
          permit_type?: string
          project_value?: number | null
          updated_at?: string
        }
        Update: {
          address?: string
          contractor_name?: string | null
          county?: string
          created_at?: string
          detected_at?: string
          id?: string
          outreach_status?: Database["public"]["Enums"]["outreach_status"]
          permit_type?: string
          project_value?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      plan_review_files: {
        Row: {
          file_path: string
          id: string
          plan_review_id: string
          round: number
          uploaded_at: string
          uploaded_by: string | null
        }
        Insert: {
          file_path: string
          id?: string
          plan_review_id: string
          round?: number
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Update: {
          file_path?: string
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
          created_at: string
          file_urls: string[]
          finding_statuses: Json | null
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
          created_at?: string
          file_urls?: string[]
          finding_statuses?: Json | null
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
          created_at?: string
          file_urls?: string[]
          finding_statuses?: Json | null
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
      projects: {
        Row: {
          address: string
          assigned_to: string | null
          contractor_id: string | null
          county: string
          created_at: string
          deadline_at: string | null
          hold_reason: string | null
          id: string
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
        }
        Insert: {
          address: string
          assigned_to?: string | null
          contractor_id?: string | null
          county?: string
          created_at?: string
          deadline_at?: string | null
          hold_reason?: string | null
          id?: string
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
        }
        Update: {
          address?: string
          assigned_to?: string | null
          contractor_id?: string | null
          county?: string
          created_at?: string
          deadline_at?: string | null
          hold_reason?: string | null
          id?: string
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
      statutory_alerts: {
        Row: {
          acknowledged: boolean
          alert_type: string
          id: string
          project_id: string
          triggered_at: string
        }
        Insert: {
          acknowledged?: boolean
          alert_type: string
          id?: string
          project_id: string
          triggered_at?: string
        }
        Update: {
          acknowledged?: boolean
          alert_type?: string
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
    }
    Enums: {
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
