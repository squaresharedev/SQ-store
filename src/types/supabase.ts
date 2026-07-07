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
        Relationships: []
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
          digital_file_key: string | null
          id: string
          image_key: string | null
          low_stock_threshold: number
          owner_id: string
          price_cents: number
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
          digital_file_key?: string | null
          id?: string
          image_key?: string | null
          low_stock_threshold?: number
          owner_id: string
          price_cents: number
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
          digital_file_key?: string | null
          id?: string
          image_key?: string | null
          low_stock_threshold?: number
          owner_id?: string
          price_cents?: number
          status?: string
          stock_quantity?: number | null
          title?: string
          track_stock?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          deletion_requested_at: string | null
          display_name: string | null
          id: string
          is_seller: boolean
          legal_accepted_at: string | null
          legal_accepted_version: string | null
          notify_marketing: boolean
          notify_product_updates: boolean
          notify_sales: boolean
          tax_business_name: string | null
          tax_country: string | null
          tax_vat_id: string | null
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          deletion_requested_at?: string | null
          display_name?: string | null
          id: string
          is_seller?: boolean
          legal_accepted_at?: string | null
          legal_accepted_version?: string | null
          notify_marketing?: boolean
          notify_product_updates?: boolean
          notify_sales?: boolean
          tax_business_name?: string | null
          tax_country?: string | null
          tax_vat_id?: string | null
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          deletion_requested_at?: string | null
          display_name?: string | null
          id?: string
          is_seller?: boolean
          legal_accepted_at?: string | null
          legal_accepted_version?: string | null
          notify_marketing?: boolean
          notify_product_updates?: boolean
          notify_sales?: boolean
          tax_business_name?: string | null
          tax_country?: string | null
          tax_vat_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      storefronts: {
        Row: {
          config: Json
          created_at: string
          id: string
          name: string
          owner_id: string
          updated_at: string
        }
        Insert: {
          config?: Json
          created_at?: string
          id?: string
          name?: string
          owner_id: string
          updated_at?: string
        }
        Update: {
          config?: Json
          created_at?: string
          id?: string
          name?: string
          owner_id?: string
          updated_at?: string
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
            foreignKeyName: "team_members_member_user_id_fkey"
            columns: ["member_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      decrement_stock: {
        Args: { p_product_id: string; p_quantity: number }
        Returns: boolean
      }
      is_display_name_available: {
        Args: { p_display_name: string }
        Returns: boolean
      }
      rl_take: {
        Args: { p_action: string; p_max: number; p_window_seconds: number }
        Returns: boolean
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
          role: Database["public"]["Enums"]["team_role"]
          store_name: string
          is_self: boolean
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
          display_name: string
          id: string
          invited_at: string
          invited_email: string
          member_user_id: string
          role: Database["public"]["Enums"]["team_role"]
          status: Database["public"]["Enums"]["team_member_status"]
        }[]
      }
      user_id_by_email: { Args: { p_email: string }; Returns: string }
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
      team_member_status: ["invited", "active", "revoked"],
      team_role: ["owner", "editor", "viewer"],
    },
  },
} as const
