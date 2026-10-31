import { preflight, protectedResourceMetadata } from "@/lib/agent/oauth/metadata";

/** RFC 9728 discovery for /mcp, at the path the MCP spec has clients try first. */
export const dynamic = "force-dynamic";

export function GET(): Response {
  return protectedResourceMetadata();
}

export function OPTIONS(): Response {
  return preflight();
}
