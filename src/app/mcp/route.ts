import { handleMcpRequest, methodNotAllowed } from "@/lib/agent/mcp-transport";

/**
 * /mcp: the MCP server, for connecting an assistant to a store. Authenticated by
 * an OAuth bearer token (lib/agent/authenticate.ts), never by a cookie. Stateless,
 * so there is no event stream to GET and no session to DELETE.
 */
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return handleMcpRequest(request);
}

export async function GET(): Promise<Response> {
  return methodNotAllowed();
}

export async function DELETE(): Promise<Response> {
  return methodNotAllowed();
}
