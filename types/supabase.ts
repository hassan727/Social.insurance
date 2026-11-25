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
    PostgrestVersion: "14.18"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      company_accounts: {
        Row: {
          id: number
          account_code: string
          account_name: string
          aliases: string[] | null
          description: string | null
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: number
          account_code: string
          account_name: string
          aliases?: string[] | null
          description?: string | null
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: number
          account_code?: string
          account_name?: string
          aliases?: string[] | null
          description?: string | null
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      employees_master: {
        Row: {
          id: string
          company_account: string
          account_id: number | null
          account_employee_uid: string | null
          employee_code: string | null
          national_id: string | null
          employee_name: string
          current_status: string | null
          current_job_title: string | null
          current_region: string | null
          current_department: string | null
          insurance_number: string | null
          insurance_status: string | null
          insurance_salary: number | null
          insurance_job_title: string | null
          insurance_start_date: string | null
          hire_date: string | null
          resignation_date: string | null
          last_working_day: string | null
          phone_number: string | null
          address: string | null
          consolidated_data: Json
          first_seen_at: string
          last_updated_at: string
          last_import_id: string | null
          has_duplicate_risk: boolean | null
          data_completeness_score: number | null
          created_at: string
        }
        Insert: {
          id?: string
          company_account: string
          account_id?: number | null
          account_employee_uid?: string | null
          employee_code?: string | null
          national_id?: string | null
          employee_name: string
          current_status?: string | null
          current_job_title?: string | null
          current_region?: string | null
          current_department?: string | null
          insurance_number?: string | null
          insurance_status?: string | null
          insurance_salary?: number | null
          insurance_job_title?: string | null
          insurance_start_date?: string | null
          hire_date?: string | null
          resignation_date?: string | null
          last_working_day?: string | null
          phone_number?: string | null
          address?: string | null
          consolidated_data?: Json
          first_seen_at?: string
          last_updated_at?: string
          last_import_id?: string | null
          has_duplicate_risk?: boolean | null
          data_completeness_score?: number | null
          created_at?: string
        }
        Update: {
          id?: string
          company_account?: string
          account_id?: number | null
          account_employee_uid?: string | null
          employee_code?: string | null
          national_id?: string | null
          employee_name?: string
          current_status?: string | null
          current_job_title?: string | null
          current_region?: string | null
          current_department?: string | null
          insurance_number?: string | null
          insurance_status?: string | null
          insurance_salary?: number | null
          insurance_job_title?: string | null
          insurance_start_date?: string | null
          hire_date?: string | null
          resignation_date?: string | null
          last_working_day?: string | null
          phone_number?: string | null
          address?: string | null
          consolidated_data?: Json
          first_seen_at?: string
          last_updated_at?: string
          last_import_id?: string | null
          has_duplicate_risk?: boolean | null
          data_completeness_score?: number | null
          created_at?: string
        }
        Relationships: []
      }
      employee_history: {
        Row: {
          id: string
          employee_id: string | null
          change_type: string
          from_company_account: string | null
          to_company_account: string | null
          from_employee_code: string | null
          to_employee_code: string | null
          changed_fields: string[] | null
          old_values: Json | null
          new_values: Json | null
          import_id: string | null
          change_reason: string | null
          notes: string | null
          effective_date: string | null
          confirmed_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          employee_id?: string | null
          change_type: string
          from_company_account?: string | null
          to_company_account?: string | null
          from_employee_code?: string | null
          to_employee_code?: string | null
          changed_fields?: string[] | null
          old_values?: Json | null
          new_values?: Json | null
          import_id?: string | null
          change_reason?: string | null
          notes?: string | null
          effective_date?: string | null
          confirmed_by?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          employee_id?: string | null
          change_type?: string
          from_company_account?: string | null
          to_company_account?: string | null
          from_employee_code?: string | null
          to_employee_code?: string | null
          changed_fields?: string[] | null
          old_values?: Json | null
          new_values?: Json | null
          import_id?: string | null
          change_reason?: string | null
          notes?: string | null
          effective_date?: string | null
          confirmed_by?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "employee_history_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees_master"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_history_import_id_fkey"
            columns: ["import_id"]
            isOneToOne: false
            referencedRelation: "import_logs"
            referencedColumns: ["id"]
          }
        ]
      }
      dynamic_sheets: {
        Row: {
          id: string
          account_id: number | null
          sheet_name: string
          display_name: string
          description: string | null
          column_definitions: Json
          matching_keys: string[]
          primary_key_field: string | null
          is_active: boolean | null
          is_master_source: boolean | null
          update_strategy: string | null
          total_columns: number | null
          last_import_date: string | null
          total_records_imported: number | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          account_id?: number | null
          sheet_name: string
          display_name: string
          description?: string | null
          column_definitions: Json
          matching_keys: string[]
          primary_key_field?: string | null
          is_active?: boolean | null
          is_master_source?: boolean | null
          update_strategy?: string | null
          total_columns?: number | null
          last_import_date?: string | null
          total_records_imported?: number | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          account_id?: number | null
          sheet_name?: string
          display_name?: string
          description?: string | null
          column_definitions?: Json
          matching_keys?: string[]
          primary_key_field?: string | null
          is_active?: boolean | null
          is_master_source?: boolean | null
          update_strategy?: string | null
          total_columns?: number | null
          last_import_date?: string | null
          total_records_imported?: number | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "dynamic_sheets_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "company_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      sheet_data: {
        Row: {
          id: string
          sheet_id: string | null
          employee_id: string | null
          row_data: Json
          row_code: string | null
          row_national_id: string | null
          row_name: string | null
          import_id: string | null
          row_number: number | null
          is_latest: boolean | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          sheet_id?: string | null
          employee_id?: string | null
          row_data: Json
          row_code?: string | null
          row_national_id?: string | null
          row_name?: string | null
          import_id?: string | null
          row_number?: number | null
          is_latest?: boolean | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          sheet_id?: string | null
          employee_id?: string | null
          row_data?: Json
          row_code?: string | null
          row_national_id?: string | null
          row_name?: string | null
          import_id?: string | null
          row_number?: number | null
          is_latest?: boolean | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sheet_data_sheet_id_fkey"
            columns: ["sheet_id"]
            isOneToOne: false
            referencedRelation: "dynamic_sheets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sheet_data_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees_master"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sheet_data_import_id_fkey"
            columns: ["import_id"]
            isOneToOne: false
            referencedRelation: "import_logs"
            referencedColumns: ["id"]
          }
        ]
      }
      matching_conflicts: {
        Row: {
          id: string
          employee_a_id: string | null
          employee_b_id: string | null
          conflict_type: string
          confidence_score: number | null
          conflict_data: Json | null
          resolved: boolean | null
          resolution_action: string | null
          resolved_by: string | null
          resolved_at: string | null
          resolution_notes: string | null
          created_at: string
        }
        Insert: {
          id?: string
          employee_a_id?: string | null
          employee_b_id?: string | null
          conflict_type: string
          confidence_score?: number | null
          conflict_data?: Json | null
          resolved?: boolean | null
          resolution_action?: string | null
          resolved_by?: string | null
          resolved_at?: string | null
          resolution_notes?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          employee_a_id?: string | null
          employee_b_id?: string | null
          conflict_type?: string
          confidence_score?: number | null
          conflict_data?: Json | null
          resolved?: boolean | null
          resolution_action?: string | null
          resolved_by?: string | null
          resolved_at?: string | null
          resolution_notes?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "matching_conflicts_employee_a_id_fkey"
            columns: ["employee_a_id"]
            isOneToOne: false
            referencedRelation: "employees_master"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matching_conflicts_employee_b_id_fkey"
            columns: ["employee_b_id"]
            isOneToOne: false
            referencedRelation: "employees_master"
            referencedColumns: ["id"]
          }
        ]
      }
      search_history: {
        Row: {
          id: string
          search_query: string
          national_id: string | null
          employee_code: string | null
          employee_name: string | null
          result_found: boolean | null
          results_count: number | null
          search_timestamp: string
          user_ip: string | null
          company_account: string | null
          insurance_status: string | null
          status: string | null
          has_resignation: boolean | null
          first_both_month: string | null
          attendance_days: string | null
          search_result: Json | null
          created_at: string
        }
        Insert: {
          id?: string
          search_query: string
          national_id?: string | null
          employee_code?: string | null
          employee_name?: string | null
          result_found?: boolean | null
          results_count?: number | null
          search_timestamp?: string
          user_ip?: string | null
          company_account?: string | null
          insurance_status?: string | null
          status?: string | null
          has_resignation?: boolean | null
          first_both_month?: string | null
          attendance_days?: string | null
          search_result?: Json | null
          created_at?: string
        }
        Update: {
          id?: string
          search_query?: string
          national_id?: string | null
          employee_code?: string | null
          employee_name?: string | null
          result_found?: boolean | null
          results_count?: number | null
          search_timestamp?: string
          user_ip?: string | null
          company_account?: string | null
          insurance_status?: string | null
          status?: string | null
          has_resignation?: boolean | null
          first_both_month?: string | null
          attendance_days?: string | null
          search_result?: Json | null
          created_at?: string
        }
        Relationships: []
      }
      import_logs: {
        Row: {
          account_id: number | null
          column_mapping: Json | null
          created_at: string
          file_name: string
          id: string
          notes: string | null
          period_month: number | null
          period_year: number | null
          rows_accepted: number | null
          rows_rejected: number | null
          sheet_name: string | null
          source_type: string
          total_rows_read: number | null
        }
        Insert: {
          account_id?: number | null
          column_mapping?: Json | null
          created_at?: string
          file_name: string
          id?: string
          notes?: string | null
          period_month?: number | null
          period_year?: number | null
          rows_accepted?: number | null
          rows_rejected?: number | null
          sheet_name?: string | null
          source_type: string
          total_rows_read?: number | null
        }
        Update: {
          account_id?: number | null
          column_mapping?: Json | null
          created_at?: string
          file_name?: string
          id?: string
          notes?: string | null
          period_month?: number | null
          period_year?: number | null
          rows_accepted?: number | null
          rows_rejected?: number | null
          sheet_name?: string | null
          source_type?: string
          total_rows_read?: number | null
        }
        Relationships: []
      }
      incoming_insurance_records: {
        Row: {
          company_account: string | null
          created_at: string
          crm_number: string | null
          employee_code: string | null
          employee_name: string | null
          form_type: string | null
          id: string
          import_id: string | null
          insurance_job_title: string | null
          insurance_number: string | null
          insurance_status: string | null
          job_title: string | null
          national_id: string | null
          note: string | null
          raw_data: Json | null
          record_date: string | null
          status: string | null
          subscription_end_date: string | null
          subscription_start_date: string | null
          supply_method: string | null
          termination_reason: string | null
        }
        Insert: {
          company_account?: string | null
          created_at?: string
          crm_number?: string | null
          employee_code?: string | null
          employee_name?: string | null
          form_type?: string | null
          id?: string
          import_id?: string | null
          insurance_job_title?: string | null
          insurance_number?: string | null
          insurance_status?: string | null
          job_title?: string | null
          national_id?: string | null
          note?: string | null
          raw_data?: Json | null
          record_date?: string | null
          status?: string | null
          subscription_end_date?: string | null
          subscription_start_date?: string | null
          supply_method?: string | null
          termination_reason?: string | null
        }
        Update: {
          company_account?: string | null
          created_at?: string
          crm_number?: string | null
          employee_code?: string | null
          employee_name?: string | null
          form_type?: string | null
          id?: string
          import_id?: string | null
          insurance_job_title?: string | null
          insurance_number?: string | null
          insurance_status?: string | null
          job_title?: string | null
          national_id?: string | null
          note?: string | null
          raw_data?: Json | null
          record_date?: string | null
          status?: string | null
          subscription_end_date?: string | null
          subscription_start_date?: string | null
          supply_method?: string | null
          termination_reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "incoming_insurance_records_import_id_fkey"
            columns: ["import_id"]
            isOneToOne: false
            referencedRelation: "import_logs"
            referencedColumns: ["id"]
          },
        ]
      }
      monthly_insurance_records: {
        Row: {
          account_id: number | null
          created_at: string
          department: string | null
          employee_code: string | null
          employee_name: string | null
          id: string
          import_id: string | null
          insurance_number: string | null
          job_title: string | null
          national_id: string | null
          period_month: number
          period_year: number
          raw_data: Json | null
          region: string | null
          sap_code: string | null
        }
        Insert: {
          account_id?: number | null
          created_at?: string
          department?: string | null
          employee_code?: string | null
          employee_name?: string | null
          id?: string
          import_id?: string | null
          insurance_number?: string | null
          job_title?: string | null
          national_id?: string | null
          period_month: number
          period_year: number
          raw_data?: Json | null
          region?: string | null
          sap_code?: string | null
        }
        Update: {
          account_id?: number | null
          created_at?: string
          department?: string | null
          employee_code?: string | null
          employee_name?: string | null
          id?: string
          import_id?: string | null
          insurance_number?: string | null
          job_title?: string | null
          national_id?: string | null
          period_month?: number
          period_year?: number
          raw_data?: Json | null
          region?: string | null
          sap_code?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "monthly_insurance_records_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "company_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "monthly_insurance_records_import_id_fkey"
            columns: ["import_id"]
            isOneToOne: false
            referencedRelation: "import_logs"
            referencedColumns: ["id"]
          },
        ]
      }
      monthly_payroll_records: {
        Row: {
          account_id: number | null
          attendance_days: string | null
          created_at: string
          department: string | null
          employee_code: string | null
          employee_name: string | null
          id: string
          import_id: string | null
          job_title: string | null
          national_id: string | null
          note: string | null
          period_month: number
          period_year: number
          raw_data: Json | null
          region: string | null
          review_status: string | null
          sap_code: string | null
        }
        Insert: {
          account_id?: number | null
          attendance_days?: string | null
          created_at?: string
          department?: string | null
          employee_code?: string | null
          employee_name?: string | null
          id?: string
          import_id?: string | null
          job_title?: string | null
          national_id?: string | null
          note?: string | null
          period_month: number
          period_year: number
          raw_data?: Json | null
          region?: string | null
          review_status?: string | null
          sap_code?: string | null
        }
        Update: {
          account_id?: number | null
          attendance_days?: string | null
          created_at?: string
          department?: string | null
          employee_code?: string | null
          employee_name?: string | null
          id?: string
          import_id?: string | null
          job_title?: string | null
          national_id?: string | null
          note?: string | null
          period_month?: number
          period_year?: number
          raw_data?: Json | null
          region?: string | null
          review_status?: string | null
          sap_code?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "monthly_payroll_records_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "company_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "monthly_payroll_records_import_id_fkey"
            columns: ["import_id"]
            isOneToOne: false
            referencedRelation: "import_logs"
            referencedColumns: ["id"]
          },
        ]
      }
      resignation_records: {
        Row: {
          created_at: string
          employee_code: string | null
          employee_name: string | null
          id: string
          import_id: string | null
          insurance_supply_type: string | null
          last_working_day: string | null
          national_id: string | null
          raw_data: Json | null
          resignation_date: string | null
          resignation_type: string | null
          supply_date: string | null
        }
        Insert: {
          created_at?: string
          employee_code?: string | null
          employee_name?: string | null
          id?: string
          import_id?: string | null
          insurance_supply_type?: string | null
          last_working_day?: string | null
          national_id?: string | null
          raw_data?: Json | null
          resignation_date?: string | null
          resignation_type?: string | null
          supply_date?: string | null
        }
        Update: {
          created_at?: string
          employee_code?: string | null
          employee_name?: string | null
          id?: string
          import_id?: string | null
          insurance_supply_type?: string | null
          last_working_day?: string | null
          national_id?: string | null
          raw_data?: Json | null
          resignation_date?: string | null
          resignation_type?: string | null
          supply_date?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "resignation_records_import_id_fkey"
            columns: ["import_id"]
            isOneToOne: false
            referencedRelation: "import_logs"
            referencedColumns: ["id"]
          },
        ]
      }
      data_discrepancies: {
        Row: {
          id: string
          employee_id: string | null
          raw_employee_code: string | null
          raw_national_id: string | null
          raw_employee_name: string | null
          discrepancy_type: string
          severity: string
          source_a: string | null
          source_b: string | null
          field_name: string | null
          value_a: string | null
          value_b: string | null
          description: string | null
          status: string
          resolved_at: string | null
          resolved_by: string | null
          resolution_notes: string | null
          first_detected_at: string
          last_checked_at: string
          created_at: string
        }
        Insert: {
          id?: string
          employee_id?: string | null
          raw_employee_code?: string | null
          raw_national_id?: string | null
          raw_employee_name?: string | null
          discrepancy_type: string
          severity?: string
          source_a?: string | null
          source_b?: string | null
          field_name?: string | null
          value_a?: string | null
          value_b?: string | null
          description?: string | null
          status?: string
          resolved_at?: string | null
          resolved_by?: string | null
          resolution_notes?: string | null
          first_detected_at?: string
          last_checked_at?: string
          created_at?: string
        }
        Update: {
          id?: string
          employee_id?: string | null
          raw_employee_code?: string | null
          raw_national_id?: string | null
          raw_employee_name?: string | null
          discrepancy_type?: string
          severity?: string
          source_a?: string | null
          source_b?: string | null
          field_name?: string | null
          value_a?: string | null
          value_b?: string | null
          description?: string | null
          status?: string
          resolved_at?: string | null
          resolved_by?: string | null
          resolution_notes?: string | null
          first_detected_at?: string
          last_checked_at?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "data_discrepancies_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees_master"
            referencedColumns: ["id"]
          },
        ]
      }
      matching_candidates: {
        Row: {
          id: string
          import_id: string | null
          sheet_name: string
          row_data: Json
          row_number: number | null
          raw_code: string | null
          raw_national_id: string | null
          raw_name: string | null
          candidate_employee_id: string | null
          match_type: string | null
          confidence_score: number | null
          candidate_snapshot: Json | null
          status: string
          reviewed_by: string | null
          reviewed_at: string | null
          notes: string | null
          created_at: string
        }
        Insert: {
          id?: string
          import_id?: string | null
          sheet_name: string
          row_data: Json
          row_number?: number | null
          raw_code?: string | null
          raw_national_id?: string | null
          raw_name?: string | null
          candidate_employee_id?: string | null
          match_type?: string | null
          confidence_score?: number | null
          candidate_snapshot?: Json | null
          status?: string
          reviewed_by?: string | null
          reviewed_at?: string | null
          notes?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          import_id?: string | null
          sheet_name?: string
          row_data?: Json
          row_number?: number | null
          raw_code?: string | null
          raw_national_id?: string | null
          raw_name?: string | null
          candidate_employee_id?: string | null
          match_type?: string | null
          confidence_score?: number | null
          candidate_snapshot?: Json | null
          status?: string
          reviewed_by?: string | null
          reviewed_at?: string | null
          notes?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "matching_candidates_candidate_employee_id_fkey"
            columns: ["candidate_employee_id"]
            isOneToOne: false
            referencedRelation: "employees_master"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matching_candidates_import_id_fkey"
            columns: ["import_id"]
            isOneToOne: false
            referencedRelation: "import_logs"
            referencedColumns: ["id"]
          },
        ]
      }
      saved_reports: {
        Row: {
          id: string
          report_name: string
          report_description: string | null
          report_config: Json
          created_by: string | null
          is_public: boolean
          is_pinned: boolean
          last_run_at: string | null
          run_count: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          report_name: string
          report_description?: string | null
          report_config: Json
          created_by?: string | null
          is_public?: boolean
          is_pinned?: boolean
          last_run_at?: string | null
          run_count?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          report_name?: string
          report_description?: string | null
          report_config?: Json
          created_by?: string | null
          is_public?: boolean
          is_pinned?: boolean
          last_run_at?: string | null
          run_count?: number
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      quality_run_log: {
        Row: {
          id: string
          run_type: string
          triggered_by: string | null
          total_employees_checked: number | null
          discrepancies_found: number | null
          discrepancies_resolved: number | null
          new_discrepancies: number | null
          duration_ms: number | null
          error_message: string | null
          created_at: string
        }
        Insert: {
          id?: string
          run_type?: string
          triggered_by?: string | null
          total_employees_checked?: number | null
          discrepancies_found?: number | null
          discrepancies_resolved?: number | null
          new_discrepancies?: number | null
          duration_ms?: number | null
          error_message?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          run_type?: string
          triggered_by?: string | null
          total_employees_checked?: number | null
          discrepancies_found?: number | null
          discrepancies_resolved?: number | null
          new_discrepancies?: number | null
          duration_ms?: number | null
          error_message?: string | null
          created_at?: string
        }
        Relationships: []
      }
      field_conflicts: {
        Row: {
          id: string
          employee_id: string
          field_name: string
          current_value: string | null
          current_source: string | null
          proposed_value: string
          proposed_source: string
          proposed_import_id: string | null
          status: string
          merged_value: string | null
          reviewed_by: string | null
          reviewed_at: string | null
          review_notes: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          employee_id: string
          field_name: string
          current_value?: string | null
          current_source?: string | null
          proposed_value: string
          proposed_source: string
          proposed_import_id?: string | null
          status?: string
          merged_value?: string | null
          reviewed_by?: string | null
          reviewed_at?: string | null
          review_notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          employee_id?: string
          field_name?: string
          current_value?: string | null
          current_source?: string | null
          proposed_value?: string
          proposed_source?: string
          proposed_import_id?: string | null
          status?: string
          merged_value?: string | null
          reviewed_by?: string | null
          reviewed_at?: string | null
          review_notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "field_conflicts_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees_master"
            referencedColumns: ["id"]
          }
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      deduplicate_sheet_data: {
        Args: {
          target_sheet_name?: string | null
        }
        Returns: {
          sheet_name: string
          total_rows: number
          duplicates_marked: number
          latest_rows: number
        }[]
      }
      detect_all_field_conflicts: {
        Args: Record<PropertyKey, never>
        Returns: {
          employees_scanned: number
          total_conflicts_found: number
        }[]
      }
      detect_employee_field_conflicts: {
        Args: {
          employee_id_param: string
          import_id_param?: string | null
        }
        Returns: number
      }
      apply_conflict_decision: {
        Args: {
          conflict_id_param: string
          decision: string
          merged_val?: string | null
          reviewed_by_param?: string
        }
        Returns: boolean
      }
      confirm_account_transfer: {
        Args: {
          p_employee_id: string
          p_to_company_account: string
          p_effective_date?: string | null
          p_change_type?: string
          p_change_reason?: string | null
          p_notes?: string | null
          p_confirmed_by?: string | null
          p_expected_current_company?: string | null
          p_import_id?: string | null
        }
        Returns: Json
      }
      apply_due_company_transfers: {
        Args: {
          p_employee_id: string
        }
        Returns: Json
      }
      resolve_current_company: {
        Args: {
          p_employee_id: string
          p_as_of?: string
        }
        Returns: string
      }
      compute_account_employee_uid: {
        Args: {
          p_company_account: string
          p_employee_code: string | null
          p_national_id: string | null
          p_id: string
        }
        Returns: string
      }
    }
    Enums: {
      [_ in never]: never
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const
