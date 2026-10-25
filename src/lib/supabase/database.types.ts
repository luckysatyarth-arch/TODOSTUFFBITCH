// Generated from the live Supabase schema. Regenerate with:
//   npx supabase gen types typescript --project-id $SUPABASE_PROJECT_ID > src/lib/supabase/database.types.ts
// Do not hand-edit.
//
// Exception, to be removed by the next regeneration: tasks.recurrence_spawned_task_id
// was added by hand when migration 0010 landed, because the schema it was
// generated from was not reachable at the time. The column is in that
// migration, so regenerating produces the same thing.

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
  public: {
    Tables: {
      audit_logs: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          entity_id: string | null
          entity_type: string | null
          id: string
          ip_address: unknown
          metadata: Json
          workspace_id: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          ip_address?: unknown
          metadata?: Json
          workspace_id?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          ip_address?: unknown
          metadata?: Json
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_logs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      calendar_events: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          end_date: string | null
          ends_at: string | null
          external_id: string | null
          id: string
          is_all_day: boolean
          location: string | null
          project_id: string | null
          source: string
          start_date: string | null
          starts_at: string | null
          title: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          end_date?: string | null
          ends_at?: string | null
          external_id?: string | null
          id?: string
          is_all_day?: boolean
          location?: string | null
          project_id?: string | null
          source?: string
          start_date?: string | null
          starts_at?: string | null
          title: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          end_date?: string | null
          ends_at?: string | null
          external_id?: string | null
          id?: string
          is_all_day?: boolean
          location?: string | null
          project_id?: string | null
          source?: string
          start_date?: string | null
          starts_at?: string | null
          title?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "calendar_events_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calendar_events_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_progress"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "calendar_events_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calendar_events_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      captures: {
        Row: {
          created_at: string
          duration_seconds: number | null
          error_message: string | null
          id: string
          kind: Database["public"]["Enums"]["capture_kind"]
          mime_type: string | null
          owner_id: string
          processed_at: string | null
          raw_text: string | null
          source_external_id: string | null
          source_metadata: Json
          source_provider: string | null
          status: Database["public"]["Enums"]["capture_status"]
          storage_path: string | null
          title: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          duration_seconds?: number | null
          error_message?: string | null
          id?: string
          kind: Database["public"]["Enums"]["capture_kind"]
          mime_type?: string | null
          owner_id: string
          processed_at?: string | null
          raw_text?: string | null
          source_external_id?: string | null
          source_metadata?: Json
          source_provider?: string | null
          status?: Database["public"]["Enums"]["capture_status"]
          storage_path?: string | null
          title?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          duration_seconds?: number | null
          error_message?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["capture_kind"]
          mime_type?: string | null
          owner_id?: string
          processed_at?: string | null
          raw_text?: string | null
          source_external_id?: string | null
          source_metadata?: Json
          source_provider?: string | null
          status?: Database["public"]["Enums"]["capture_status"]
          storage_path?: string | null
          title?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "captures_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "captures_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_reports: {
        Row: {
          content: Json
          created_at: string
          error: string | null
          generated_at: string | null
          id: string
          metrics: Json
          rendered_text: string | null
          report_date: string
          scope: Database["public"]["Enums"]["report_scope"]
          status: Database["public"]["Enums"]["report_status"]
          subject_user_id: string | null
          timezone: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          content?: Json
          created_at?: string
          error?: string | null
          generated_at?: string | null
          id?: string
          metrics?: Json
          rendered_text?: string | null
          report_date: string
          scope: Database["public"]["Enums"]["report_scope"]
          status?: Database["public"]["Enums"]["report_status"]
          subject_user_id?: string | null
          timezone?: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          content?: Json
          created_at?: string
          error?: string | null
          generated_at?: string | null
          id?: string
          metrics?: Json
          rendered_text?: string | null
          report_date?: string
          scope?: Database["public"]["Enums"]["report_scope"]
          status?: Database["public"]["Enums"]["report_status"]
          subject_user_id?: string | null
          timezone?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "daily_reports_subject_user_id_fkey"
            columns: ["subject_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_reports_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      document_chunks: {
        Row: {
          chunk_index: number
          content: string
          created_at: string
          document_id: string
          id: string
          token_count: number | null
        }
        Insert: {
          chunk_index: number
          content: string
          created_at?: string
          document_id: string
          id?: string
          token_count?: number | null
        }
        Update: {
          chunk_index?: number
          content?: string
          created_at?: string
          document_id?: string
          id?: string
          token_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "document_chunks_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "indexed_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      document_embeddings: {
        Row: {
          chunk_id: string
          created_at: string
          embedding: string
          id: string
          model: string
        }
        Insert: {
          chunk_id: string
          created_at?: string
          embedding: string
          id?: string
          model: string
        }
        Update: {
          chunk_id?: string
          created_at?: string
          embedding?: string
          id?: string
          model?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_embeddings_chunk_id_fkey"
            columns: ["chunk_id"]
            isOneToOne: true
            referencedRelation: "document_chunks"
            referencedColumns: ["id"]
          },
        ]
      }
      indexed_documents: {
        Row: {
          access_scope: Database["public"]["Enums"]["access_scope"]
          author: string | null
          content: string
          content_hash: string | null
          excerpt: string | null
          fts: unknown
          id: string
          indexed_at: string
          integration_id: string | null
          metadata: Json
          owner_id: string | null
          source_record_id: string
          source_timestamp: string | null
          source_type: Database["public"]["Enums"]["document_source"]
          title: string
          url: string | null
          workspace_id: string
        }
        Insert: {
          access_scope?: Database["public"]["Enums"]["access_scope"]
          author?: string | null
          content?: string
          content_hash?: string | null
          excerpt?: string | null
          fts?: unknown
          id?: string
          indexed_at?: string
          integration_id?: string | null
          metadata?: Json
          owner_id?: string | null
          source_record_id: string
          source_timestamp?: string | null
          source_type: Database["public"]["Enums"]["document_source"]
          title?: string
          url?: string | null
          workspace_id: string
        }
        Update: {
          access_scope?: Database["public"]["Enums"]["access_scope"]
          author?: string | null
          content?: string
          content_hash?: string | null
          excerpt?: string | null
          fts?: unknown
          id?: string
          indexed_at?: string
          integration_id?: string | null
          metadata?: Json
          owner_id?: string | null
          source_record_id?: string
          source_timestamp?: string | null
          source_type?: Database["public"]["Enums"]["document_source"]
          title?: string
          url?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "indexed_documents_integration_id_fkey"
            columns: ["integration_id"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "indexed_documents_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "indexed_documents_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_credentials: {
        Row: {
          auth_tag: string
          ciphertext: string
          created_at: string
          integration_id: string
          iv: string
          key_version: number
          updated_at: string
        }
        Insert: {
          auth_tag: string
          ciphertext: string
          created_at?: string
          integration_id: string
          iv: string
          key_version?: number
          updated_at?: string
        }
        Update: {
          auth_tag?: string
          ciphertext?: string
          created_at?: string
          integration_id?: string
          iv?: string
          key_version?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "integration_credentials_integration_id_fkey"
            columns: ["integration_id"]
            isOneToOne: true
            referencedRelation: "integrations"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_sync_runs: {
        Row: {
          cursor: string | null
          documents_indexed: number
          documents_skipped: number
          error: string | null
          finished_at: string | null
          id: string
          integration_id: string
          started_at: string
          stats: Json
          status: Database["public"]["Enums"]["sync_status"]
        }
        Insert: {
          cursor?: string | null
          documents_indexed?: number
          documents_skipped?: number
          error?: string | null
          finished_at?: string | null
          id?: string
          integration_id: string
          started_at?: string
          stats?: Json
          status?: Database["public"]["Enums"]["sync_status"]
        }
        Update: {
          cursor?: string | null
          documents_indexed?: number
          documents_skipped?: number
          error?: string | null
          finished_at?: string | null
          id?: string
          integration_id?: string
          started_at?: string
          stats?: Json
          status?: Database["public"]["Enums"]["sync_status"]
        }
        Relationships: [
          {
            foreignKeyName: "integration_sync_runs_integration_id_fkey"
            columns: ["integration_id"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["id"]
          },
        ]
      }
      integrations: {
        Row: {
          capabilities: Json
          config: Json
          created_at: string
          display_name: string | null
          external_account_id: string | null
          id: string
          last_error: string | null
          last_success_at: string | null
          owner_id: string | null
          provider: Database["public"]["Enums"]["integration_provider"]
          scope_level: string
          status: Database["public"]["Enums"]["integration_status"]
          token_expires_at: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          capabilities?: Json
          config?: Json
          created_at?: string
          display_name?: string | null
          external_account_id?: string | null
          id?: string
          last_error?: string | null
          last_success_at?: string | null
          owner_id?: string | null
          provider: Database["public"]["Enums"]["integration_provider"]
          scope_level?: string
          status?: Database["public"]["Enums"]["integration_status"]
          token_expires_at?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          capabilities?: Json
          config?: Json
          created_at?: string
          display_name?: string | null
          external_account_id?: string | null
          id?: string
          last_error?: string | null
          last_success_at?: string | null
          owner_id?: string | null
          provider?: Database["public"]["Enums"]["integration_provider"]
          scope_level?: string
          status?: Database["public"]["Enums"]["integration_status"]
          token_expires_at?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "integrations_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integrations_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      job_runs: {
        Row: {
          attempts: number
          created_at: string
          id: string
          idempotency_key: string | null
          job_type: string
          last_error: string | null
          locked_at: string | null
          locked_by: string | null
          max_attempts: number
          payload: Json
          result: Json | null
          run_after: string
          status: Database["public"]["Enums"]["job_status"]
          updated_at: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          id?: string
          idempotency_key?: string | null
          job_type: string
          last_error?: string | null
          locked_at?: string | null
          locked_by?: string | null
          max_attempts?: number
          payload?: Json
          result?: Json | null
          run_after?: string
          status?: Database["public"]["Enums"]["job_status"]
          updated_at?: string
        }
        Update: {
          attempts?: number
          created_at?: string
          id?: string
          idempotency_key?: string | null
          job_type?: string
          last_error?: string | null
          locked_at?: string | null
          locked_by?: string | null
          max_attempts?: number
          payload?: Json
          result?: Json | null
          run_after?: string
          status?: Database["public"]["Enums"]["job_status"]
          updated_at?: string
        }
        Relationships: []
      }
      milestones: {
        Row: {
          completed_at: string | null
          created_at: string
          description: string | null
          due_date: string | null
          id: string
          name: string
          project_id: string
          status: Database["public"]["Enums"]["milestone_status"]
          updated_at: string
          workspace_id: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          description?: string | null
          due_date?: string | null
          id?: string
          name: string
          project_id: string
          status?: Database["public"]["Enums"]["milestone_status"]
          updated_at?: string
          workspace_id: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          description?: string | null
          due_date?: string | null
          id?: string
          name?: string
          project_id?: string
          status?: Database["public"]["Enums"]["milestone_status"]
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "milestones_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_progress"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "milestones_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "milestones_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      notes: {
        Row: {
          author_id: string | null
          body: string
          created_at: string
          id: string
          project_id: string | null
          title: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          author_id?: string | null
          body?: string
          created_at?: string
          id?: string
          project_id?: string | null
          title: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          author_id?: string | null
          body?: string
          created_at?: string
          id?: string
          project_id?: string | null
          title?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notes_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notes_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_progress"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "notes_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notes_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string | null
          created_at: string
          id: string
          kind: string
          link: string | null
          read_at: string | null
          title: string
          user_id: string
          workspace_id: string | null
        }
        Insert: {
          body?: string | null
          created_at?: string
          id?: string
          kind: string
          link?: string | null
          read_at?: string | null
          title: string
          user_id: string
          workspace_id?: string | null
        }
        Update: {
          body?: string | null
          created_at?: string
          id?: string
          kind?: string
          link?: string | null
          read_at?: string | null
          title?: string
          user_id?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string
          full_name: string | null
          id: string
          personal_whatsapp_e164: string | null
          timezone: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email: string
          full_name?: string | null
          id: string
          personal_whatsapp_e164?: string | null
          timezone?: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string
          full_name?: string | null
          id?: string
          personal_whatsapp_e164?: string | null
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
      project_members: {
        Row: {
          created_at: string
          id: string
          project_id: string
          role: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          project_id: string
          role?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          project_id?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_members_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_progress"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "project_members_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          archived_at: string | null
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          name: string
          owner_id: string | null
          priority: Database["public"]["Enums"]["priority_level"]
          start_date: string | null
          status: Database["public"]["Enums"]["project_status"]
          target_date: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name: string
          owner_id?: string | null
          priority?: Database["public"]["Enums"]["priority_level"]
          start_date?: string | null
          status?: Database["public"]["Enums"]["project_status"]
          target_date?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name?: string
          owner_id?: string | null
          priority?: Database["public"]["Enums"]["priority_level"]
          start_date?: string | null
          status?: Database["public"]["Enums"]["project_status"]
          target_date?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      proposed_tasks: {
        Row: {
          capture_id: string
          confidence: number | null
          created_at: string
          created_task_id: string | null
          decided_at: string | null
          decided_by: string | null
          description: string | null
          duplicate_of_task_id: string | null
          duplicate_similarity: number | null
          estimated_minutes: number | null
          extraction_notes: string | null
          id: string
          source_excerpt: string | null
          source_offset_seconds: number | null
          status: Database["public"]["Enums"]["proposal_status"]
          suggested_assignee_id: string | null
          suggested_due_date: string | null
          suggested_priority:
            | Database["public"]["Enums"]["priority_level"]
            | null
          suggested_project_id: string | null
          title: string
          uncertain_fields: string[]
          updated_at: string
          workspace_id: string
        }
        Insert: {
          capture_id: string
          confidence?: number | null
          created_at?: string
          created_task_id?: string | null
          decided_at?: string | null
          decided_by?: string | null
          description?: string | null
          duplicate_of_task_id?: string | null
          duplicate_similarity?: number | null
          estimated_minutes?: number | null
          extraction_notes?: string | null
          id?: string
          source_excerpt?: string | null
          source_offset_seconds?: number | null
          status?: Database["public"]["Enums"]["proposal_status"]
          suggested_assignee_id?: string | null
          suggested_due_date?: string | null
          suggested_priority?:
            | Database["public"]["Enums"]["priority_level"]
            | null
          suggested_project_id?: string | null
          title: string
          uncertain_fields?: string[]
          updated_at?: string
          workspace_id: string
        }
        Update: {
          capture_id?: string
          confidence?: number | null
          created_at?: string
          created_task_id?: string | null
          decided_at?: string | null
          decided_by?: string | null
          description?: string | null
          duplicate_of_task_id?: string | null
          duplicate_similarity?: number | null
          estimated_minutes?: number | null
          extraction_notes?: string | null
          id?: string
          source_excerpt?: string | null
          source_offset_seconds?: number | null
          status?: Database["public"]["Enums"]["proposal_status"]
          suggested_assignee_id?: string | null
          suggested_due_date?: string | null
          suggested_priority?:
            | Database["public"]["Enums"]["priority_level"]
            | null
          suggested_project_id?: string | null
          title?: string
          uncertain_fields?: string[]
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "proposed_tasks_capture_id_fkey"
            columns: ["capture_id"]
            isOneToOne: false
            referencedRelation: "captures"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proposed_tasks_created_task_id_fkey"
            columns: ["created_task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proposed_tasks_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proposed_tasks_duplicate_of_task_id_fkey"
            columns: ["duplicate_of_task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proposed_tasks_suggested_assignee_id_fkey"
            columns: ["suggested_assignee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proposed_tasks_suggested_project_id_fkey"
            columns: ["suggested_project_id"]
            isOneToOne: false
            referencedRelation: "project_progress"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "proposed_tasks_suggested_project_id_fkey"
            columns: ["suggested_project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proposed_tasks_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      rate_limit_counters: {
        Row: {
          bucket: string
          count: number
          window_start: string
        }
        Insert: {
          bucket: string
          count?: number
          window_start: string
        }
        Update: {
          bucket?: string
          count?: number
          window_start?: string
        }
        Relationships: []
      }
      report_deliveries: {
        Row: {
          attempt_count: number
          channel: string
          created_at: string
          daily_report_id: string
          error: string | null
          id: string
          idempotency_key: string
          last_attempt_at: string | null
          next_retry_at: string | null
          provider: string
          provider_message_id: string | null
          provider_status: string | null
          recipient: string
          recipient_kind: string
          status: Database["public"]["Enums"]["delivery_status"]
          updated_at: string
        }
        Insert: {
          attempt_count?: number
          channel?: string
          created_at?: string
          daily_report_id: string
          error?: string | null
          id?: string
          idempotency_key: string
          last_attempt_at?: string | null
          next_retry_at?: string | null
          provider: string
          provider_message_id?: string | null
          provider_status?: string | null
          recipient: string
          recipient_kind: string
          status?: Database["public"]["Enums"]["delivery_status"]
          updated_at?: string
        }
        Update: {
          attempt_count?: number
          channel?: string
          created_at?: string
          daily_report_id?: string
          error?: string | null
          id?: string
          idempotency_key?: string
          last_attempt_at?: string | null
          next_retry_at?: string | null
          provider?: string
          provider_message_id?: string | null
          provider_status?: string | null
          recipient?: string
          recipient_kind?: string
          status?: Database["public"]["Enums"]["delivery_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "report_deliveries_daily_report_id_fkey"
            columns: ["daily_report_id"]
            isOneToOne: false
            referencedRelation: "daily_reports"
            referencedColumns: ["id"]
          },
        ]
      }
      task_activity: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          field: string | null
          from_value: Json | null
          id: string
          task_id: string
          to_value: Json | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          field?: string | null
          from_value?: Json | null
          id?: string
          task_id: string
          to_value?: Json | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          field?: string | null
          from_value?: Json | null
          id?: string
          task_id?: string
          to_value?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "task_activity_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_activity_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      task_attachments: {
        Row: {
          created_at: string
          file_name: string
          id: string
          mime_type: string | null
          size_bytes: number | null
          storage_path: string
          task_id: string
          uploaded_by: string | null
          workspace_id: string
        }
        Insert: {
          created_at?: string
          file_name: string
          id?: string
          mime_type?: string | null
          size_bytes?: number | null
          storage_path: string
          task_id: string
          uploaded_by?: string | null
          workspace_id: string
        }
        Update: {
          created_at?: string
          file_name?: string
          id?: string
          mime_type?: string | null
          size_bytes?: number | null
          storage_path?: string
          task_id?: string
          uploaded_by?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_attachments_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_attachments_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_attachments_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      task_comments: {
        Row: {
          author_id: string | null
          body: string
          created_at: string
          id: string
          task_id: string
          updated_at: string
        }
        Insert: {
          author_id?: string | null
          body: string
          created_at?: string
          id?: string
          task_id: string
          updated_at?: string
        }
        Update: {
          author_id?: string | null
          body?: string
          created_at?: string
          id?: string
          task_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_comments_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_comments_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      task_dependencies: {
        Row: {
          created_at: string
          depends_on_task_id: string
          id: string
          task_id: string
        }
        Insert: {
          created_at?: string
          depends_on_task_id: string
          id?: string
          task_id: string
        }
        Update: {
          created_at?: string
          depends_on_task_id?: string
          id?: string
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_dependencies_depends_on_task_id_fkey"
            columns: ["depends_on_task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_dependencies_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          actual_minutes: number | null
          assignee_id: string | null
          board_position: number
          cancelled_at: string | null
          completed_at: string | null
          created_at: string
          created_by: string | null
          description: string | null
          due_at: string | null
          due_date: string | null
          estimated_minutes: number | null
          id: string
          parent_task_id: string | null
          priority: Database["public"]["Enums"]["priority_level"]
          project_id: string | null
          recurrence: Json | null
          recurrence_spawned_task_id: string | null
          source_capture_id: string | null
          start_date: string | null
          status: Database["public"]["Enums"]["task_status"]
          tags: string[]
          title: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          actual_minutes?: number | null
          assignee_id?: string | null
          board_position?: number
          cancelled_at?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          due_at?: string | null
          due_date?: string | null
          estimated_minutes?: number | null
          id?: string
          parent_task_id?: string | null
          priority?: Database["public"]["Enums"]["priority_level"]
          project_id?: string | null
          recurrence?: Json | null
          recurrence_spawned_task_id?: string | null
          source_capture_id?: string | null
          start_date?: string | null
          status?: Database["public"]["Enums"]["task_status"]
          tags?: string[]
          title: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          actual_minutes?: number | null
          assignee_id?: string | null
          board_position?: number
          cancelled_at?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          due_at?: string | null
          due_date?: string | null
          estimated_minutes?: number | null
          id?: string
          parent_task_id?: string | null
          priority?: Database["public"]["Enums"]["priority_level"]
          project_id?: string | null
          recurrence?: Json | null
          recurrence_spawned_task_id?: string | null
          source_capture_id?: string | null
          start_date?: string | null
          status?: Database["public"]["Enums"]["task_status"]
          tags?: string[]
          title?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_assignee_id_fkey"
            columns: ["assignee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_parent_task_id_fkey"
            columns: ["parent_task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_progress"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "tasks_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_source_capture_id_fkey"
            columns: ["source_capture_id"]
            isOneToOne: false
            referencedRelation: "captures"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      transcripts: {
        Row: {
          capture_id: string
          confidence: number | null
          created_at: string
          id: string
          language: string | null
          model: string | null
          provider: string
          segments: Json | null
          text: string
        }
        Insert: {
          capture_id: string
          confidence?: number | null
          created_at?: string
          id?: string
          language?: string | null
          model?: string | null
          provider: string
          segments?: Json | null
          text: string
        }
        Update: {
          capture_id?: string
          confidence?: number | null
          created_at?: string
          id?: string
          language?: string | null
          model?: string | null
          provider?: string
          segments?: Json | null
          text?: string
        }
        Relationships: [
          {
            foreignKeyName: "transcripts_capture_id_fkey"
            columns: ["capture_id"]
            isOneToOne: true
            referencedRelation: "captures"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_invitations: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string | null
          role: Database["public"]["Enums"]["workspace_role"]
          token_hash: string
          workspace_id: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          email: string
          expires_at: string
          id?: string
          invited_by?: string | null
          role?: Database["public"]["Enums"]["workspace_role"]
          token_hash: string
          workspace_id: string
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          role?: Database["public"]["Enums"]["workspace_role"]
          token_hash?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_invitations_accepted_by_fkey"
            columns: ["accepted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_invitations_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_invitations_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_members: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["workspace_role"]
          user_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["workspace_role"]
          user_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["workspace_role"]
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_members_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspaces: {
        Row: {
          created_at: string
          id: string
          kind: Database["public"]["Enums"]["workspace_kind"]
          name: string
          owner_id: string
          settings: Json
          team_whatsapp_destination: string | null
          timezone: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          kind: Database["public"]["Enums"]["workspace_kind"]
          name: string
          owner_id: string
          settings?: Json
          team_whatsapp_destination?: string | null
          timezone?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          kind?: Database["public"]["Enums"]["workspace_kind"]
          name?: string
          owner_id?: string
          settings?: Json
          team_whatsapp_destination?: string | null
          timezone?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspaces_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      project_progress: {
        Row: {
          blocked_tasks: number | null
          completed_tasks: number | null
          overdue_tasks: number | null
          percent_complete: number | null
          project_id: string | null
          remaining_tasks: number | null
          total_tasks: number | null
          workspace_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "projects_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      approve_proposed_task: {
        Args: {
          p_assignee_id?: string
          p_description?: string
          p_due_date?: string
          p_priority?: Database["public"]["Enums"]["priority_level"]
          p_project_id?: string
          p_proposal_id: string
          p_status?: Database["public"]["Enums"]["task_status"]
          p_title?: string
        }
        Returns: string
      }
      match_document_chunks: {
        Args: {
          p_embedding: string
          p_limit?: number
          p_min_similarity?: number
          p_sources?: Database["public"]["Enums"]["document_source"][]
          p_workspace: string
        }
        Returns: {
          access_scope: Database["public"]["Enums"]["access_scope"]
          chunk_content: string
          chunk_id: string
          document_id: string
          similarity: number
          source_record_id: string
          source_timestamp: string
          source_type: Database["public"]["Enums"]["document_source"]
          title: string
          url: string
        }[]
      }
      search_documents_fts: {
        Args: {
          p_limit?: number
          p_query: string
          p_sources?: Database["public"]["Enums"]["document_source"][]
          p_workspace: string
        }
        Returns: {
          access_scope: Database["public"]["Enums"]["access_scope"]
          author: string
          document_id: string
          excerpt: string
          rank: number
          source_record_id: string
          source_timestamp: string
          source_type: Database["public"]["Enums"]["document_source"]
          title: string
          url: string
        }[]
      }
    }
    Enums: {
      access_scope: "workspace" | "owner_only"
      capture_kind:
        | "voice"
        | "text"
        | "whatsapp"
        | "meeting_transcript"
        | "email"
      capture_status:
        | "pending"
        | "transcribing"
        | "extracting"
        | "ready"
        | "failed"
      delivery_status:
        | "pending"
        | "sent"
        | "delivered"
        | "read"
        | "failed"
        | "unsupported"
      document_source:
        | "internal_task"
        | "internal_project"
        | "internal_comment"
        | "internal_note"
        | "google_drive"
        | "email"
        | "teams"
        | "notion"
        | "whatsapp"
      integration_provider:
        | "google_drive"
        | "gmail"
        | "microsoft_graph_email"
        | "microsoft_teams"
        | "notion"
        | "whatsapp"
      integration_status:
        | "disconnected"
        | "requires_setup"
        | "connected"
        | "error"
        | "unsupported"
      job_status: "queued" | "running" | "succeeded" | "failed" | "dead"
      milestone_status: "pending" | "at_risk" | "completed" | "missed"
      priority_level: "urgent" | "high" | "medium" | "low"
      project_status:
        | "planning"
        | "active"
        | "on_hold"
        | "completed"
        | "cancelled"
      proposal_status: "pending" | "approved" | "rejected" | "deferred"
      report_scope: "personal" | "team"
      report_status:
        | "pending"
        | "generated"
        | "delivering"
        | "delivered"
        | "failed"
        | "skipped_no_data"
      sync_status: "running" | "succeeded" | "partial" | "failed"
      task_status:
        | "inbox"
        | "todo"
        | "in_progress"
        | "blocked"
        | "in_review"
        | "completed"
        | "cancelled"
      workspace_kind: "personal" | "team"
      workspace_role: "owner" | "admin" | "member" | "viewer"
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
  public: {
    Enums: {
      access_scope: ["workspace", "owner_only"],
      capture_kind: [
        "voice",
        "text",
        "whatsapp",
        "meeting_transcript",
        "email",
      ],
      capture_status: [
        "pending",
        "transcribing",
        "extracting",
        "ready",
        "failed",
      ],
      delivery_status: [
        "pending",
        "sent",
        "delivered",
        "read",
        "failed",
        "unsupported",
      ],
      document_source: [
        "internal_task",
        "internal_project",
        "internal_comment",
        "internal_note",
        "google_drive",
        "email",
        "teams",
        "notion",
        "whatsapp",
      ],
      integration_provider: [
        "google_drive",
        "gmail",
        "microsoft_graph_email",
        "microsoft_teams",
        "notion",
        "whatsapp",
      ],
      integration_status: [
        "disconnected",
        "requires_setup",
        "connected",
        "error",
        "unsupported",
      ],
      job_status: ["queued", "running", "succeeded", "failed", "dead"],
      milestone_status: ["pending", "at_risk", "completed", "missed"],
      priority_level: ["urgent", "high", "medium", "low"],
      project_status: [
        "planning",
        "active",
        "on_hold",
        "completed",
        "cancelled",
      ],
      proposal_status: ["pending", "approved", "rejected", "deferred"],
      report_scope: ["personal", "team"],
      report_status: [
        "pending",
        "generated",
        "delivering",
        "delivered",
        "failed",
        "skipped_no_data",
      ],
      sync_status: ["running", "succeeded", "partial", "failed"],
      task_status: [
        "inbox",
        "todo",
        "in_progress",
        "blocked",
        "in_review",
        "completed",
        "cancelled",
      ],
      workspace_kind: ["personal", "team"],
      workspace_role: ["owner", "admin", "member", "viewer"],
    },
  },
} as const
