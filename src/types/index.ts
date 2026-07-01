// Central re-export point for shared types. Keep app-wide type definitions here
// so a shared package can be extracted later without rewriting imports.
export type {
  Database,
  Json,
  Tables,
  TablesInsert,
  TablesUpdate,
  Enums,
  CompositeTypes,
} from "./supabase";
