// Auto-generated from the Supabase project ("SQ-store", vnyfndqpdllwhvhinjoi).
// Regenerate after schema changes with:
//   pnpm dlx supabase gen types typescript --project-id vnyfndqpdllwhvhinjoi > src/types/supabase.ts
// (or via the Supabase MCP `generate_typescript_types` tool).
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
      account_deletion_requests: {
        Row: {
          last_attempt_at: string | null
          last_error: string | null
          requested_at: string
          started_at: string | null
          user_id: string
        }
        Insert: {
          last_attempt_at?: string | null
          last_error?: string | null
          requested_at?: string
          started_at?: string | null
          user_id: string
        }
        Update: {
          last_attempt_at?: string | null
          last_error?: string | null
          requested_at?: string
          started_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      admin_audit_log: {
        Row: {
          action: string
          admin_user_id: string
          created_at: string
          id: string
          meta: Json
          target: string | null
        }
        Insert: {
          action: string
          admin_user_id: string
          created_at?: string
          id?: string
          meta?: Json
          target?: string | null
        }
        Update: {
          action?: string
          admin_user_id?: string
          created_at?: string
          id?: string
          meta?: Json
          target?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "admin_audit_log_admin_user_id_fkey"
            columns: ["admin_user_id"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_notification_cursor: {
        Row: {
          last_value: number | null
          seen_through: string | null
          source: string
          updated_at: string
        }
        Insert: {
          last_value?: number | null
          seen_through?: string | null
          source: string
          updated_at?: string
        }
        Update: {
          last_value?: number | null
          seen_through?: string | null
          source?: string
          updated_at?: string
        }
        Relationships: []
      }
      admin_notification_prefs: {
        Row: {
          admin_user_id: string
          enabled: boolean
          pref_key: string
          updated_at: string
        }
        Insert: {
          admin_user_id: string
          enabled: boolean
          pref_key: string
          updated_at?: string
        }
        Update: {
          admin_user_id?: string
          enabled?: boolean
          pref_key?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "admin_notification_prefs_admin_user_id_fkey"
            columns: ["admin_user_id"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_push_subscriptions: {
        Row: {
          admin_user_id: string
          auth: string
          created_at: string
          device_label: string | null
          endpoint: string
          failure_count: number
          id: string
          last_success_at: string | null
          p256dh: string
        }
        Insert: {
          admin_user_id: string
          auth: string
          created_at?: string
          device_label?: string | null
          endpoint: string
          failure_count?: number
          id?: string
          last_success_at?: string | null
          p256dh: string
        }
        Update: {
          admin_user_id?: string
          auth?: string
          created_at?: string
          device_label?: string | null
          endpoint?: string
          failure_count?: number
          id?: string
          last_success_at?: string | null
          p256dh?: string
        }
        Relationships: [
          {
            foreignKeyName: "admin_push_subscriptions_admin_user_id_fkey"
            columns: ["admin_user_id"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_user_moderation: {
        Row: {
          banned_by: string
          banned_until: string | null
          created_at: string
          duration_label: string
          reason: string
          user_id: string
        }
        Insert: {
          banned_by: string
          banned_until?: string | null
          created_at?: string
          duration_label: string
          reason: string
          user_id: string
        }
        Update: {
          banned_by?: string
          banned_until?: string | null
          created_at?: string
          duration_label?: string
          reason?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "admin_user_moderation_banned_by_fkey"
            columns: ["banned_by"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admin_user_moderation_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "admin_user_directory"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_users: {
        Row: {
          created_at: string
          id: string
          role: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "admin_users_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "admin_user_directory"
            referencedColumns: ["id"]
          },
        ]
      }
      artifact_likes: {
        Row: {
          artifact_id: string
          created_at: string
          id: string
          user_id: string
        }
        Insert: {
          artifact_id: string
          created_at?: string
          id?: string
          user_id: string
        }
        Update: {
          artifact_id?: string
          created_at?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "artifact_likes_artifact_id_fkey"
            columns: ["artifact_id"]
            isOneToOne: false
            referencedRelation: "artifacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "artifact_likes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "admin_user_directory"
            referencedColumns: ["id"]
          },
        ]
      }
      artifacts: {
        Row: {
          collection_id: string | null
          created_at: string
          description: string
          grid_x: number
          grid_y: number
          id: string
          image_key: string
          img_offset_x: number
          img_offset_y: number
          moderated_at: string | null
          moderated_by: string | null
          moderation_checked_at: string | null
          moderation_rev: number
          moderation_ground: string | null
          moderation_note: string | null
          moderation_status: string
          owner_id: string
          product_id: string | null
          sort_order: number
          span_h: number
          span_w: number
          title: string
          updated_at: string
        }
        Insert: {
          collection_id?: string | null
          created_at?: string
          description?: string
          grid_x: number
          grid_y: number
          id?: string
          image_key: string
          img_offset_x?: number
          img_offset_y?: number
          moderated_at?: string | null
          moderated_by?: string | null
          moderation_checked_at?: string | null
          moderation_rev?: number
          moderation_ground?: string | null
          moderation_note?: string | null
          moderation_status?: string
          owner_id: string
          product_id?: string | null
          sort_order?: number
          span_h: number
          span_w: number
          title: string
          updated_at?: string
        }
        Update: {
          collection_id?: string | null
          created_at?: string
          description?: string
          grid_x?: number
          grid_y?: number
          id?: string
          image_key?: string
          img_offset_x?: number
          img_offset_y?: number
          moderated_at?: string | null
          moderated_by?: string | null
          moderation_checked_at?: string | null
          moderation_rev?: number
          moderation_ground?: string | null
          moderation_note?: string | null
          moderation_status?: string
          owner_id?: string
          product_id?: string | null
          sort_order?: number
          span_h?: number
          span_w?: number
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "artifacts_collection_id_fkey"
            columns: ["collection_id"]
            isOneToOne: false
            referencedRelation: "collections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "artifacts_moderated_by_fkey"
            columns: ["moderated_by"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "artifacts_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "admin_user_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "artifacts_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_switches: {
        Row: {
          entitlements_enforced: boolean
          fees_enabled: boolean
          id: boolean
          plan_limits_enforced: boolean
          updated_at: string
        }
        Insert: {
          entitlements_enforced?: boolean
          fees_enabled?: boolean
          id?: boolean
          plan_limits_enforced?: boolean
          updated_at?: string
        }
        Update: {
          entitlements_enforced?: boolean
          fees_enabled?: boolean
          id?: boolean
          plan_limits_enforced?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      collections: {
        Row: {
          created_at: string
          id: string
          is_public: boolean
          name: string
          owner_id: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_public?: boolean
          name: string
          owner_id: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_public?: boolean
          name?: string
          owner_id?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "collections_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "admin_user_directory"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_verifications: {
        Row: {
          attempts: number
          channel: string
          code_hash: string
          consumed_at: string | null
          created_at: string
          expires_at: string
          id: string
          owner_id: string
          target: string
        }
        Insert: {
          attempts?: number
          channel: string
          code_hash: string
          consumed_at?: string | null
          created_at?: string
          expires_at: string
          id?: string
          owner_id: string
          target: string
        }
        Update: {
          attempts?: number
          channel?: string
          code_hash?: string
          consumed_at?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          owner_id?: string
          target?: string
        }
        Relationships: [
          {
            foreignKeyName: "contact_verifications_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "admin_user_directory"
            referencedColumns: ["id"]
          },
        ]
      }
      discounts: {
        Row: {
          amount_off_cents: number | null
          applies_to: string
          archived_at: string | null
          code: string | null
          created_at: string
          currency: string | null
          enabled: boolean
          ends_at: string | null
          id: string
          kind: string
          owner_id: string
          percent_off: number | null
          product_ids: string[]
          share_channel: string | null
          starts_at: string
          updated_at: string
          usage_limit: number | null
          value_type: string
        }
        Insert: {
          amount_off_cents?: number | null
          applies_to?: string
          archived_at?: string | null
          code?: string | null
          created_at?: string
          currency?: string | null
          enabled?: boolean
          ends_at?: string | null
          id?: string
          kind: string
          owner_id: string
          percent_off?: number | null
          product_ids?: string[]
          share_channel?: string | null
          starts_at?: string
          updated_at?: string
          usage_limit?: number | null
          value_type: string
        }
        Update: {
          amount_off_cents?: number | null
          applies_to?: string
          archived_at?: string | null
          code?: string | null
          created_at?: string
          currency?: string | null
          enabled?: boolean
          ends_at?: string | null
          id?: string
          kind?: string
          owner_id?: string
          percent_off?: number | null
          product_ids?: string[]
          share_channel?: string | null
          starts_at?: string
          updated_at?: string
          usage_limit?: number | null
          value_type?: string
        }
        Relationships: []
      }
      fee_ledger: {
        Row: {
          amount_cents: number
          created_at: string
          currency: string
          entry_key: string
          id: string
          kind: Database["public"]["Enums"]["fee_entry_kind"]
          livemode: boolean
          order_id: string | null
          seller_id: string | null
          stripe_application_fee_id: string | null
        }
        Insert: {
          amount_cents: number
          created_at?: string
          currency: string
          entry_key: string
          id?: string
          kind: Database["public"]["Enums"]["fee_entry_kind"]
          livemode?: boolean
          order_id?: string | null
          seller_id?: string | null
          stripe_application_fee_id?: string | null
        }
        Update: {
          amount_cents?: number
          created_at?: string
          currency?: string
          entry_key?: string
          id?: string
          kind?: Database["public"]["Enums"]["fee_entry_kind"]
          livemode?: boolean
          order_id?: string | null
          seller_id?: string | null
          stripe_application_fee_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fee_ledger_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      follows: {
        Row: {
          created_at: string
          followee_id: string
          follower_id: string
          id: string
        }
        Insert: {
          created_at?: string
          followee_id: string
          follower_id: string
          id?: string
        }
        Update: {
          created_at?: string
          followee_id?: string
          follower_id?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "follows_followee_id_fkey"
            columns: ["followee_id"]
            isOneToOne: false
            referencedRelation: "admin_user_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "follows_follower_id_fkey"
            columns: ["follower_id"]
            isOneToOne: false
            referencedRelation: "admin_user_directory"
            referencedColumns: ["id"]
          },
        ]
      }
      mfa_recovery_codes: {
        Row: {
          code_hash: string
          created_at: string
          id: string
          used_at: string | null
          user_id: string
        }
        Insert: {
          code_hash: string
          created_at?: string
          id?: string
          used_at?: string | null
          user_id: string
        }
        Update: {
          code_hash?: string
          created_at?: string
          id?: string
          used_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      mfa_passkeys: {
        Row: {
          backed_up: boolean
          created_at: string
          credential_id: string
          factor_id: string
          id: string
          last_used_at: string | null
          name: string
          public_key: string
          sealed_secret: string
          sign_count: number
          transports: string[]
          user_id: string
        }
        Insert: {
          backed_up?: boolean
          created_at?: string
          credential_id: string
          factor_id: string
          id?: string
          last_used_at?: string | null
          name: string
          public_key: string
          sealed_secret: string
          sign_count?: number
          transports?: string[]
          user_id: string
        }
        Update: {
          backed_up?: boolean
          created_at?: string
          credential_id?: string
          factor_id?: string
          id?: string
          last_used_at?: string | null
          name?: string
          public_key?: string
          sealed_secret?: string
          sign_count?: number
          transports?: string[]
          user_id?: string
        }
        Relationships: []
      }
      mfa_approval_factors: {
        Row: {
          created_at: string
          factor_id: string
          sealed_secret: string
          user_id: string
        }
        Insert: {
          created_at?: string
          factor_id: string
          sealed_secret: string
          user_id: string
        }
        Update: {
          created_at?: string
          factor_id?: string
          sealed_secret?: string
          user_id?: string
        }
        Relationships: []
      }
      mfa_approval_opt_ins: {
        Row: {
          created_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          user_id?: string
        }
        Relationships: []
      }
      mfa_verify_intents: {
        Row: {
          created_at: string
          expires_at: string
          id: string
          session_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          expires_at: string
          id?: string
          session_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: string
          session_id?: string
          user_id?: string
        }
        Relationships: []
      }
      signup_intents: {
        Row: {
          created_at: string
          email_hash: string
          expires_at: string
          id: string
        }
        Insert: {
          created_at?: string
          email_hash: string
          expires_at: string
          id?: string
        }
        Update: {
          created_at?: string
          email_hash?: string
          expires_at?: string
          id?: string
        }
        Relationships: []
      }
      mfa_approval_opt_outs: {
        Row: {
          created_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          user_id?: string
        }
        Relationships: []
      }
      mfa_sign_in_approvals: {
        Row: {
          approval_code: string | null
          browser: string | null
          country: string | null
          created_at: string
          decided_at: string | null
          expires_at: string
          factor_id: string | null
          id: string
          match_code: number | null
          os: string | null
          session_id: string
          status: string
          token_hash: string
          used_at: string | null
          user_id: string
        }
        Insert: {
          approval_code?: string | null
          browser?: string | null
          country?: string | null
          created_at?: string
          decided_at?: string | null
          expires_at: string
          factor_id?: string | null
          id?: string
          match_code?: number | null
          os?: string | null
          session_id: string
          status?: string
          token_hash: string
          used_at?: string | null
          user_id: string
        }
        Update: {
          approval_code?: string | null
          browser?: string | null
          country?: string | null
          created_at?: string
          decided_at?: string | null
          expires_at?: string
          factor_id?: string | null
          id?: string
          match_code?: number | null
          os?: string | null
          session_id?: string
          status?: string
          token_hash?: string
          used_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      moderation_appeals: {
        Row: {
          created_at: string
          decided_at: string | null
          decided_by: string | null
          decision_id: string
          decision_note: string | null
          filed_by: string | null
          id: string
          message: string
          owner_id: string
          status: string
          target_id: string
          target_type: string
        }
        Insert: {
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_id: string
          decision_note?: string | null
          filed_by?: string | null
          id?: string
          message: string
          owner_id: string
          status?: string
          target_id: string
          target_type: string
        }
        Update: {
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_id?: string
          decision_note?: string | null
          filed_by?: string | null
          id?: string
          message?: string
          owner_id?: string
          status?: string
          target_id?: string
          target_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "moderation_appeals_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "moderation_appeals_decision_id_fkey"
            columns: ["decision_id"]
            isOneToOne: false
            referencedRelation: "moderation_decisions"
            referencedColumns: ["id"]
          },
        ]
      }
      moderation_checks: {
        Row: {
          checked_at: string
          ground: string | null
          model: string | null
          paths: string[]
          source: string
          subject: string
          verdict: string
        }
        Insert: {
          checked_at?: string
          ground?: string | null
          model?: string | null
          paths?: string[]
          source: string
          subject: string
          verdict: string
        }
        Update: {
          checked_at?: string
          ground?: string | null
          model?: string | null
          paths?: string[]
          source?: string
          subject?: string
          verdict?: string
        }
        Relationships: []
      }
      moderation_decisions: {
        Row: {
          action: string
          automated: boolean
          decided_at: string
          decided_by: string | null
          fields: string[]
          ground: string
          id: string
          note: string | null
          owner_id: string
          report_count: number
          report_reasons: string[]
          target_id: string
          target_title: string
          target_type: string
        }
        Insert: {
          action: string
          automated?: boolean
          decided_at?: string
          decided_by?: string | null
          fields?: string[]
          ground: string
          id?: string
          note?: string | null
          owner_id: string
          report_count?: number
          report_reasons?: string[]
          target_id: string
          target_title: string
          target_type: string
        }
        Update: {
          action?: string
          automated?: boolean
          decided_at?: string
          decided_by?: string | null
          fields?: string[]
          ground?: string
          id?: string
          note?: string | null
          owner_id?: string
          report_count?: number
          report_reasons?: string[]
          target_id?: string
          target_title?: string
          target_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "moderation_decisions_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string | null
          created_at: string
          data: Json
          id: string
          read: boolean
          title: string
          type: string
          user_id: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          data?: Json
          id?: string
          read?: boolean
          title: string
          type: string
          user_id: string
        }
        Update: {
          body?: string | null
          created_at?: string
          data?: Json
          id?: string
          read?: boolean
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "admin_user_directory"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          ad_fee_cents: number
          ad_rate_bps: number | null
          amount_cents: number
          application_fee_cents: number | null
          buyer_email: string | null
          buyer_locale: string | null
          channel: string
          checkout_session_id: string | null
          confirmation_sent_at: string | null
          created_at: string
          currency: string
          digital_file_key: string | null
          discount_cents: number
          discount_code: string | null
          discount_code_id: string | null
          discount_id: string | null
          fulfilment_status: string
          gift_message: string | null
          id: string
          payment_ref: string | null
          pending_expires_at: string | null
          fee_capped: boolean
          platform_fee_bps: number | null
          platform_fee_cents: number
          product_id: string | null
          product_price_cents: number
          product_title: string
          quantity: number
          refund_reason: string | null
          refunded_at: string | null
          selected_options: Json
          seller_id: string
          seller_notified_at: string | null
          seller_plan: string | null
          ship_to: Json | null
          shipped_at: string | null
          shipping_cents: number | null
          status: string
          stock_reserved: number
          storefront_id: string | null
          supply_consent_at: string | null
          tracking_carrier: string | null
          tracking_number: string | null
          withdrawal_requested_at: string | null
        }
        Insert: {
          ad_fee_cents?: number
          ad_rate_bps?: number | null
          amount_cents: number
          application_fee_cents?: number | null
          buyer_email?: string | null
          buyer_locale?: string | null
          channel: string
          checkout_session_id?: string | null
          confirmation_sent_at?: string | null
          created_at?: string
          currency?: string
          digital_file_key?: string | null
          discount_cents?: number
          discount_code?: string | null
          discount_code_id?: string | null
          discount_id?: string | null
          fulfilment_status?: string
          gift_message?: string | null
          id?: string
          payment_ref?: string | null
          pending_expires_at?: string | null
          fee_capped?: boolean
          platform_fee_bps?: number | null
          platform_fee_cents?: number
          product_id?: string | null
          product_price_cents: number
          product_title: string
          quantity?: number
          refund_reason?: string | null
          refunded_at?: string | null
          selected_options?: Json
          seller_id: string
          seller_notified_at?: string | null
          seller_plan?: string | null
          ship_to?: Json | null
          shipped_at?: string | null
          shipping_cents?: number | null
          status?: string
          stock_reserved?: number
          storefront_id?: string | null
          supply_consent_at?: string | null
          tracking_carrier?: string | null
          tracking_number?: string | null
          withdrawal_requested_at?: string | null
        }
        Update: {
          ad_fee_cents?: number
          ad_rate_bps?: number | null
          amount_cents?: number
          application_fee_cents?: number | null
          buyer_email?: string | null
          buyer_locale?: string | null
          channel?: string
          checkout_session_id?: string | null
          confirmation_sent_at?: string | null
          created_at?: string
          currency?: string
          digital_file_key?: string | null
          discount_cents?: number
          discount_code?: string | null
          discount_code_id?: string | null
          discount_id?: string | null
          fulfilment_status?: string
          gift_message?: string | null
          id?: string
          payment_ref?: string | null
          pending_expires_at?: string | null
          fee_capped?: boolean
          platform_fee_bps?: number | null
          platform_fee_cents?: number
          product_id?: string | null
          product_price_cents?: number
          product_title?: string
          quantity?: number
          refund_reason?: string | null
          refunded_at?: string | null
          selected_options?: Json
          seller_id?: string
          seller_notified_at?: string | null
          seller_plan?: string | null
          ship_to?: Json | null
          shipped_at?: string | null
          shipping_cents?: number | null
          status?: string
          stock_reserved?: number
          storefront_id?: string | null
          supply_consent_at?: string | null
          tracking_carrier?: string | null
          tracking_number?: string | null
          withdrawal_requested_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "orders_discount_code_id_fkey"
            columns: ["discount_code_id"]
            isOneToOne: false
            referencedRelation: "discounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_discount_id_fkey"
            columns: ["discount_id"]
            isOneToOne: false
            referencedRelation: "discounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "admin_user_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_storefront_id_fkey"
            columns: ["storefront_id"]
            isOneToOne: false
            referencedRelation: "storefronts"
            referencedColumns: ["id"]
          },
        ]
      }
      plan_entitlements: {
        Row: {
          feature: Database["public"]["Enums"]["feature_key"]
          limit_int: number | null
          plan_id: Database["public"]["Enums"]["plan_id"]
        }
        Insert: {
          feature: Database["public"]["Enums"]["feature_key"]
          limit_int?: number | null
          plan_id: Database["public"]["Enums"]["plan_id"]
        }
        Update: {
          feature?: Database["public"]["Enums"]["feature_key"]
          limit_int?: number | null
          plan_id?: Database["public"]["Enums"]["plan_id"]
        }
        Relationships: [
          {
            foreignKeyName: "plan_entitlements_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
        ]
      }
      plan_prices: {
        Row: {
          billing_interval: string
          created_at: string
          currency: string
          direct_fee_bps: number
          effective_from: string
          effective_to: string | null
          id: string
          list_price_cents: number | null
          marketplace_fee_bps: number
          plan_id: Database["public"]["Enums"]["plan_id"]
          price_cents: number
          stripe_lookup_key: string | null
          version: number
        }
        Insert: {
          billing_interval?: string
          created_at?: string
          currency?: string
          direct_fee_bps: number
          effective_from?: string
          effective_to?: string | null
          id?: string
          list_price_cents?: number | null
          marketplace_fee_bps: number
          plan_id: Database["public"]["Enums"]["plan_id"]
          price_cents: number
          stripe_lookup_key?: string | null
          version: number
        }
        Update: {
          billing_interval?: string
          created_at?: string
          currency?: string
          direct_fee_bps?: number
          effective_from?: string
          effective_to?: string | null
          id?: string
          list_price_cents?: number | null
          marketplace_fee_bps?: number
          plan_id?: Database["public"]["Enums"]["plan_id"]
          price_cents?: number
          stripe_lookup_key?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "plan_prices_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
        ]
      }
      plans: {
        Row: {
          id: Database["public"]["Enums"]["plan_id"]
          name: string
          sort_order: number
        }
        Insert: {
          id: Database["public"]["Enums"]["plan_id"]
          name: string
          sort_order: number
        }
        Update: {
          id?: Database["public"]["Enums"]["plan_id"]
          name?: string
          sort_order?: number
        }
        Relationships: []
      }
      plan_cancellations: {
        Row: {
          billing_interval: string | null
          created_at: string
          detail: string | null
          ends_at: string
          id: string
          owner_id: string
          plan: string
          reason: string | null
          resumed_at: string | null
        }
        Insert: {
          billing_interval?: string | null
          created_at?: string
          detail?: string | null
          ends_at: string
          id?: string
          owner_id: string
          plan: string
          reason?: string | null
          resumed_at?: string | null
        }
        Update: {
          billing_interval?: string | null
          created_at?: string
          detail?: string | null
          ends_at?: string
          id?: string
          owner_id?: string
          plan?: string
          reason?: string | null
          resumed_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "plan_cancellations_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      plan_grants: {
        Row: {
          created_at: string
          ends_at: string | null
          granted_by: string | null
          note: string | null
          owner_id: string
          plan: string
          reason: string
          starts_at: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          ends_at?: string | null
          granted_by?: string | null
          note?: string | null
          owner_id: string
          plan: string
          reason: string
          starts_at?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          ends_at?: string | null
          granted_by?: string | null
          note?: string | null
          owner_id?: string
          plan?: string
          reason?: string
          starts_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "plan_grants_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      product_price_history: {
        Row: {
          currency: string
          id: number
          price_cents: number
          product_id: string
          valid_from: string
        }
        Insert: {
          currency: string
          id?: never
          price_cents: number
          product_id: string
          valid_from?: string
        }
        Update: {
          currency?: string
          id?: never
          price_cents?: number
          product_id?: string
          valid_from?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_price_history_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_rating_summaries: {
        Row: {
          average: number | null
          product_id: string
          rating_1: number
          rating_2: number
          rating_3: number
          rating_4: number
          rating_5: number
          rating_sum: number
          review_count: number
          seller_id: string
          updated_at: string
        }
        Insert: {
          average?: never
          product_id: string
          rating_1?: number
          rating_2?: number
          rating_3?: number
          rating_4?: number
          rating_5?: number
          rating_sum?: number
          review_count?: number
          seller_id: string
          updated_at?: string
        }
        Update: {
          average?: never
          product_id?: string
          rating_1?: number
          rating_2?: number
          rating_3?: number
          rating_4?: number
          rating_5?: number
          rating_sum?: number
          review_count?: number
          seller_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_rating_summaries_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: true
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          created_at: string
          currency: string
          description: string | null
          details: Json
          digital_file_key: string | null
          documents: Json
          gallery: Json
          id: string
          image_key: string | null
          low_stock_threshold: number
          max_per_order: number
          moderated_at: string | null
          moderated_by: string | null
          moderation_checked_at: string | null
          moderation_rev: number
          moderation_decision_id: string | null
          moderation_fields: string[] | null
          moderation_ground: string | null
          moderation_note: string | null
          moderation_review_requested_at: string | null
          moderation_status: string
          option_groups: Json
          owner_id: string
          price_cents: number
          purchase_url: string | null
          shipping_profile_id: string | null
          status: string
          stock_quantity: number | null
          title: string
          track_stock: boolean
          updated_at: string
        }
        Insert: {
          created_at?: string
          currency?: string
          description?: string | null
          details?: Json
          digital_file_key?: string | null
          documents?: Json
          gallery?: Json
          id?: string
          image_key?: string | null
          low_stock_threshold?: number
          max_per_order?: number
          moderated_at?: string | null
          moderated_by?: string | null
          moderation_checked_at?: string | null
          moderation_rev?: number
          moderation_decision_id?: string | null
          moderation_fields?: string[] | null
          moderation_ground?: string | null
          moderation_note?: string | null
          moderation_review_requested_at?: string | null
          moderation_status?: string
          option_groups?: Json
          owner_id: string
          price_cents: number
          purchase_url?: string | null
          shipping_profile_id?: string | null
          status?: string
          stock_quantity?: number | null
          title: string
          track_stock?: boolean
          updated_at?: string
        }
        Update: {
          created_at?: string
          currency?: string
          description?: string | null
          details?: Json
          digital_file_key?: string | null
          documents?: Json
          gallery?: Json
          id?: string
          image_key?: string | null
          low_stock_threshold?: number
          max_per_order?: number
          moderated_at?: string | null
          moderated_by?: string | null
          moderation_checked_at?: string | null
          moderation_rev?: number
          moderation_decision_id?: string | null
          moderation_fields?: string[] | null
          moderation_ground?: string | null
          moderation_note?: string | null
          moderation_review_requested_at?: string | null
          moderation_status?: string
          option_groups?: Json
          owner_id?: string
          price_cents?: number
          purchase_url?: string | null
          shipping_profile_id?: string | null
          status?: string
          stock_quantity?: number | null
          title?: string
          track_stock?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "products_moderation_decision_id_fkey"
            columns: ["moderation_decision_id"]
            isOneToOne: false
            referencedRelation: "moderation_decisions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_moderated_by_fkey"
            columns: ["moderated_by"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "admin_user_directory"
            referencedColumns: ["id"]
          },
        ]
      }
      profile_directory: {
        Row: {
          avatar_url: string | null
          id: string
          username: string
        }
        Insert: {
          avatar_url?: string | null
          id: string
          username: string
        }
        Update: {
          avatar_url?: string | null
          id?: string
          username?: string
        }
        Relationships: [
          {
            foreignKeyName: "profile_directory_id_fkey"
            columns: ["id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          deletion_requested_at: string | null
          editor_tour_seen_at: string | null
          id: string
          is_public: boolean
          is_seller: boolean
          legal_accepted_at: string | null
          legal_accepted_version: string | null
          locale: string | null
          notify_marketing: boolean
          notify_product_updates: boolean
          notify_reviews: boolean
          notify_sales: boolean
          onboarding_completed_at: string | null
          sample_storefront_hidden_at: string | null
          seller_address: string | null
          seller_bio: string | null
          seller_email: string | null
          seller_email_verified_at: string | null
          seller_phone: string | null
          seller_phone_verified_at: string | null
          setup_celebrated_at: string | null
          shipping_policy: Json | null
          tax_business_name: string | null
          tax_country: string | null
          tax_vat_id: string | null
          updated_at: string
          username: string | null
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          deletion_requested_at?: string | null
          editor_tour_seen_at?: string | null
          id: string
          is_public?: boolean
          is_seller?: boolean
          legal_accepted_at?: string | null
          legal_accepted_version?: string | null
          locale?: string | null
          notify_marketing?: boolean
          notify_product_updates?: boolean
          notify_reviews?: boolean
          notify_sales?: boolean
          onboarding_completed_at?: string | null
          sample_storefront_hidden_at?: string | null
          seller_address?: string | null
          seller_bio?: string | null
          seller_email?: string | null
          seller_email_verified_at?: string | null
          seller_phone?: string | null
          seller_phone_verified_at?: string | null
          setup_celebrated_at?: string | null
          shipping_policy?: Json | null
          tax_business_name?: string | null
          tax_country?: string | null
          tax_vat_id?: string | null
          updated_at?: string
          username?: string | null
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          deletion_requested_at?: string | null
          editor_tour_seen_at?: string | null
          id?: string
          is_public?: boolean
          is_seller?: boolean
          legal_accepted_at?: string | null
          legal_accepted_version?: string | null
          locale?: string | null
          notify_marketing?: boolean
          notify_product_updates?: boolean
          notify_reviews?: boolean
          notify_sales?: boolean
          onboarding_completed_at?: string | null
          sample_storefront_hidden_at?: string | null
          seller_address?: string | null
          seller_bio?: string | null
          seller_email?: string | null
          seller_email_verified_at?: string | null
          seller_phone?: string | null
          seller_phone_verified_at?: string | null
          setup_celebrated_at?: string | null
          shipping_policy?: Json | null
          tax_business_name?: string | null
          tax_country?: string | null
          tax_vat_id?: string | null
          updated_at?: string
          username?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_id_fkey"
            columns: ["id"]
            isOneToOne: true
            referencedRelation: "admin_user_directory"
            referencedColumns: ["id"]
          },
        ]
      }
      rate_limit_keys: {
        Row: {
          action: string
          hits: string[]
          key: string
          updated_at: string
        }
        Insert: {
          action: string
          hits?: string[]
          key: string
          updated_at?: string
        }
        Update: {
          action?: string
          hits?: string[]
          key?: string
          updated_at?: string
        }
        Relationships: []
      }
      rate_limits: {
        Row: {
          action: string
          hits: string[]
          user_id: string
        }
        Insert: {
          action: string
          hits?: string[]
          user_id: string
        }
        Update: {
          action?: string
          hits?: string[]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rate_limits_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "admin_user_directory"
            referencedColumns: ["id"]
          },
        ]
      }
      reports: {
        Row: {
          created_at: string
          details: string
          id: string
          reason: string
          reporter_email: string | null
          reporter_hash: string | null
          reporter_id: string | null
          resolution_note: string | null
          resolved_at: string | null
          resolved_by: string | null
          status: string
          target_id: string
          target_type: string
        }
        Insert: {
          created_at?: string
          details?: string
          id?: string
          reason: string
          reporter_email?: string | null
          reporter_hash?: string | null
          reporter_id?: string | null
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          target_id: string
          target_type: string
        }
        Update: {
          created_at?: string
          details?: string
          id?: string
          reason?: string
          reporter_email?: string | null
          reporter_hash?: string | null
          reporter_id?: string | null
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          target_id?: string
          target_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "reports_reporter_id_fkey"
            columns: ["reporter_id"]
            isOneToOne: false
            referencedRelation: "admin_user_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reports_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["id"]
          },
        ]
      }
      review_imports: {
        Row: {
          created_at: string
          created_by: string | null
          file_name: string | null
          id: string
          imported_count: number
          row_count: number
          seller_id: string
          skipped_count: number
          source: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          file_name?: string | null
          id?: string
          imported_count?: number
          row_count?: number
          seller_id: string
          skipped_count?: number
          source: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          file_name?: string | null
          id?: string
          imported_count?: number
          row_count?: number
          seller_id?: string
          skipped_count?: number
          source?: string
        }
        Relationships: []
      }
      reviews: {
        Row: {
          author_name: string
          body: string
          created_at: string
          external_id: string | null
          hidden_at: string | null
          hidden_by: string | null
          hidden_reason: string | null
          id: string
          import_id: string | null
          is_approved: boolean
          is_imported: boolean
          is_public: boolean
          is_verified_buyer: boolean
          moderated_at: string | null
          moderation_ground: string | null
          moderation_status: string
          order_id: string | null
          product_id: string
          rating: number
          released_by: string | null
          reviewed_at: string
          seller_id: string
          source: string
          title: string | null
          updated_at: string
        }
        Insert: {
          author_name: string
          body?: string
          created_at?: string
          external_id?: string | null
          hidden_at?: string | null
          hidden_by?: string | null
          hidden_reason?: string | null
          id?: string
          import_id?: string | null
          is_approved?: boolean
          is_imported?: never
          is_public?: never
          is_verified_buyer?: boolean
          moderated_at?: string | null
          moderation_ground?: string | null
          moderation_status?: string
          order_id?: string | null
          product_id: string
          rating: number
          released_by?: string | null
          reviewed_at?: string
          seller_id: string
          source?: string
          title?: string | null
          updated_at?: string
        }
        Update: {
          author_name?: string
          body?: string
          created_at?: string
          external_id?: string | null
          hidden_at?: string | null
          hidden_by?: string | null
          hidden_reason?: string | null
          id?: string
          import_id?: string | null
          is_approved?: boolean
          is_imported?: never
          is_public?: never
          is_verified_buyer?: boolean
          moderated_at?: string | null
          moderation_ground?: string | null
          moderation_status?: string
          order_id?: string | null
          product_id?: string
          rating?: number
          released_by?: string | null
          reviewed_at?: string
          seller_id?: string
          source?: string
          title?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "reviews_import_id_fkey"
            columns: ["import_id"]
            isOneToOne: false
            referencedRelation: "review_imports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reviews_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reviews_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      security_events: {
        Row: {
          created_at: string
          event: string
          id: string
          ip_hash: string | null
          meta: Json
          user_id: string
        }
        Insert: {
          created_at?: string
          event: string
          id?: string
          ip_hash?: string | null
          meta?: Json
          user_id: string
        }
        Update: {
          created_at?: string
          event?: string
          id?: string
          ip_hash?: string | null
          meta?: Json
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "security_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "admin_user_directory"
            referencedColumns: ["id"]
          },
        ]
      }
      seller_billing: {
        Row: {
          billing_interval: string | null
          cancel_at_period_end: boolean
          canceled_at: string | null
          created_at: string
          currency: string | null
          current_period_end: string | null
          livemode: boolean
          owner_id: string
          paid_until: string | null
          plan: string | null
          price_cents: number | null
          status: string
          stripe_customer_id: string
          stripe_subscription_id: string | null
          stripe_synced_at: string | null
          updated_at: string
        }
        Insert: {
          billing_interval?: string | null
          cancel_at_period_end?: boolean
          canceled_at?: string | null
          created_at?: string
          currency?: string | null
          current_period_end?: string | null
          livemode?: boolean
          owner_id: string
          paid_until?: string | null
          plan?: string | null
          price_cents?: number | null
          status?: string
          stripe_customer_id: string
          stripe_subscription_id?: string | null
          stripe_synced_at?: string | null
          updated_at?: string
        }
        Update: {
          billing_interval?: string | null
          cancel_at_period_end?: boolean
          canceled_at?: string | null
          created_at?: string
          currency?: string | null
          current_period_end?: string | null
          livemode?: boolean
          owner_id?: string
          paid_until?: string | null
          plan?: string | null
          price_cents?: number | null
          status?: string
          stripe_customer_id?: string
          stripe_subscription_id?: string | null
          stripe_synced_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "seller_billing_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      seller_funnel_events: {
        Row: {
          account_id: string
          actor_id: string | null
          billing_interval: string | null
          created_at: string
          id: string
          kind: string
          plan: string | null
          source: string | null
        }
        Insert: {
          account_id: string
          actor_id?: string | null
          billing_interval?: string | null
          created_at?: string
          id?: string
          kind: string
          plan?: string | null
          source?: string | null
        }
        Update: {
          account_id?: string
          actor_id?: string | null
          billing_interval?: string | null
          created_at?: string
          id?: string
          kind?: string
          plan?: string | null
          source?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "seller_funnel_events_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "seller_funnel_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      storefront_funnel_daily: {
        Row: {
          day: string
          event: string
          events: number
          placement_id: string
          product_id: string
          referrer_host: string
          seller_id: string
          store_id: string
        }
        Insert: {
          day: string
          event: string
          events: number
          placement_id?: string
          product_id: string
          referrer_host?: string
          seller_id: string
          store_id: string
        }
        Update: {
          day?: string
          event?: string
          events?: number
          placement_id?: string
          product_id?: string
          referrer_host?: string
          seller_id?: string
          store_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "storefront_funnel_daily_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      storefront_signals: {
        Row: {
          account_id: string
          block_id: string | null
          channel: string
          currency: string | null
          dedupe_key: string | null
          id: number
          kind: string
          metadata: Json
          occurred_at: string
          storefront_id: string | null
          value_cents: number | null
          visitor_hash: string | null
        }
        Insert: {
          account_id: string
          block_id?: string | null
          channel?: string
          currency?: string | null
          dedupe_key?: string | null
          id?: never
          kind: string
          metadata?: Json
          occurred_at?: string
          storefront_id?: string | null
          value_cents?: number | null
          visitor_hash?: string | null
        }
        Update: {
          account_id?: string
          block_id?: string | null
          channel?: string
          currency?: string | null
          dedupe_key?: string | null
          id?: never
          kind?: string
          metadata?: Json
          occurred_at?: string
          storefront_id?: string | null
          value_cents?: number | null
          visitor_hash?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "storefront_signals_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "storefront_signals_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "storefront_signals_storefront_id_fkey"
            columns: ["storefront_id"]
            isOneToOne: false
            referencedRelation: "storefronts"
            referencedColumns: ["id"]
          },
        ]
      }
      storefronts: {
        Row: {
          brief: Json
          config: Json
          created_at: string
          embed_key: string
          id: string
          moderated_at: string | null
          moderated_by: string | null
          moderation_checked_at: string | null
          moderation_rev: number
          moderation_decision_id: string | null
          moderation_fields: string[] | null
          moderation_ground: string | null
          moderation_note: string | null
          moderation_review_requested_at: string | null
          moderation_status: string
          name: string
          owner_id: string
          updated_at: string
        }
        Insert: {
          brief?: Json
          config?: Json
          created_at?: string
          embed_key?: string
          id?: string
          moderated_at?: string | null
          moderated_by?: string | null
          moderation_checked_at?: string | null
          moderation_rev?: number
          moderation_decision_id?: string | null
          moderation_fields?: string[] | null
          moderation_ground?: string | null
          moderation_note?: string | null
          moderation_review_requested_at?: string | null
          moderation_status?: string
          name?: string
          owner_id: string
          updated_at?: string
        }
        Update: {
          brief?: Json
          config?: Json
          created_at?: string
          embed_key?: string
          id?: string
          moderated_at?: string | null
          moderated_by?: string | null
          moderation_checked_at?: string | null
          moderation_rev?: number
          moderation_decision_id?: string | null
          moderation_fields?: string[] | null
          moderation_ground?: string | null
          moderation_note?: string | null
          moderation_review_requested_at?: string | null
          moderation_status?: string
          name?: string
          owner_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "storefronts_moderation_decision_id_fkey"
            columns: ["moderation_decision_id"]
            isOneToOne: false
            referencedRelation: "moderation_decisions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "storefronts_moderated_by_fkey"
            columns: ["moderated_by"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "storefronts_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "admin_user_directory"
            referencedColumns: ["id"]
          },
        ]
      }
      seller_fee_waivers: {
        Row: {
          granted_at: string
          owner_id: string
          reason: string
        }
        Insert: {
          granted_at?: string
          owner_id: string
          reason?: string
        }
        Update: {
          granted_at?: string
          owner_id?: string
          reason?: string
        }
        Relationships: []
      }
      seller_payment_accounts: {
        Row: {
          charges_enabled: boolean
          created_at: string
          details_submitted: boolean
          livemode: boolean
          owner_id: string
          payouts_enabled: boolean
          stripe_account_id: string
          updated_at: string
        }
        Insert: {
          charges_enabled?: boolean
          created_at?: string
          details_submitted?: boolean
          livemode?: boolean
          owner_id: string
          payouts_enabled?: boolean
          stripe_account_id: string
          updated_at?: string
        }
        Update: {
          charges_enabled?: boolean
          created_at?: string
          details_submitted?: boolean
          livemode?: boolean
          owner_id?: string
          payouts_enabled?: boolean
          stripe_account_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      stripe_events: {
        Row: {
          id: string
          livemode: boolean
          processed_at: string | null
          received_at: string
          side_effects_at: string | null
          type: string
        }
        Insert: {
          id: string
          livemode: boolean
          processed_at?: string | null
          received_at?: string
          side_effects_at?: string | null
          type: string
        }
        Update: {
          id?: string
          livemode?: boolean
          processed_at?: string | null
          received_at?: string
          side_effects_at?: string | null
          type?: string
        }
        Relationships: []
      }
      team_members: {
        Row: {
          accepted_at: string | null
          account_owner_id: string
          id: string
          invited_at: string
          invited_email: string
          member_user_id: string | null
          role: Database["public"]["Enums"]["team_role"]
          status: Database["public"]["Enums"]["team_member_status"]
          updated_at: string
        }
        Insert: {
          accepted_at?: string | null
          account_owner_id: string
          id?: string
          invited_at?: string
          invited_email: string
          member_user_id?: string | null
          role?: Database["public"]["Enums"]["team_role"]
          status?: Database["public"]["Enums"]["team_member_status"]
          updated_at?: string
        }
        Update: {
          accepted_at?: string | null
          account_owner_id?: string
          id?: string
          invited_at?: string
          invited_email?: string
          member_user_id?: string | null
          role?: Database["public"]["Enums"]["team_role"]
          status?: Database["public"]["Enums"]["team_member_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_members_account_owner_id_fkey"
            columns: ["account_owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_members_account_owner_id_fkey"
            columns: ["account_owner_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_members_member_user_id_fkey"
            columns: ["member_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_members_member_user_id_fkey"
            columns: ["member_user_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      waitlist_signups: {
        Row: {
          created_at: string
          email: string
          id: string
          list_id: string | null
          owner_id: string | null
          source: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          list_id?: string | null
          owner_id?: string | null
          source?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          list_id?: string | null
          owner_id?: string | null
          source?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      admin_user_directory: {
        Row: {
          avatar_url: string | null
          banned_until: string | null
          created_at: string | null
          email: string | null
          email_confirmed_at: string | null
          id: string | null
          is_seller: boolean | null
          last_sign_in_at: string | null
          username: string | null
        }
        Relationships: []
      }
      content_report_scores: {
        Row: {
          moderated_at: string | null
          moderation_status: string | null
          newest_open_at: string | null
          newest_report_at: string | null
          oldest_open_at: string | null
          open_reports: number | null
          target_id: string | null
          target_owner_id: string | null
          target_title: string | null
          target_type: string | null
          top_reason: string | null
          total_reports: number | null
        }
        Relationships: []
      }
      public_profiles: {
        Row: {
          avatar_url: string | null
          id: string | null
          username: string | null
        }
        Insert: {
          avatar_url?: string | null
          id?: string | null
          username?: string | null
        }
        Update: {
          avatar_url?: string | null
          id?: string | null
          username?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_id_fkey"
            columns: ["id"]
            isOneToOne: true
            referencedRelation: "admin_user_directory"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      account_plan: { Args: { p_owner: string }; Returns: string }
      admin_notification_scan_tick: { Args: never; Returns: undefined }
      admin_revoke_user_sessions: {
        Args: { target_user_id: string }
        Returns: number
      }
      admin_user_activity: {
        Args: { target_user_id: string }
        Returns: {
          active_sessions: number
          last_seen: string
        }[]
      }
      analytics_aggregate: {
        Args: { p_from?: string; p_seller_id: string; p_to?: string }
        Returns: Json
      }
      billing_apply_snapshot: {
        Args: {
          p_cancel_at_period_end: boolean
          p_canceled_at: string | null
          p_currency: string | null
          p_current_period_end: string | null
          p_customer: string
          p_interval: string | null
          p_livemode: boolean
          p_owner: string
          p_paid_until: string | null
          p_plan: string | null
          p_price_cents: number | null
          p_status: string
          p_subscription: string | null
          p_synced_at: string
        }
        Returns: {
          applied: boolean
          previous_paid_until: string | null
          previous_plan: string | null
        }[]
      }
      billing_sales_30d: {
        Args: { p_now?: string; p_seller_id: string }
        Returns: {
          direct_cents: number
          fees_cents: number
          marketplace_cents: number
          sales: number
        }[]
      }
      billing_sales_summary: {
        Args: { p_now?: string; p_seller_id: string }
        Returns: {
          fees_cents: number
          sales: number
          subtotal_cents: number
        }[]
      }
      current_admin_user_id: { Args: never; Returns: string }
      dashboard_orders_aggregate: {
        Args: { p_now?: string; p_seller_id: string }
        Returns: Json
      }
      decrement_stock: {
        Args: { p_product_id: string; p_quantity: number }
        Returns: boolean
      }
      discount_performance: {
        Args: { p_seller_id: string }
        Returns: {
          currency: string
          discount_cents: number
          discount_id: string
          last_order_at: string | null
          orders: number
          revenue_cents: number
          uses: number
        }[]
      }
      email_by_username: { Args: { p_username: string }; Returns: string }
      is_squareshare_staff: { Args: never; Returns: boolean }
      issue_contact_verification: {
        Args: {
          p_channel: string
          p_code_hash: string
          p_owner: string
          p_ttl_seconds: number
        }
        Returns: string
      }
      mfa_consume_recovery_code: {
        Args: { p_hash: string; p_user_id: string }
        Returns: boolean
      }
      mfa_replace_recovery_codes: {
        Args: { p_hashes: string[]; p_user_id: string }
        Returns: number
      }
      mfa_session_ok: { Args: never; Returns: boolean }
      moderation_claim: {
        Args: { p_id: string; p_type: string }
        Returns: Json
      }
      moderation_due: {
        Args: { p_limit?: number }
        Returns: {
          target_id: string
          target_type: string
        }[]
      }
      moderation_preview: {
        Args: { p_id: string | null; p_patch: Json; p_type: string }
        Returns: Json
      }
      moderation_recheck_all: { Args: never; Returns: undefined }
      moderation_settle: {
        Args: {
          p_fields?: string[] | null
          p_ground?: string | null
          p_id: string
          p_rev: number
          p_type: string
        }
        Returns: Json
      }
      order_apply_refund: {
        Args: { p_order_id: string; p_reason: string; p_restock?: boolean }
        Returns: string
      }
      order_confirm_paid: {
        Args: { p_checkout_session_id: string; p_payment_ref?: string }
        Returns: Json
      }
      order_mark_shipped: {
        Args: {
          p_carrier?: string | null
          p_order_id: string
          p_tracking_number?: string | null
        }
        Returns: string
      }
      fee_ledger_record: {
        Args: {
          p_amount_cents: number
          p_entry_key: string
          p_kind: Database["public"]["Enums"]["fee_entry_kind"]
          p_livemode?: boolean
          p_order_id: string
          p_stripe_application_fee_id?: string | null
        }
        Returns: boolean
      }
      fee_ledger_summary: {
        Args: { p_from: string; p_seller_id: string; p_to: string }
        Returns: {
          charged_cents: number
          currency: string
          net_cents: number
          refunded_cents: number
        }[]
      }
      order_place: { Args: { p_order: Json }; Returns: Json }
      order_refund: {
        Args: { p_order_id: string; p_reason: string; p_restock?: boolean }
        Returns: string
      }
      order_release_pending: {
        Args: { p_checkout_session_id: string }
        Returns: boolean
      }
      orders_release_expired: { Args: { p_now?: string }; Returns: number }
      plan_grant_end: {
        Args: { p_actor: string; p_owners: string[] }
        Returns: {
          owner_id: string
          previous_ends_at: string | null
          previous_plan: string
        }[]
      }
      plan_grant_set: {
        Args: {
          p_actor: string
          p_ends_at: string | null
          p_note: string | null
          p_owners: string[]
          p_plan: string
          p_reason: string
        }
        Returns: {
          owner_id: string
          previous_ends_at: string | null
          previous_plan: string | null
          was_active: boolean
        }[]
      }
      plan_limit: { Args: { p_key: string; p_plan: string }; Returns: number }
      product_sales_aggregate: { Args: { p_seller_id: string }; Returns: Json }
      products_ranked_by_metric: {
        Args: {
          p_limit?: number
          p_metric: string
          p_offset?: number
          p_search?: string
          p_seller_id: string
          p_status?: string
        }
        Returns: Json
      }
      review_set_visibility: {
        Args: { p_action: string; p_reason?: string; p_review_id: string }
        Returns: string
      }
      review_summaries_refresh: {
        Args: { p_product_ids: string[] }
        Returns: undefined
      }
      redeem_contact_verification: {
        Args: {
          p_channel: string
          p_code_hash: string
          p_max_attempts: number
          p_owner: string
        }
        Returns: string
      }
      rl_gc_keys: { Args: never; Returns: number }
      rl_take: {
        Args: { p_action: string; p_max: number; p_window_seconds: number }
        Returns: boolean
      }
      rl_take_key: {
        Args: {
          p_action: string
          p_key: string
          p_max: number
          p_window_seconds: number
        }
        Returns: boolean
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      storefront_funnel_aggregate: {
        Args: { p_account_id: string; p_from?: string; p_to?: string }
        Returns: Json
      }
      storefront_funnel_roll_day: {
        Args: { p_day: string; p_rows: Json }
        Returns: number
      }
      storefront_signals_aggregate: {
        Args: { p_account_id: string; p_from?: string; p_to?: string }
        Returns: Json
      }
      team_accept_invite: { Args: { p_invite_id: string }; Returns: boolean }
      team_actor_role: {
        Args: { account: string }
        Returns: Database["public"]["Enums"]["team_role"]
      }
      team_jwt_email: { Args: never; Returns: string }
      team_my_accounts: {
        Args: never
        Returns: {
          account_owner_id: string
          is_self: boolean
          role: Database["public"]["Enums"]["team_role"]
          store_name: string
        }[]
      }
      team_my_pending_invites: {
        Args: never
        Returns: {
          account_owner_id: string
          id: string
          invited_at: string
          role: Database["public"]["Enums"]["team_role"]
          store_name: string
        }[]
      }
      team_role_can: {
        Args: { action: string; r: Database["public"]["Enums"]["team_role"] }
        Returns: boolean
      }
      team_role_rank: {
        Args: { r: Database["public"]["Enums"]["team_role"] }
        Returns: number
      }
      team_roster: {
        Args: { account: string; page_limit?: number; page_offset?: number }
        Returns: {
          accepted_at: string
          avatar_url: string
          id: string
          invited_at: string
          invited_email: string
          member_user_id: string
          role: Database["public"]["Enums"]["team_role"]
          status: Database["public"]["Enums"]["team_member_status"]
          username: string
        }[]
      }
      user_has_password: { Args: { p_user_id: string }; Returns: boolean }
      user_id_by_email: { Args: { p_email: string }; Returns: string }
      username_taken: {
        Args: { p_except?: string; p_username: string }
        Returns: boolean
      }
    }
    Enums: {
      feature_key:
        | "freeform_editor"
        | "custom_fonts"
        | "remove_badge"
        | "discount_codes"
        | "multiple_storefronts"
        | "analytics"
        | "priority_support"
      fee_entry_kind: "platform_fee" | "ad_fee" | "platform_fee_refund" | "ad_fee_refund"
      plan_id: "free" | "starter" | "pro"
      team_member_status: "invited" | "active" | "revoked"
      team_role: "owner" | "editor" | "viewer"
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
      feature_key: [
        "freeform_editor",
        "custom_fonts",
        "remove_badge",
        "discount_codes",
        "multiple_storefronts",
        "analytics",
        "priority_support",
      ],
      fee_entry_kind: ["platform_fee", "ad_fee", "platform_fee_refund", "ad_fee_refund"],
      plan_id: ["free", "starter", "pro"],
      team_member_status: ["invited", "active", "revoked"],
      team_role: ["owner", "editor", "viewer"],
    },
  },
} as const
