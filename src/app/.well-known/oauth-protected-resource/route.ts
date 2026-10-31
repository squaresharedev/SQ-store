import { preflight, protectedResourceMetadata } from "@/lib/agent/oauth/metadata";

/** The root fallback the MCP spec has clients try second. */
export const dynamic = "force-dynamic";

export function GET(): Response {
  return protectedResourceMetadata();
}

export function OPTIONS(): Response {
  return preflight();
}
