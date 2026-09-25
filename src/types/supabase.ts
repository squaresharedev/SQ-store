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
          amount_cents: number
          buyer_email: string | null
          channel: string
          created_at: string
          currency: string
          id: string
          platform_fee_cents: number
          product_id: string | null
          product_price_cents: number
          product_title: string
          selected_options: Json
          seller_id: string
          status: string
          storefront_id: string | null
        }
        Insert: {
          amount_cents: number
          buyer_email?: string | null
          channel: string
          created_at?: string
          currency?: string
          id?: string
          platform_fee_cents?: number
          product_id?: string | null
          product_price_cents: number
          product_title: string
          selected_options?: Json
          seller_id: string
          status?: string
          storefront_id?: string | null
        }
        Update: {
          amount_cents?: number
          buyer_email?: string | null
          channel?: string
          created_at?: string
          currency?: string
          id?: string
          platform_fee_cents?: number
          product_id?: string | null
          product_price_cents?: number
          product_title?: string
          selected_options?: Json
          seller_id?: string
          status?: string
          storefront_id?: string | null
        }
        Relationships: [
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
          notify_sales: boolean
          onboarding_completed_at: string | null
          sample_storefront_hidden_at: string | null
          seller_address: string | null
          seller_bio: string | null
          seller_email: string | null
          seller_email_verified_at: string | null
          seller_phone: string | null
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
          notify_sales?: boolean
          onboarding_completed_at?: string | null
          sample_storefront_hidden_at?: string | null
          seller_address?: string | null
          seller_bio?: string | null
          seller_email?: string | null
          seller_email_verified_at?: string | null
          seller_phone?: string | null
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
          notify_sales?: boolean
          onboarding_completed_at?: string | null
          sample_storefront_hidden_at?: string | null
          seller_address?: string | null
          seller_bio?: string | null
          seller_email?: string | null
          seller_email_verified_at?: string | null
          seller_phone?: string | null
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
      seller_email_verifications: {
        Row: {
          consumed_at: string | null
          created_at: string
          email: string
          expires_at: string
          id: string
          owner_id: string
          token_hash: string
        }
        Insert: {
          consumed_at?: string | null
          created_at?: string
          email: string
          expires_at: string
          id?: string
          owner_id: string
          token_hash: string
        }
        Update: {
          consumed_at?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          owner_id?: string
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "seller_email_verifications_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "admin_user_directory"
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
      current_admin_user_id: { Args: never; Returns: string }
      dashboard_orders_aggregate: {
        Args: { p_now?: string; p_seller_id: string }
        Returns: Json
      }
      decrement_stock: {
        Args: { p_product_id: string; p_quantity: number }
        Returns: boolean
      }
      email_by_username: { Args: { p_username: string }; Returns: string }
      is_squareshare_staff: { Args: never; Returns: boolean }
      mfa_consume_recovery_code: {
        Args: { p_hash: string; p_user_id: string }
        Returns: boolean
      }
      mfa_replace_recovery_codes: {
        Args: { p_hashes: string[]; p_user_id: string }
        Returns: number
      }
      mfa_session_ok: { Args: never; Returns: boolean }
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
      team_member_status: ["invited", "active", "revoked"],
      team_role: ["owner", "editor", "viewer"],
    },
  },
} as const
