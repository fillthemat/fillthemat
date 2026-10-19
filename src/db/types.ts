export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never;
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      graphql: {
        Args: { extensions?: Json; operationName?: string; query?: string; variables?: Json };
        Returns: Json;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
  public: {
    Tables: {
      bookings: {
        Row: {
          cancelled_at: string | null;
          contact_email_snapshot: string | null;
          contact_id: string;
          contact_name_snapshot: string;
          contact_phone_snapshot: string;
          conversation_id: string | null;
          created_at: string;
          end_at: string;
          ics_sequence: number;
          ics_uid: string;
          id: string;
          idempotency_key: string;
          instructions_snapshot: string | null;
          landing_session_id: string | null;
          location_snapshot: string | null;
          offering_name_snapshot: string;
          participant_age_snapshot: number;
          participant_id: string;
          participant_name_snapshot: string;
          school_id: string;
          start_at: string;
          status: Database["public"]["Enums"]["booking_status"];
          timezone_snapshot: string;
          trial_occurrence_id: string;
          trial_offering_id: string;
          trial_window_id: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          cancelled_at?: string | null;
          contact_email_snapshot?: string | null;
          contact_id: string;
          contact_name_snapshot: string;
          contact_phone_snapshot: string;
          conversation_id?: string | null;
          created_at?: string;
          end_at: string;
          ics_sequence?: number;
          ics_uid: string;
          id?: string;
          idempotency_key: string;
          instructions_snapshot?: string | null;
          landing_session_id?: string | null;
          location_snapshot?: string | null;
          offering_name_snapshot: string;
          participant_age_snapshot: number;
          participant_id: string;
          participant_name_snapshot: string;
          school_id: string;
          start_at: string;
          status?: Database["public"]["Enums"]["booking_status"];
          timezone_snapshot: string;
          trial_occurrence_id: string;
          trial_offering_id: string;
          trial_window_id: string;
          updated_at?: string;
        };
        Update: {
          cancelled_at?: string | null;
          contact_email_snapshot?: string | null;
          contact_id?: string;
          contact_name_snapshot?: string;
          contact_phone_snapshot?: string;
          conversation_id?: string | null;
          created_at?: string;
          end_at?: string;
          ics_sequence?: number;
          ics_uid?: string;
          id?: string;
          idempotency_key?: string;
          instructions_snapshot?: string | null;
          landing_session_id?: string | null;
          location_snapshot?: string | null;
          offering_name_snapshot?: string;
          participant_age_snapshot?: number;
          participant_id?: string;
          participant_name_snapshot?: string;
          school_id?: string;
          start_at?: string;
          status?: Database["public"]["Enums"]["booking_status"];
          timezone_snapshot?: string;
          trial_occurrence_id?: string;
          trial_offering_id?: string;
          trial_window_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "bookings_contact_fk";
            columns: ["school_id", "contact_id"];
            isOneToOne: false;
            referencedRelation: "contacts";
            referencedColumns: ["school_id", "id"];
          },
          {
            foreignKeyName: "bookings_conversation_fk";
            columns: ["school_id", "conversation_id"];
            isOneToOne: false;
            referencedRelation: "conversations";
            referencedColumns: ["school_id", "id"];
          },
          {
            foreignKeyName: "bookings_landing_session_fk";
            columns: ["school_id", "landing_session_id"];
            isOneToOne: false;
            referencedRelation: "landing_sessions";
            referencedColumns: ["school_id", "id"];
          },
          {
            foreignKeyName: "bookings_occurrence_fk";
            columns: ["school_id", "trial_occurrence_id"];
            isOneToOne: false;
            referencedRelation: "trial_occurrences";
            referencedColumns: ["school_id", "id"];
          },
          {
            foreignKeyName: "bookings_offering_fk";
            columns: ["school_id", "trial_offering_id"];
            isOneToOne: false;
            referencedRelation: "trial_offerings";
            referencedColumns: ["school_id", "id"];
          },
          {
            foreignKeyName: "bookings_participant_fk";
            columns: ["school_id", "participant_id"];
            isOneToOne: false;
            referencedRelation: "participants";
            referencedColumns: ["school_id", "id"];
          },
          {
            foreignKeyName: "bookings_school_id_fk";
            columns: ["school_id"];
            isOneToOne: false;
            referencedRelation: "schools";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "bookings_window_fk";
            columns: ["school_id", "trial_window_id"];
            isOneToOne: false;
            referencedRelation: "trial_windows";
            referencedColumns: ["school_id", "id"];
          },
        ];
      };
      contacts: {
        Row: {
          created_at: string;
          email: string | null;
          id: string;
          name: string;
          phone: string;
          school_id: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          email?: string | null;
          id?: string;
          name: string;
          phone: string;
          school_id: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          email?: string | null;
          id?: string;
          name?: string;
          phone?: string;
          school_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "contacts_school_id_fk";
            columns: ["school_id"];
            isOneToOne: false;
            referencedRelation: "schools";
            referencedColumns: ["id"];
          },
        ];
      };
      conversations: {
        Row: {
          contact_id: string | null;
          created_at: string;
          end_reason: Database["public"]["Enums"]["conversation_end_reason"] | null;
          ended_at: string | null;
          expires_at: string;
          generating_at: string | null;
          id: string;
          landing_session_id: string | null;
          resume_token_hash: string;
          school_id: string;
          updated_at: string;
          wa_id_hash: string | null;
        };
        ComputedFields: never;
        Insert: {
          contact_id?: string | null;
          created_at?: string;
          end_reason?: Database["public"]["Enums"]["conversation_end_reason"] | null;
          ended_at?: string | null;
          expires_at: string;
          generating_at?: string | null;
          id?: string;
          landing_session_id?: string | null;
          resume_token_hash: string;
          school_id: string;
          updated_at?: string;
          wa_id_hash?: string | null;
        };
        Update: {
          contact_id?: string | null;
          created_at?: string;
          end_reason?: Database["public"]["Enums"]["conversation_end_reason"] | null;
          ended_at?: string | null;
          expires_at?: string;
          generating_at?: string | null;
          id?: string;
          landing_session_id?: string | null;
          resume_token_hash?: string;
          school_id?: string;
          updated_at?: string;
          wa_id_hash?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "conversations_contact_fk";
            columns: ["school_id", "contact_id"];
            isOneToOne: false;
            referencedRelation: "contacts";
            referencedColumns: ["school_id", "id"];
          },
          {
            foreignKeyName: "conversations_landing_session_fk";
            columns: ["school_id", "landing_session_id"];
            isOneToOne: false;
            referencedRelation: "landing_sessions";
            referencedColumns: ["school_id", "id"];
          },
          {
            foreignKeyName: "conversations_school_id_fk";
            columns: ["school_id"];
            isOneToOne: false;
            referencedRelation: "schools";
            referencedColumns: ["id"];
          },
        ];
      };
      cron_runs: {
        Row: {
          ended_conversation_count: number;
          error_summary: string | null;
          failed_count: number;
          finished_at: string | null;
          id: string;
          reminder_count: number;
          result: Database["public"]["Enums"]["cron_result"] | null;
          sent_count: number;
          started_at: string;
        };
        ComputedFields: never;
        Insert: {
          ended_conversation_count?: number;
          error_summary?: string | null;
          failed_count?: number;
          finished_at?: string | null;
          id?: string;
          reminder_count?: number;
          result?: Database["public"]["Enums"]["cron_result"] | null;
          sent_count?: number;
          started_at?: string;
        };
        Update: {
          ended_conversation_count?: number;
          error_summary?: string | null;
          failed_count?: number;
          finished_at?: string | null;
          id?: string;
          reminder_count?: number;
          result?: Database["public"]["Enums"]["cron_result"] | null;
          sent_count?: number;
          started_at?: string;
        };
        Relationships: [];
      };
      email_deliveries: {
        Row: {
          attempts: number;
          booking_id: string | null;
          claimed_at: string | null;
          claimed_by: string | null;
          created_at: string;
          failure_reason: string | null;
          id: string;
          kind: Database["public"]["Enums"]["email_kind"];
          last_error: string | null;
          lead_id: string | null;
          next_attempt_at: string;
          provider_id: string | null;
          provider_idempotency_key: string;
          recipient: string;
          school_id: string;
          sent_at: string | null;
          state: Database["public"]["Enums"]["email_state"];
          terminal_cause: string | null;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          attempts?: number;
          booking_id?: string | null;
          claimed_at?: string | null;
          claimed_by?: string | null;
          created_at?: string;
          failure_reason?: string | null;
          id?: string;
          kind: Database["public"]["Enums"]["email_kind"];
          last_error?: string | null;
          lead_id?: string | null;
          next_attempt_at?: string;
          provider_id?: string | null;
          provider_idempotency_key: string;
          recipient: string;
          school_id: string;
          sent_at?: string | null;
          state?: Database["public"]["Enums"]["email_state"];
          terminal_cause?: string | null;
          updated_at?: string;
        };
        Update: {
          attempts?: number;
          booking_id?: string | null;
          claimed_at?: string | null;
          claimed_by?: string | null;
          created_at?: string;
          failure_reason?: string | null;
          id?: string;
          kind?: Database["public"]["Enums"]["email_kind"];
          last_error?: string | null;
          lead_id?: string | null;
          next_attempt_at?: string;
          provider_id?: string | null;
          provider_idempotency_key?: string;
          recipient?: string;
          school_id?: string;
          sent_at?: string | null;
          state?: Database["public"]["Enums"]["email_state"];
          terminal_cause?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "email_deliveries_booking_fk";
            columns: ["school_id", "booking_id"];
            isOneToOne: false;
            referencedRelation: "bookings";
            referencedColumns: ["school_id", "id"];
          },
          {
            foreignKeyName: "email_deliveries_lead_fk";
            columns: ["school_id", "lead_id"];
            isOneToOne: false;
            referencedRelation: "leads";
            referencedColumns: ["school_id", "id"];
          },
          {
            foreignKeyName: "email_deliveries_school_id_fk";
            columns: ["school_id"];
            isOneToOne: false;
            referencedRelation: "schools";
            referencedColumns: ["id"];
          },
        ];
      };
      faqs: {
        Row: {
          answer: string;
          created_at: string;
          id: string;
          question: string;
          school_id: string;
          sort_order: number;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          answer: string;
          created_at?: string;
          id?: string;
          question: string;
          school_id: string;
          sort_order?: number;
          updated_at?: string;
        };
        Update: {
          answer?: string;
          created_at?: string;
          id?: string;
          question?: string;
          school_id?: string;
          sort_order?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "faqs_school_id_fk";
            columns: ["school_id"];
            isOneToOne: false;
            referencedRelation: "schools";
            referencedColumns: ["id"];
          },
        ];
      };
      funnel_events: {
        Row: {
          booking_id: string | null;
          conversation_id: string | null;
          created_at: string;
          event_type: string;
          id: string;
          landing_session_id: string | null;
          lead_id: string | null;
          metadata: Json | null;
          school_id: string;
        };
        ComputedFields: never;
        Insert: {
          booking_id?: string | null;
          conversation_id?: string | null;
          created_at?: string;
          event_type: string;
          id?: string;
          landing_session_id?: string | null;
          lead_id?: string | null;
          metadata?: Json | null;
          school_id: string;
        };
        Update: {
          booking_id?: string | null;
          conversation_id?: string | null;
          created_at?: string;
          event_type?: string;
          id?: string;
          landing_session_id?: string | null;
          lead_id?: string | null;
          metadata?: Json | null;
          school_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "funnel_events_school_id_fk";
            columns: ["school_id"];
            isOneToOne: false;
            referencedRelation: "schools";
            referencedColumns: ["id"];
          },
        ];
      };
      landing_sessions: {
        Row: {
          bot_exclusion_reason: string | null;
          created_at: string;
          first_seen_at: string;
          id: string;
          is_preview: boolean;
          last_seen_at: string;
          qualified_at: string | null;
          school_id: string;
          session_key_hash: string;
          updated_at: string;
          utm_campaign: string | null;
          utm_content: string | null;
          utm_medium: string | null;
          utm_source: string | null;
          utm_term: string | null;
        };
        ComputedFields: never;
        Insert: {
          bot_exclusion_reason?: string | null;
          created_at?: string;
          first_seen_at?: string;
          id?: string;
          is_preview?: boolean;
          last_seen_at?: string;
          qualified_at?: string | null;
          school_id: string;
          session_key_hash: string;
          updated_at?: string;
          utm_campaign?: string | null;
          utm_content?: string | null;
          utm_medium?: string | null;
          utm_source?: string | null;
          utm_term?: string | null;
        };
        Update: {
          bot_exclusion_reason?: string | null;
          created_at?: string;
          first_seen_at?: string;
          id?: string;
          is_preview?: boolean;
          last_seen_at?: string;
          qualified_at?: string | null;
          school_id?: string;
          session_key_hash?: string;
          updated_at?: string;
          utm_campaign?: string | null;
          utm_content?: string | null;
          utm_medium?: string | null;
          utm_source?: string | null;
          utm_term?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "landing_sessions_school_id_fk";
            columns: ["school_id"];
            isOneToOne: false;
            referencedRelation: "schools";
            referencedColumns: ["id"];
          },
        ];
      };
      leads: {
        Row: {
          contact_id: string;
          created_at: string;
          id: string;
          landing_session_id: string;
          participant_age: number | null;
          participant_name: string | null;
          school_id: string;
          stated_need: string | null;
          status: string;
          trial_offering_id: string | null;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          contact_id: string;
          created_at?: string;
          id?: string;
          landing_session_id: string;
          participant_age?: number | null;
          participant_name?: string | null;
          school_id: string;
          stated_need?: string | null;
          status?: string;
          trial_offering_id?: string | null;
          updated_at?: string;
        };
        Update: {
          contact_id?: string;
          created_at?: string;
          id?: string;
          landing_session_id?: string;
          participant_age?: number | null;
          participant_name?: string | null;
          school_id?: string;
          stated_need?: string | null;
          status?: string;
          trial_offering_id?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "leads_contact_fk";
            columns: ["school_id", "contact_id"];
            isOneToOne: false;
            referencedRelation: "contacts";
            referencedColumns: ["school_id", "id"];
          },
          {
            foreignKeyName: "leads_landing_session_fk";
            columns: ["school_id", "landing_session_id"];
            isOneToOne: false;
            referencedRelation: "landing_sessions";
            referencedColumns: ["school_id", "id"];
          },
          {
            foreignKeyName: "leads_offering_fk";
            columns: ["school_id", "trial_offering_id"];
            isOneToOne: false;
            referencedRelation: "trial_offerings";
            referencedColumns: ["school_id", "id"];
          },
          {
            foreignKeyName: "leads_school_id_fk";
            columns: ["school_id"];
            isOneToOne: false;
            referencedRelation: "schools";
            referencedColumns: ["id"];
          },
        ];
      };
      messages: {
        Row: {
          completion: Database["public"]["Enums"]["message_completion"];
          conversation_id: string;
          created_at: string;
          id: string;
          message_id: string;
          parts: NonNullable<Json>;
          role: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          completion?: Database["public"]["Enums"]["message_completion"];
          conversation_id: string;
          created_at?: string;
          id?: string;
          message_id: string;
          parts: NonNullable<Json>;
          role: string;
          updated_at?: string;
        };
        Update: {
          completion?: Database["public"]["Enums"]["message_completion"];
          conversation_id?: string;
          created_at?: string;
          id?: string;
          message_id?: string;
          parts?: NonNullable<Json>;
          role?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_conversations_id_fk";
            columns: ["conversation_id"];
            isOneToOne: false;
            referencedRelation: "conversations";
            referencedColumns: ["id"];
          },
        ];
      };
      participants: {
        Row: {
          contact_id: string;
          created_at: string;
          id: string;
          name: string;
          normalized_name: string;
          school_id: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          contact_id: string;
          created_at?: string;
          id?: string;
          name: string;
          normalized_name: string;
          school_id: string;
          updated_at?: string;
        };
        Update: {
          contact_id?: string;
          created_at?: string;
          id?: string;
          name?: string;
          normalized_name?: string;
          school_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "participants_contact_fk";
            columns: ["school_id", "contact_id"];
            isOneToOne: false;
            referencedRelation: "contacts";
            referencedColumns: ["school_id", "id"];
          },
          {
            foreignKeyName: "participants_school_id_fk";
            columns: ["school_id"];
            isOneToOne: false;
            referencedRelation: "schools";
            referencedColumns: ["id"];
          },
        ];
      };
      schools: {
        Row: {
          access_notes: string | null;
          address: string | null;
          agent_instructions: string | null;
          approved_at: string | null;
          city: string | null;
          country: string;
          created_at: string;
          id: string;
          logo_url: string | null;
          name: string;
          notification_email: string;
          owner_user_id: string;
          parking_notes: string | null;
          phone: string | null;
          previewed_at: string | null;
          pricing: string | null;
          primary_color: string | null;
          published_at: string | null;
          slug: string;
          timezone: string;
          trial_guidance: string | null;
          updated_at: string;
          website: string | null;
          welcome_message: string | null;
          whatsapp_phone_number_id: string | null;
          whatsapp_waba_id: string | null;
        };
        ComputedFields: never;
        Insert: {
          access_notes?: string | null;
          address?: string | null;
          agent_instructions?: string | null;
          approved_at?: string | null;
          city?: string | null;
          country?: string;
          created_at?: string;
          id?: string;
          logo_url?: string | null;
          name: string;
          notification_email: string;
          owner_user_id: string;
          parking_notes?: string | null;
          phone?: string | null;
          previewed_at?: string | null;
          pricing?: string | null;
          primary_color?: string | null;
          published_at?: string | null;
          slug: string;
          timezone: string;
          trial_guidance?: string | null;
          updated_at?: string;
          website?: string | null;
          welcome_message?: string | null;
          whatsapp_phone_number_id?: string | null;
          whatsapp_waba_id?: string | null;
        };
        Update: {
          access_notes?: string | null;
          address?: string | null;
          agent_instructions?: string | null;
          approved_at?: string | null;
          city?: string | null;
          country?: string;
          created_at?: string;
          id?: string;
          logo_url?: string | null;
          name?: string;
          notification_email?: string;
          owner_user_id?: string;
          parking_notes?: string | null;
          phone?: string | null;
          previewed_at?: string | null;
          pricing?: string | null;
          primary_color?: string | null;
          published_at?: string | null;
          slug?: string;
          timezone?: string;
          trial_guidance?: string | null;
          updated_at?: string;
          website?: string | null;
          welcome_message?: string | null;
          whatsapp_phone_number_id?: string | null;
          whatsapp_waba_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "schools_owner_user_id_users_id_fk";
            columns: ["owner_user_id"];
            isOneToOne: true;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      trial_occurrences: {
        Row: {
          booked_count: number;
          capacity: number;
          created_at: string;
          end_at: string;
          id: string;
          school_id: string;
          start_at: string;
          trial_offering_id: string;
          trial_window_id: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          booked_count?: number;
          capacity: number;
          created_at?: string;
          end_at: string;
          id?: string;
          school_id: string;
          start_at: string;
          trial_offering_id: string;
          trial_window_id: string;
          updated_at?: string;
        };
        Update: {
          booked_count?: number;
          capacity?: number;
          created_at?: string;
          end_at?: string;
          id?: string;
          school_id?: string;
          start_at?: string;
          trial_offering_id?: string;
          trial_window_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "trial_occurrences_offering_fk";
            columns: ["school_id", "trial_offering_id"];
            isOneToOne: false;
            referencedRelation: "trial_offerings";
            referencedColumns: ["school_id", "id"];
          },
          {
            foreignKeyName: "trial_occurrences_school_id_fk";
            columns: ["school_id"];
            isOneToOne: false;
            referencedRelation: "schools";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "trial_occurrences_window_fk";
            columns: ["school_id", "trial_window_id"];
            isOneToOne: false;
            referencedRelation: "trial_windows";
            referencedColumns: ["school_id", "id"];
          },
        ];
      };
      trial_offerings: {
        Row: {
          active: boolean;
          attire: string | null;
          created_at: string;
          description: string | null;
          expectations: string | null;
          id: string;
          maximum_age: number | null;
          minimum_age: number | null;
          name: string;
          school_id: string;
          updated_at: string;
          waiver_notes: string | null;
        };
        ComputedFields: never;
        Insert: {
          active?: boolean;
          attire?: string | null;
          created_at?: string;
          description?: string | null;
          expectations?: string | null;
          id?: string;
          maximum_age?: number | null;
          minimum_age?: number | null;
          name: string;
          school_id: string;
          updated_at?: string;
          waiver_notes?: string | null;
        };
        Update: {
          active?: boolean;
          attire?: string | null;
          created_at?: string;
          description?: string | null;
          expectations?: string | null;
          id?: string;
          maximum_age?: number | null;
          minimum_age?: number | null;
          name?: string;
          school_id?: string;
          updated_at?: string;
          waiver_notes?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "trial_offerings_school_id_fk";
            columns: ["school_id"];
            isOneToOne: false;
            referencedRelation: "schools";
            referencedColumns: ["id"];
          },
        ];
      };
      trial_windows: {
        Row: {
          active: boolean;
          capacity: number;
          created_at: string;
          day_of_week: number;
          duration_minutes: number;
          id: string;
          label: string | null;
          school_id: string;
          start_minute: number;
          trial_offering_id: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          active?: boolean;
          capacity: number;
          created_at?: string;
          day_of_week: number;
          duration_minutes: number;
          id?: string;
          label?: string | null;
          school_id: string;
          start_minute: number;
          trial_offering_id: string;
          updated_at?: string;
        };
        Update: {
          active?: boolean;
          capacity?: number;
          created_at?: string;
          day_of_week?: number;
          duration_minutes?: number;
          id?: string;
          label?: string | null;
          school_id?: string;
          start_minute?: number;
          trial_offering_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "trial_windows_offering_fk";
            columns: ["school_id", "trial_offering_id"];
            isOneToOne: false;
            referencedRelation: "trial_offerings";
            referencedColumns: ["school_id", "id"];
          },
          {
            foreignKeyName: "trial_windows_school_id_fk";
            columns: ["school_id"];
            isOneToOne: false;
            referencedRelation: "schools";
            referencedColumns: ["id"];
          },
        ];
      };
      users: {
        Row: {
          created_at: string;
          email: string;
          id: string;
          name: string | null;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          email: string;
          id: string;
          name?: string | null;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          email?: string;
          id?: string;
          name?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      whatsapp_booking_intents: {
        Row: {
          conversation_id: string;
          created_at: string;
          expires_at: string;
          id: string;
          offering_id: string;
          participant_age: number | null;
          participant_name: string | null;
          school_id: string;
          slot_id: string;
          state: Database["public"]["Enums"]["whatsapp_booking_intent_state"];
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          conversation_id: string;
          created_at?: string;
          expires_at: string;
          id?: string;
          offering_id: string;
          participant_age?: number | null;
          participant_name?: string | null;
          school_id: string;
          slot_id: string;
          state?: Database["public"]["Enums"]["whatsapp_booking_intent_state"];
          updated_at?: string;
        };
        Update: {
          conversation_id?: string;
          created_at?: string;
          expires_at?: string;
          id?: string;
          offering_id?: string;
          participant_age?: number | null;
          participant_name?: string | null;
          school_id?: string;
          slot_id?: string;
          state?: Database["public"]["Enums"]["whatsapp_booking_intent_state"];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "whatsapp_booking_intents_conversation_fk";
            columns: ["school_id", "conversation_id"];
            isOneToOne: false;
            referencedRelation: "conversations";
            referencedColumns: ["school_id", "id"];
          },
          {
            foreignKeyName: "whatsapp_booking_intents_offering_fk";
            columns: ["school_id", "offering_id"];
            isOneToOne: false;
            referencedRelation: "trial_offerings";
            referencedColumns: ["school_id", "id"];
          },
          {
            foreignKeyName: "whatsapp_booking_intents_school_id_fk";
            columns: ["school_id"];
            isOneToOne: false;
            referencedRelation: "schools";
            referencedColumns: ["id"];
          },
        ];
      };
      whatsapp_deliveries: {
        Row: {
          attempts: number;
          body: string | null;
          booking_id: string | null;
          claimed_at: string | null;
          claimed_by: string | null;
          created_at: string;
          failure_code: number | null;
          failure_reason: string | null;
          id: string;
          interactive_buttons: Json | null;
          last_error: string | null;
          lead_id: string | null;
          next_attempt_at: string;
          phone_number_id: string;
          provider_id: string | null;
          provider_idempotency_key: string;
          recipient_wa_id: string;
          school_id: string;
          send_outcome: Database["public"]["Enums"]["whatsapp_send_outcome"] | null;
          sent_at: string | null;
          state: Database["public"]["Enums"]["whatsapp_delivery_state"];
          status_at: string | null;
          template_name: string | null;
          template_params: Json | null;
          terminal_cause: string | null;
          updated_at: string;
          window_expires_at: string | null;
        };
        ComputedFields: never;
        Insert: {
          attempts?: number;
          body?: string | null;
          booking_id?: string | null;
          claimed_at?: string | null;
          claimed_by?: string | null;
          created_at?: string;
          failure_code?: number | null;
          failure_reason?: string | null;
          id?: string;
          interactive_buttons?: Json | null;
          last_error?: string | null;
          lead_id?: string | null;
          next_attempt_at?: string;
          phone_number_id: string;
          provider_id?: string | null;
          provider_idempotency_key: string;
          recipient_wa_id: string;
          school_id: string;
          send_outcome?: Database["public"]["Enums"]["whatsapp_send_outcome"] | null;
          sent_at?: string | null;
          state?: Database["public"]["Enums"]["whatsapp_delivery_state"];
          status_at?: string | null;
          template_name?: string | null;
          template_params?: Json | null;
          terminal_cause?: string | null;
          updated_at?: string;
          window_expires_at?: string | null;
        };
        Update: {
          attempts?: number;
          body?: string | null;
          booking_id?: string | null;
          claimed_at?: string | null;
          claimed_by?: string | null;
          created_at?: string;
          failure_code?: number | null;
          failure_reason?: string | null;
          id?: string;
          interactive_buttons?: Json | null;
          last_error?: string | null;
          lead_id?: string | null;
          next_attempt_at?: string;
          phone_number_id?: string;
          provider_id?: string | null;
          provider_idempotency_key?: string;
          recipient_wa_id?: string;
          school_id?: string;
          send_outcome?: Database["public"]["Enums"]["whatsapp_send_outcome"] | null;
          sent_at?: string | null;
          state?: Database["public"]["Enums"]["whatsapp_delivery_state"];
          status_at?: string | null;
          template_name?: string | null;
          template_params?: Json | null;
          terminal_cause?: string | null;
          updated_at?: string;
          window_expires_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "whatsapp_deliveries_booking_fk";
            columns: ["school_id", "booking_id"];
            isOneToOne: false;
            referencedRelation: "bookings";
            referencedColumns: ["school_id", "id"];
          },
          {
            foreignKeyName: "whatsapp_deliveries_lead_fk";
            columns: ["school_id", "lead_id"];
            isOneToOne: false;
            referencedRelation: "leads";
            referencedColumns: ["school_id", "id"];
          },
          {
            foreignKeyName: "whatsapp_deliveries_school_id_fk";
            columns: ["school_id"];
            isOneToOne: false;
            referencedRelation: "schools";
            referencedColumns: ["id"];
          },
        ];
      };
      whatsapp_jobs: {
        Row: {
          attempts: number;
          claimed_at: string | null;
          claimed_by: string | null;
          created_at: string;
          dedupe_key: string;
          failure_reason: string | null;
          id: string;
          kind: string;
          last_error: string | null;
          next_attempt_at: string;
          payload: NonNullable<Json>;
          phone_number_id: string;
          school_id: string | null;
          state: Database["public"]["Enums"]["whatsapp_job_state"];
          terminal_cause: string | null;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          attempts?: number;
          claimed_at?: string | null;
          claimed_by?: string | null;
          created_at?: string;
          dedupe_key: string;
          failure_reason?: string | null;
          id?: string;
          kind?: string;
          last_error?: string | null;
          next_attempt_at?: string;
          payload: NonNullable<Json>;
          phone_number_id: string;
          school_id?: string | null;
          state?: Database["public"]["Enums"]["whatsapp_job_state"];
          terminal_cause?: string | null;
          updated_at?: string;
        };
        Update: {
          attempts?: number;
          claimed_at?: string | null;
          claimed_by?: string | null;
          created_at?: string;
          dedupe_key?: string;
          failure_reason?: string | null;
          id?: string;
          kind?: string;
          last_error?: string | null;
          next_attempt_at?: string;
          payload?: NonNullable<Json>;
          phone_number_id?: string;
          school_id?: string | null;
          state?: Database["public"]["Enums"]["whatsapp_job_state"];
          terminal_cause?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "whatsapp_jobs_school_id_fk";
            columns: ["school_id"];
            isOneToOne: false;
            referencedRelation: "schools";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      [_ in never]: never;
    };
    Enums: {
      booking_status: "booked" | "showed" | "no_show" | "cancelled";
      conversation_end_reason: "inactivity" | "message_limit";
      cron_result: "success" | "error";
      email_kind:
        | "prospect_confirmation"
        | "booking_reminder"
        | "booking_cancellation"
        | "owner_booking"
        | "owner_cancellation"
        | "owner_lead"
        | "owner_whatsapp_confirmation_failed";
      email_state:
        | "pending"
        | "claimed"
        | "sent"
        | "failed"
        | "delivered"
        | "bounced"
        | "complained"
        | "dead";
      message_completion: "complete" | "streaming" | "aborted" | "error";
      whatsapp_booking_intent_state: "pending" | "confirmed" | "expired" | "superseded";
      whatsapp_delivery_state:
        | "pending"
        | "claimed"
        | "sent"
        | "delivered"
        | "read"
        | "failed"
        | "dead";
      whatsapp_job_state: "pending" | "claimed" | "done" | "failed" | "dead";
      whatsapp_send_outcome: "accepted" | "unknown" | "rejected";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      booking_status: ["booked", "showed", "no_show", "cancelled"],
      conversation_end_reason: ["inactivity", "message_limit"],
      cron_result: ["success", "error"],
      email_kind: [
        "prospect_confirmation",
        "booking_reminder",
        "booking_cancellation",
        "owner_booking",
        "owner_cancellation",
        "owner_lead",
        "owner_whatsapp_confirmation_failed",
      ],
      email_state: [
        "pending",
        "claimed",
        "sent",
        "failed",
        "delivered",
        "bounced",
        "complained",
        "dead",
      ],
      message_completion: ["complete", "streaming", "aborted", "error"],
      whatsapp_booking_intent_state: ["pending", "confirmed", "expired", "superseded"],
      whatsapp_delivery_state: [
        "pending",
        "claimed",
        "sent",
        "delivered",
        "read",
        "failed",
        "dead",
      ],
      whatsapp_job_state: ["pending", "claimed", "done", "failed", "dead"],
      whatsapp_send_outcome: ["accepted", "unknown", "rejected"],
    },
  },
} as const;
