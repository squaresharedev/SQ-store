// Central re-export point for shared types. Keep app-wide type definitions here
// so a shared package can be extracted later without rewriting imports.
import type { Tables } from "./supabase";

export type {
  Database,
  Json,
  Tables,
  TablesInsert,
  TablesUpdate,
  Enums,
  CompositeTypes,
} from "./supabase";

/** A user's public profile row (buyer + seller share one account). */
export type Profile = Tables<"profiles">;
