import { authorizationServerMetadata, preflight } from "@/lib/agent/oauth/metadata";

/** RFC 8414: this app's OAuth server, for connecting an assistant (lib/agent/oauth). */
export const dynamic = "force-dynamic";

export function GET(): Response {
  return authorizationServerMetadata();
}

export function OPTIONS(): Response {
  return preflight();
}
