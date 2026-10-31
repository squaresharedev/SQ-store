import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { createHash, randomBytes } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import {
  PUBLISHABLE_SELLER,
  freshUser,
  gotoApp,
  seedProducts,
  seedSellerIdentity,
  serviceRest,
  signUp,
  userIdByEmail,
} from "./helpers";
import { ageSecondFactor, enablePasskey, enableTwoFactor, nextCode } from "./two-factor";

/**
 * The MCP server, end to end, the way a real client meets it: a 401, discovery,
 * registering itself, a person approving it in a browser, tokens, and then the
 * official MCP client SDK calling tools, whose results show up in the dashboard.
 */

const APP = "http://localhost:3100";
const MCP = `${APP}/mcp`;
const REDIRECT = "https://client.example/callback";

function pkce() {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

async function registerApp(name = "Test Assistant") {
  const res = await fetch(`${APP}/oauth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: name,
      redirect_uris: [REDIRECT],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    }),
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { client_id: string }).client_id;
}

async function resourceUrl(): Promise<string> {
  const res = await fetch(`${APP}/.well-known/oauth-protected-resource/mcp`);
  return ((await res.json()) as { resource: string }).resource;
}

function authorizeUrl(clientId: string, challenge: string, resource: string, scope?: string) {
  const query = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: REDIRECT,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state: "state-123",
    resource,
    ...(scope ? { scope } : {}),
  });
  return `/oauth/authorize?${query}`;
}

/** Press Connect and catch where the browser is sent, with no real client there. */
async function approve(
  page: Page,
  button = page.locator('[data-agent-consent="form"] button[type="submit"]'),
): Promise<URL> {
  const landed = new Promise<URL>((resolve) => {
    void page.route("https://client.example/**", async (route) => {
      resolve(new URL(route.request().url()));
      await route.fulfill({ status: 200, contentType: "text/html", body: "<p>back at the client</p>" });
    });
  });
  await button.click();
  return landed;
}

async function exchange(clientId: string, code: string, verifier: string, resource: string) {
  return fetch(`${APP}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: clientId,
      code,
      code_verifier: verifier,
      redirect_uri: REDIRECT,
      resource,
    }),
  });
}

async function refresh(clientId: string, refreshToken: string) {
  return fetch(`${APP}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", client_id: clientId, refresh_token: refreshToken }),
  });
}

type Connection = { clientId: string; accessToken: string; refreshToken: string; scope: string };

/** The whole dance, from a signed-in page to a pair of tokens. */
async function connect(page: Page, options: { scope?: string; name?: string } = {}): Promise<Connection> {
  const clientId = await registerApp(options.name);
  const resource = await resourceUrl();
  const { verifier, challenge } = pkce();
  await gotoApp(page, authorizeUrl(clientId, challenge, resource, options.scope));
  await expect(page.locator("[data-agent-consent-host]")).toContainText("client.example");
  const landed = await approve(page);
  expect(landed.searchParams.get("state")).toBe("state-123");
  const res = await exchange(clientId, landed.searchParams.get("code") ?? "", verifier, resource);
  expect(res.status).toBe(200);
  const body = (await res.json()) as { access_token: string; refresh_token: string; scope: string };
  return { clientId, accessToken: body.access_token, refreshToken: body.refresh_token, scope: body.scope };
}

/** The official client SDK, holding the token. */
async function mcpClient(accessToken: string): Promise<Client> {
  const client = new Client({ name: "e2e", version: "1.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(MCP), {
      requestInit: { headers: { Authorization: `Bearer ${accessToken}` } },
    }),
  );
  return client;
}

type ToolResult = { isError?: boolean; content: { type: string; text: string }[] };

async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  const result = (await client.callTool({ name, arguments: args })) as ToolResult;
  return { isError: result.isError === true, data: JSON.parse(result.content[0].text) as Record<string, unknown> };
}

/** A raw JSON-RPC call in the 2025 style, as clients still in the field make it. */
function legacyPost(accessToken: string, method: string, params: unknown, id: number | null = 1) {
  return fetch(MCP, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": "2025-06-18",
    },
    body: JSON.stringify({ jsonrpc: "2.0", ...(id === null ? {} : { id }), method, params }),
  });
}

/** The JSON out of either answer shape: a body, or one SSE message. */
async function rpcResult(res: Response) {
  const text = await res.text();
  const data = text.startsWith("{") ? text : (text.split("\n").find((line) => line.startsWith("data: "))?.slice(6) ?? "{}");
  return JSON.parse(data) as { result?: Record<string, unknown>; error?: unknown };
}

test.describe("discovery", () => {
  test("a call without a token gets the challenge that starts discovery", async () => {
    const res = await fetch(MCP, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(res.status).toBe(401);
    const challenge = res.headers.get("www-authenticate") ?? "";
    expect(challenge).toMatch(/^Bearer /);
    expect(challenge).toContain('resource_metadata="');
    expect(challenge).toContain("/.well-known/oauth-protected-resource/mcp");
  });

  test("the documents say where to sign in, and that PKCE is required", async () => {
    const resource = (await (await fetch(`${APP}/.well-known/oauth-protected-resource/mcp`)).json()) as {
      resource: string;
      authorization_servers: string[];
    };
    expect(resource.resource).toMatch(/\/mcp$/);
    expect(resource.authorization_servers).toHaveLength(1);

    const fallback = await fetch(`${APP}/.well-known/oauth-protected-resource`);
    expect(fallback.status).toBe(200);

    const server = (await (await fetch(`${APP}/.well-known/oauth-authorization-server`)).json()) as Record<string, unknown>;
    expect(server.issuer).toBe(resource.authorization_servers[0]);
    expect(server.code_challenge_methods_supported).toEqual(["S256"]);
    expect(server.token_endpoint_auth_methods_supported).toEqual(["none"]);
    expect(server.client_id_metadata_document_supported).toBe(true);
    expect(server.authorization_response_iss_parameter_supported).toBe(true);
  });

  test("GET and DELETE are not allowed: there is no session or stream", async () => {
    expect((await fetch(MCP)).status).toBe(405);
    expect((await fetch(MCP, { method: "DELETE" })).status).toBe(405);
  });

  test("another site's page cannot drive it", async () => {
    const res = await fetch(MCP, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://evil.example" },
      body: "{}",
    });
    expect(res.status).toBe(403);
  });

  test("a browser's Supabase session token is not a credential here", async () => {
    const res = await fetch(MCP, {
      method: "POST",
      headers: { authorization: "Bearer eyJhbGciOiJIUzI1NiJ9.e30.x", "content-type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain('error="invalid_token"');
  });
});

test.describe("connecting and using an assistant", () => {
  test.setTimeout(180_000);

  test("from a registered app to a product in the dashboard", async ({ page }) => {
    const user = freshUser("mcp");
    await signUp(page, user);
    const ownerId = await userIdByEmail(user.email);

    const { accessToken, scope } = await connect(page);
    // Opt-in scopes stay off unless someone turns them on.
    expect(scope).toContain("store:read");
    expect(scope).toContain("products:write");
    expect(scope).not.toContain("destructive");
    expect(scope).not.toContain("orders:refund");

    const client = await mcpClient(accessToken);
    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name);
    expect(names).toContain("get_store");
    expect(names).toContain("create_product");
    expect(names).not.toContain("delete_product");
    expect(names).not.toContain("refund_order");

    const store = await call(client, "get_store");
    expect(store.isError).toBe(false);
    expect(store.data.accountId).toBe(ownerId);
    expect(store.data.role).toBe("owner");

    const created = await call(client, "create_product", {
      title: "Made by an assistant",
      priceCents: 1250,
      currency: "EUR",
    });
    expect(created.isError).toBe(false);
    const productId = created.data.id as unknown as string;

    const read = await call(client, "get_product", { id: productId });
    expect(read.data.title).toBe("Made by an assistant");
    expect(read.data.priceCents).toBe(1250);
    expect(read.data.status).toBe("draft");

    const updated = await call(client, "update_product", { id: productId, priceCents: 1999 });
    expect(updated.isError).toBe(false);
    expect((await call(client, "get_product", { id: productId })).data.priceCents).toBe(1999);
    // A partial update leaves the rest alone.
    expect((await call(client, "get_product", { id: productId })).data.title).toBe("Made by an assistant");

    await gotoApp(page, "/products");
    await expect(page.getByText("Made by an assistant").first()).toBeVisible();

    const [audit] = (await serviceRest(
      `/agent_audit_log?account_id=eq.${ownerId}&tool=eq.create_product&select=outcome`,
    )) as { outcome: string }[];
    expect(audit.outcome).toBe("ok");
    await client.close();
  });

  test("writes a storefront, and a save keeps the files it never saw the keys of", async ({ page }) => {
    const user = freshUser("mcpsf");
    await signUp(page, user);
    const ownerId = await userIdByEmail(user.email);
    const { accessToken } = await connect(page);
    const client = await mcpClient(accessToken);

    const created = await call(client, "create_storefront");
    expect(created.isError).toBe(false);
    const id = created.data.id as unknown as string;

    const key = `images/${ownerId}/11111111-2222-4333-8444-555555555555-back.jpg`;
    // Beside the stored config, as a page photo is once uploaded. The read below
    // must hide it, and a save that never mentions it must keep it.
    const [stored] = (await serviceRest(`/storefronts?id=eq.${id}&select=config`)) as { config: Record<string, unknown> }[];
    const { hasBackgroundImage: _, ...page_ } = (await call(client, "get_product_page", { id })).data.productPage as Record<string, unknown>;
    await serviceRest(`/storefronts?id=eq.${id}`, {
      method: "PATCH",
      body: { config: { ...stored.config, productPage: { ...page_, backgroundImage: { key } } } },
    });

    const read = await call(client, "get_storefront", { id });
    expect(read.isError).toBe(false);
    expect(JSON.stringify(read.data)).not.toContain("images/");
    expect(JSON.stringify(read.data)).toContain("ref:");

    const saved = await call(client, "save_storefront", { id, name: "Renamed by an assistant" });
    expect(saved.isError, JSON.stringify(saved.data)).toBe(false);

    const [row] = (await serviceRest(`/storefronts?id=eq.${id}&select=name,config`)) as {
      name: string;
      config: { productPage?: { backgroundImage?: { key?: string } } };
    }[];
    expect(row.name).toBe("Renamed by an assistant");
    expect(row.config.productPage?.backgroundImage?.key).toBe(key);

    const stolen = await call(client, "save_storefront", {
      id,
      config: { productPage: { backgroundImage: { key: `images/${ownerId}/22222222-2222-4333-8444-555555555555-x.jpg` } } },
    });
    expect(stolen.isError).toBe(true);
    await client.close();
  });

  test("designs a storefront one change at a time, and the seller sees it in the designer", async ({ page }) => {
    test.setTimeout(180_000);
    const user = freshUser("mcpdesign");
    await signUp(page, user);
    const ownerId = await userIdByEmail(user.email);
    await seedProducts(ownerId, [{ title: "Moved lamp", status: "active" }]);
    const [product] = (await serviceRest(`/products?owner_id=eq.${ownerId}&select=id`)) as { id: string }[];
    const { accessToken } = await connect(page);
    const client = await mcpClient(accessToken);
    const id = (await call(client, "create_storefront")).data.id as unknown as string;

    type Board = { block: string; type: string; kind?: string; color?: string; x: number; y: number; w: number; h: number; rotation?: number };
    type Edited = { version: string; added: string[]; board: { columns: number; rows: number; blocks: Board[] } };
    const edit = async (operations: unknown[], version?: string) =>
      call(client, "edit_storefront", { id, operations, ...(version ? { version } : {}) }) as unknown as Promise<{
        isError: boolean;
        data: Edited & { error: { code: string; message: string; fix?: string } };
      }>;

    // Place a product, a shape and some words.
    const placed = await edit([
      { op: "add_product", productId: product.id },
      { op: "add_shape", kind: "circle", color: "#112233", x: 2, y: 2, w: 2, h: 2 },
      { op: "add_text", text: "Hello from Claude", x: 0, y: 3, w: 3, h: 1, color: "#334455" },
    ]);
    expect(placed.isError, JSON.stringify(placed.data)).toBe(false);
    const [, shape, words] = placed.data.added;

    // Move the product and the element, reshape and recolour, turn, layer, and
    // recolour the board. All in one save.
    const changed = await edit(
      [
        { op: "move", block: product.id, x: 4, y: 1 },
        { op: "resize", block: product.id, w: 2, h: 2 },
        { op: "move", block: shape, x: 1, y: 1 },
        { op: "style", block: shape, changes: { kind: "star", color: "#ff0000", points: 6 } },
        { op: "rotate", block: shape, degrees: 30 },
        { op: "layer", block: shape, to: "back" },
        { op: "style", block: words, changes: { text: "Changed", color: "#00aa00", bold: true } },
        { op: "style", block: product.id, changes: { cornerRadius: 24 } },
        { op: "theme", changes: { accent: "#aa00aa", background: { kind: "solid", color: "#fafafa" } } },
        { op: "header", changes: { name: "Designed by an assistant", show: true } },
      ],
      placed.data.version,
    );
    expect(changed.isError, JSON.stringify(changed.data)).toBe(false);
    const after = Object.fromEntries(changed.data.board.blocks.map((block) => [block.block, block]));
    expect(after[product.id]).toMatchObject({ x: 4, y: 1, w: 2, h: 2 });
    expect(after[shape]).toMatchObject({ kind: "star", color: "#ff0000", x: 1, y: 1, rotation: 30 });
    // Painted furthest back.
    expect(changed.data.board.blocks[0].block).toBe(shape);

    // What was stored is what the seller's own read gets.
    const [row] = (await serviceRest(`/storefronts?id=eq.${id}&select=config`)) as {
      config: { theme: { accent: string }; header: { name: string }; blocks: Record<string, unknown>[] };
    }[];
    expect(row.config.theme.accent).toBe("#aa00aa");
    expect(row.config.header.name).toBe("Designed by an assistant");
    expect(row.config.blocks.find((block) => block.productId === product.id)).toMatchObject({
      x: 4,
      y: 1,
      style: { cornerRadius: 24 },
    });

    // A refused list changes nothing, however much of it was fine.
    const before = JSON.stringify(row.config);
    const unknownBlock = await edit([
      { op: "move", block: shape, x: 0, y: 0 },
      { op: "remove", block: "not-a-block" },
    ]);
    expect(unknownBlock.isError).toBe(true);
    expect(unknownBlock.data.error.message).toContain("not-a-block");
    const offBoard = await edit([{ op: "move", block: shape, x: 11, y: 0 }]);
    expect(offBoard.isError).toBe(true);
    expect(offBoard.data.error.fix).toContain("The board is");
    const badColor = await edit([{ op: "style", block: shape, changes: { color: "red" } }]);
    expect(badColor.isError).toBe(true);
    const moved = await edit([{ op: "style", block: shape, changes: { key: "images/x" } }]);
    expect(moved.isError).toBe(true);
    const [unchanged] = (await serviceRest(`/storefronts?id=eq.${id}&select=config`)) as { config: unknown }[];
    expect(JSON.stringify(unchanged.config)).toBe(before);

    // A seller's newer save is not overwritten by an assistant reading an old one.
    const stale = await edit([{ op: "move", block: shape, x: 0, y: 0 }], placed.data.version);
    expect(stale.isError).toBe(true);
    await client.close();

    // And the seller sees it, in the real designer.
    await page.goto(`/storefront/${id}`);
    await expect(page.getByText("Changed", { exact: true }).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("Moved lamp").first()).toBeVisible();
    await page.waitForTimeout(500);
    await page.screenshot({ path: "test-results/mcp-designed-storefront.png" });
  });

  test("stays inside its one store", async ({ page, browser }) => {
    const owner = freshUser("mcpa");
    await signUp(page, owner);
    const { accessToken } = await connect(page);

    const otherContext = await browser.newContext();
    const otherPage = await otherContext.newPage();
    const other = freshUser("mcpb");
    await signUp(otherPage, other);
    const otherId = await userIdByEmail(other.email);
    await seedProducts(otherId, [{ title: "Someone else's lamp" }]);
    const [foreign] = (await serviceRest(`/products?owner_id=eq.${otherId}&select=id`)) as { id: string }[];
    await otherContext.close();

    const client = await mcpClient(accessToken);
    const read = await call(client, "get_product", { id: foreign.id });
    expect(read.isError).toBe(true);
    expect((read.data as unknown as { error: { code: string } }).error.code).toBe("not_found");
    const update = await call(client, "update_product", { id: foreign.id, priceCents: 1 });
    expect(update.isError).toBe(true);
    const list = await call(client, "list_products");
    expect(JSON.stringify(list.data)).not.toContain("Someone else's lamp");
    await client.close();
  });

  test("the publish gate holds, and points at the page that clears it", async ({ page }) => {
    const user = freshUser("mcpgate");
    await signUp(page, user);
    const { accessToken } = await connect(page);
    const client = await mcpClient(accessToken);

    const blocked = await call(client, "create_product", {
      title: "Trying to go on sale",
      priceCents: 500,
      currency: "EUR",
      status: "active",
    });
    expect(blocked.isError).toBe(true);
    const { error } = blocked.data as unknown as { error: { code: string; message: string; action?: { href: string } } };
    expect(error.code).toBe("trader_identity_required");
    expect(error.message.length).toBeGreaterThan(5);
    expect(error.action?.href).toMatch(/^https?:\/\//);

    // Once the seller has done their part, the same call goes through.
    await seedSellerIdentity(await userIdByEmail(user.email), PUBLISHABLE_SELLER);
    const allowed = await call(client, "create_product", {
      title: "Now on sale",
      priceCents: 500,
      currency: "EUR",
      status: "active",
    });
    expect(allowed.isError, JSON.stringify(allowed.data)).toBe(false);
    await client.close();
  });

  test("a refusal from a tool's own validation names what is wrong", async ({ page }) => {
    const user = freshUser("mcpval");
    await signUp(page, user);
    const { accessToken } = await connect(page);
    const client = await mcpClient(accessToken);

    const bad = await client.callTool({ name: "update_stock", arguments: { id: "not-a-uuid", trackStock: "yes" } });
    expect((bad as ToolResult).isError).toBe(true);
    await client.close();
  });

  test("a read-only grant cannot write, and is told how to ask for more", async ({ page }) => {
    const user = freshUser("mcpro");
    await signUp(page, user);
    const { accessToken, scope } = await connect(page, { scope: "store:read" });
    expect(scope).toBe("store:read");

    const client = await mcpClient(accessToken);
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name)).not.toContain("create_product");
    await client.close();

    const res = await legacyPost(accessToken, "tools/call", {
      name: "create_product",
      arguments: { title: "No", priceCents: 1, currency: "EUR" },
    });
    expect(res.status).toBe(403);
    const challenge = res.headers.get("www-authenticate") ?? "";
    expect(challenge).toContain('error="insufficient_scope"');
    expect(challenge).toContain("products:write");
  });

  test("an opt-in scope only comes when the person switches it on", async ({ page }) => {
    const user = freshUser("mcpopt");
    await signUp(page, user);
    const clientId = await registerApp();
    const resource = await resourceUrl();
    const { verifier, challenge } = pkce();
    await gotoApp(page, authorizeUrl(clientId, challenge, resource));

    // Asked for by name, as a client echoing the advertised list does: still off.
    await gotoApp(page, authorizeUrl(clientId, challenge, resource, "store:read destructive orders:refund"));
    await expect(page.locator('[data-agent-scope="orders:refund"]').getByRole("switch")).toHaveAttribute("aria-checked", "false");
    await gotoApp(page, authorizeUrl(clientId, challenge, resource));

    const row = page.locator('[data-agent-scope="destructive"]');
    await expect(row.getByRole("switch")).toHaveAttribute("aria-checked", "false");
    await row.getByRole("switch").click();
    await expect(row.getByRole("switch")).toHaveAttribute("aria-checked", "true");
    // The one everything needs cannot be turned off.
    await expect(page.locator('[data-agent-scope="store:read"]').getByRole("switch")).toBeDisabled();

    const landed = await approve(page);
    const res = await exchange(clientId, landed.searchParams.get("code") ?? "", verifier, resource);
    const body = (await res.json()) as { scope: string; access_token: string };
    expect(body.scope).toContain("destructive");
    expect(body.scope).not.toContain("orders:refund");

    const client = await mcpClient(body.access_token);
    const created = await call(client, "create_product", { title: "Short lived", priceCents: 100, currency: "EUR" });
    const removed = await call(client, "delete_product", { id: created.data.id });
    expect(removed.isError, JSON.stringify(removed.data)).toBe(false);
    await client.close();
  });

  test("every tool answers on a real store, and none of them hands out a key", async ({ page }) => {
    const user = freshUser("mcpall");
    await signUp(page, user);
    const ownerId = await userIdByEmail(user.email);
    await seedSellerIdentity(ownerId, PUBLISHABLE_SELLER);
    await seedProducts(ownerId, [{ title: "Seeded lamp", status: "active" }]);
    const [product] = (await serviceRest(`/products?owner_id=eq.${ownerId}&select=id`)) as { id: string }[];

    // Everything on, so the whole list can be asked for.
    const clientId = await registerApp();
    const resource = await resourceUrl();
    const { verifier, challenge } = pkce();
    await gotoApp(page, authorizeUrl(clientId, challenge, resource));
    for (const scope of ["destructive", "orders:refund"]) {
      await page.locator(`[data-agent-scope="${scope}"]`).getByRole("switch").click();
    }
    const landed = await approve(page);
    const token = (await (
      await exchange(clientId, landed.searchParams.get("code") ?? "", verifier, resource)
    ).json()) as { access_token: string };
    const client = await mcpClient(token.access_token);

    const seen: string[] = [];
    const ok = async (name: string, args: Record<string, unknown> = {}) => {
      const result = await call(client, name, args);
      expect(result.isError, `${name}: ${JSON.stringify(result.data)}`).toBe(false);
      const text = JSON.stringify(result.data);
      expect(text, name).not.toMatch(/(images|files|fonts|elements|documents)\/[0-9a-f]{8}-/);
      expect(text, name).not.toMatch(/embed_?key/i);
      seen.push(name);
      return result.data;
    };

    const { id: storefrontId } = (await ok("create_storefront")) as { id: string };

    await ok("get_store");
    await ok("get_profile");
    await ok("list_team");
    await ok("list_plan_prices");
    await ok("list_products", { search: "lamp" });
    await ok("get_product", { id: product.id });
    await ok("get_products_summary");
    await ok("get_product_sales");
    await ok("preview_product_page", { id: product.id });
    await ok("list_storefronts");
    await ok("get_storefront", { id: storefrontId });
    for (const of of ["storefront_config", "product", "shipping_policy", "discount"]) {
      const schema = await ok("get_schema", { of });
      expect(schema.$schema ?? schema.type, of).toBeTruthy();
    }
    await ok("get_product_page", { id: storefrontId });
    await ok("get_checkout_page", { id: storefrontId });
    const shipping = await ok("get_shipping_policy");
    await ok("list_orders");
    await ok("list_orders", { view: "to-ship" });
    await ok("get_order_counts");
    await ok("list_discounts");
    await ok("get_discount_performance");
    await ok("list_reviews");
    await ok("get_review_overview");
    await ok("get_analytics");
    await ok("get_analytics", { allTime: true });
    await ok("get_dashboard_summary");
    await ok("list_notifications");
    await ok("get_unread_count");

    await ok("update_stock", { id: product.id, trackStock: true, stockQuantity: 7, lowStockThreshold: 2 });
    await ok("check_badge_label", { label: "New" });
    await ok("update_embed_settings", { id: storefrontId, enabled: true, domains: ["shop.example.com"] });
    await ok("update_product_page", { id: storefrontId, settings: { ctaLabel: "Get it" } });
    await ok("update_checkout_page", { id: storefrontId, settings: { celebrate: "none" } });
    await ok("save_shipping_policy", { policy: shipping.policy });
    await ok("update_bio", { bio: "Lamps, made slowly." });
    await ok("save_notification_settings", {
      notifySales: true,
      notifyReviews: true,
      notifyProductUpdates: false,
      notifyMarketing: false,
    });
    await ok("mark_all_notifications_read");

    const sale = (await ok("create_discount", {
      discount: {
        kind: "automatic",
        value: { type: "percent", percentOff: 10 },
        appliesTo: "all",
        productIds: [],
        startsAt: null,
        endsAt: null,
      },
    })) as { id?: string };
    const [row] = (await serviceRest(`/discounts?owner_id=eq.${ownerId}&select=id`)) as { id: string }[];
    await ok("get_discount", { id: sale.id ?? row.id });
    await ok("end_sale", { id: sale.id ?? row.id });
    await ok("delete_discount", { id: sale.id ?? row.id });

    await ok("rotate_embed_key", { id: storefrontId });
    await ok("delete_storefront", { id: storefrontId });

    expect(seen.length).toBeGreaterThan(30);
    await client.close();
  });

  test("a client still on the 2025 protocol works too", async ({ page }) => {
    const user = freshUser("mcpold");
    await signUp(page, user);
    const { accessToken } = await connect(page);

    const init = await legacyPost(accessToken, "initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "old-client", version: "1" },
    });
    expect(init.status).toBe(200);
    const initialized = await rpcResult(init);
    expect((initialized.result as { serverInfo: { name: string } }).serverInfo.name).toBe("square-share");

    const list = await rpcResult(await legacyPost(accessToken, "tools/list", {}));
    const names = (list.result as { tools: { name: string }[] }).tools.map((tool) => tool.name);
    expect(names).toContain("get_store");

    const store = await rpcResult(
      await legacyPost(accessToken, "tools/call", { name: "get_store", arguments: {} }),
    );
    const content = (store.result as { content: { text: string }[] }).content[0].text;
    expect(JSON.parse(content).role).toBe("owner");
  });
});

test.describe("taking access away", () => {
  test.setTimeout(180_000);

  test("Disconnect in Settings ends it on the very next call", async ({ page }) => {
    const user = freshUser("mcprev");
    await signUp(page, user);
    const { accessToken, refreshToken, clientId } = await connect(page, { name: "Revocable App" });
    const client = await mcpClient(accessToken);
    expect((await call(client, "get_store")).isError).toBe(false);
    await client.close();

    await gotoApp(page, "/settings/connected-apps");
    await expect(page.locator("[data-mcp-url]")).toContainText("/mcp");
    const row = page.locator('[data-connected-app="Revocable App"]');
    await expect(row).toContainText("client.example");
    await row.getByRole("button", { name: /disconnect/i }).click();
    await page.getByRole("dialog").getByRole("button", { name: /disconnect/i }).click();
    await expect(page.locator('[data-connected-app="Revocable App"]')).toHaveCount(0);

    const res = await legacyPost(accessToken, "tools/list", {});
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain('error="invalid_token"');
    expect((await refresh(clientId, refreshToken)).status).toBe(400);
  });

  test("a refresh rotates, and an old token used again kills the connection", async ({ page }) => {
    const user = freshUser("mcpref");
    await signUp(page, user);
    const first = await connect(page);

    const rotated = await refresh(first.clientId, first.refreshToken);
    expect(rotated.status).toBe(200);
    const second = (await rotated.json()) as { access_token: string; refresh_token: string };
    expect(second.refresh_token).not.toBe(first.refreshToken);
    expect((await legacyPost(second.access_token, "tools/list", {})).status).toBe(200);

    // At once: a client retrying a lost response, let off without harm.
    expect((await refresh(first.clientId, first.refreshToken)).status).toBe(400);
    expect((await legacyPost(second.access_token, "tools/list", {})).status).toBe(200);

    // Later: two parties hold it, so the whole connection goes.
    const past = new Date(Date.now() - 60_000).toISOString();
    await serviceRest(`/agent_tokens?used_at=not.is.null`, { method: "PATCH", body: { used_at: past } });
    expect((await refresh(first.clientId, first.refreshToken)).status).toBe(400);
    expect((await legacyPost(second.access_token, "tools/list", {})).status).toBe(401);
  });

  test("changing nothing else, losing the team role ends a teammate's assistant", async ({ page, browser }) => {
    const member = freshUser("mcpmem");
    await signUp(page, member);
    const memberId = await userIdByEmail(member.email);

    const ownerContext = await browser.newContext();
    const ownerPage = await ownerContext.newPage();
    const owner = freshUser("mcpown");
    await signUp(ownerPage, owner);
    const ownerId = await userIdByEmail(owner.email);
    await ownerContext.close();

    const [row] = (await serviceRest(`/team_members`, {
      method: "POST",
      body: {
        account_owner_id: ownerId,
        member_user_id: memberId,
        invited_email: member.email,
        role: "viewer",
        status: "active",
        accepted_at: new Date().toISOString(),
      },
    })) as { id: string }[];

    const clientId = await registerApp();
    const resource = await resourceUrl();
    const { verifier, challenge } = pkce();
    await gotoApp(page, authorizeUrl(clientId, challenge, resource));
    await page.locator("#agent-consent-store").click();
    await page.getByRole("option").nth(1).click();
    // A viewer is offered nothing a viewer could not do.
    await expect(page.locator('[data-agent-scope="products:write"]')).toHaveCount(0);
    const landed = await approve(page);
    const token = (await (
      await exchange(clientId, landed.searchParams.get("code") ?? "", verifier, resource)
    ).json()) as { access_token: string };

    const client = await mcpClient(token.access_token);
    const store = await call(client, "get_store");
    expect(store.data.accountId).toBe(ownerId);
    expect(store.data.role).toBe("viewer");
    await client.close();

    await serviceRest(`/team_members?id=eq.${row.id}`, { method: "PATCH", body: { status: "revoked" } });
    expect((await legacyPost(token.access_token, "tools/list", {})).status).toBe(401);
  });
});

test.describe("the daily cleanup", () => {
  test("drops what has expired, keeps what is live, and answers only the scheduler", async ({ page }) => {
    test.setTimeout(120_000);
    const user = freshUser("mcpclean");
    await signUp(page, user);
    const { accessToken } = await connect(page);

    const stale = randomBytes(16).toString("hex");
    const [grant] = (await serviceRest(
      `/agent_grants?user_id=eq.${await userIdByEmail(user.email)}&select=id`,
    )) as { id: string }[];
    await serviceRest(`/agent_tokens`, {
      method: "POST",
      body: { token_hash: stale, grant_id: grant.id, kind: "access", expires_at: new Date(Date.now() - 1000).toISOString() },
    });

    expect((await fetch(`${APP}/api/cron/agent-cleanup`, { method: "POST" })).status).toBe(404);
    const run = await fetch(`${APP}/api/cron/agent-cleanup`, {
      method: "POST",
      headers: { authorization: "Bearer e2e-cron-secret-not-a-real-one-0123456789" },
    });
    expect(run.status).toBe(200);

    expect(await serviceRest(`/agent_tokens?token_hash=eq.${stale}&select=token_hash`)).toEqual([]);
    expect((await legacyPost(accessToken, "tools/list", {})).status).toBe(200);
  });
});

test.describe("the code exchange", () => {
  test.setTimeout(120_000);

  test("wants the right verifier, once", async ({ page }) => {
    const user = freshUser("mcpcode");
    await signUp(page, user);
    const clientId = await registerApp();
    const resource = await resourceUrl();
    const { verifier, challenge } = pkce();
    await gotoApp(page, authorizeUrl(clientId, challenge, resource));
    const landed = await approve(page);
    const code = landed.searchParams.get("code") ?? "";

    const wrong = await exchange(clientId, code, pkce().verifier, resource);
    expect(wrong.status).toBe(400);
    expect(((await wrong.json()) as { error: string }).error).toBe("invalid_grant");
    // The attempt spent the code, so even the right verifier is too late now.
    expect((await exchange(clientId, code, verifier, resource)).status).toBe(400);
  });

  test("a token for anything else is refused", async () => {
    const res = await fetch(`${APP}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: "x",
        code: "x",
        code_verifier: pkce().verifier,
        resource: "https://other.example/mcp",
      }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("invalid_target");
  });

  test("an unknown app or a redirect it never registered gets no redirect at all", async ({ page }) => {
    const user = freshUser("mcpbad");
    await signUp(page, user);
    const resource = await resourceUrl();
    const { challenge } = pkce();

    await gotoApp(page, authorizeUrl("app_nobody", challenge, resource));
    await expect(page.locator('[data-agent-consent-refused="unknown_client"]')).toBeVisible();

    const clientId = await registerApp();
    const query = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: "https://evil.example/steal",
      code_challenge: challenge,
      code_challenge_method: "S256",
      resource,
    });
    await gotoApp(page, `/oauth/authorize?${query}`);
    await expect(page.locator('[data-agent-consent-refused="bad_redirect"]')).toBeVisible();
    expect(page.url()).toContain("localhost:3100");
  });

  test("saying no sends the app away with nothing", async ({ page }) => {
    const user = freshUser("mcpno");
    await signUp(page, user);
    const clientId = await registerApp();
    const resource = await resourceUrl();
    const { challenge } = pkce();
    await gotoApp(page, authorizeUrl(clientId, challenge, resource));

    const landed = new Promise<URL>((resolve) => {
      void page.route("https://client.example/**", async (route) => {
        resolve(new URL(route.request().url()));
        await route.fulfill({ status: 200, contentType: "text/html", body: "<p>back</p>" });
      });
    });
    await page.getByRole("link", { name: /cancel/i }).click();
    const url = await landed;
    expect(url.searchParams.get("error")).toBe("access_denied");
    expect(url.searchParams.has("code")).toBe(false);
  });

  test("signing in on the way keeps the whole request", async ({ page, context }) => {
    const user = freshUser("mcpdeep");
    await signUp(page, user);
    await context.clearCookies();
    const clientId = await registerApp("Deep Link App");
    const resource = await resourceUrl();
    const { challenge } = pkce();
    const path = authorizeUrl(clientId, challenge, resource);
    await page.goto(path);
    await page.waitForURL(/\/login/);
    expect(decodeURIComponent(page.url())).toContain(`client_id=${clientId}`);
    expect(decodeURIComponent(page.url())).toContain(`code_challenge=${challenge}`);
  });
});

test.describe("an account with two-factor on", () => {
  test.setTimeout(240_000);

  /** The token from a code, used as far as the 2FA policy on products reaches. */
  async function expectPastTwoFactorPolicy(clientId: string, landed: URL, verifier: string, resource: string) {
    const token = (await (
      await exchange(clientId, landed.searchParams.get("code") ?? "", verifier, resource)
    ).json()) as { access_token: string };
    const client = await mcpClient(token.access_token);
    const created = await call(client, "create_product", { title: "Past 2FA", priceCents: 700, currency: "EUR" });
    expect(created.isError, JSON.stringify(created.data)).toBe(false);
    const list = await call(client, "list_products");
    expect(JSON.stringify(list.data)).toContain("Past 2FA");
    await client.close();
  }

  test("an authenticator app types its code, and the assistant gets past the database's 2FA policy", async ({ page, context }) => {
    const user = freshUser("mcp2fa");
    await signUp(page, user);
    const { app } = await enableTwoFactor(page, user.password);
    await ageSecondFactor(context, 30 * 60);

    const clientId = await registerApp();
    const resource = await resourceUrl();
    const { verifier, challenge } = pkce();
    await gotoApp(page, authorizeUrl(clientId, challenge, resource));

    // On screen before Connect is pressed, as on every other step-up form.
    const codeBox = page.locator('[data-agent-consent="form"] input[name="mfa_code"]');
    await expect(codeBox).toBeVisible();
    await codeBox.fill(await nextCode(app));
    await expectPastTwoFactorPolicy(clientId, await approve(page), verifier, resource);
  });

  test("a passkey is one press, and no code is ever asked for", async ({ page, context }) => {
    const user = freshUser("mcppasskey");
    await signUp(page, user);
    await enablePasskey(page);
    await ageSecondFactor(context, 30 * 60);

    const clientId = await registerApp();
    const resource = await resourceUrl();
    const { verifier, challenge } = pkce();
    await gotoApp(page, authorizeUrl(clientId, challenge, resource));

    const form = page.locator('[data-agent-consent="form"]');
    const confirm = form.getByRole("button", { name: "Confirm with passkey" });
    await expect(confirm).toBeEnabled({ timeout: 20_000 });
    await expect(form.locator('input[name="mfa_code"]')).toHaveCount(0);
    await expect(form.locator('button[type="submit"]')).toHaveCount(0);
    await expectPastTwoFactorPolicy(clientId, await approve(page, confirm), verifier, resource);
  });

  test("having just signed in with it is enough: nothing more is asked", async ({ page }) => {
    const user = freshUser("mcpfresh");
    await signUp(page, user);
    await enablePasskey(page);

    const clientId = await registerApp();
    const resource = await resourceUrl();
    const { verifier, challenge } = pkce();
    await gotoApp(page, authorizeUrl(clientId, challenge, resource));

    const form = page.locator('[data-agent-consent="form"]');
    await expect(form.locator('button[type="submit"]')).toBeEnabled();
    await expect(form.locator("[data-step-up-field]")).toHaveCount(0);
    await expect(form.getByRole("button", { name: "Confirm with passkey" })).toHaveCount(0);
    await expectPastTwoFactorPolicy(clientId, await approve(page), verifier, resource);
  });
});

test.describe("an account without two-factor", () => {
  test("only has to be signed in", async ({ page }) => {
    const user = freshUser("mcpno2fa");
    await signUp(page, user);

    const clientId = await registerApp();
    const resource = await resourceUrl();
    const { challenge } = pkce();
    await gotoApp(page, authorizeUrl(clientId, challenge, resource));

    const form = page.locator('[data-agent-consent="form"]');
    await expect(form.locator('button[type="submit"]')).toBeEnabled();
    await expect(form.locator("[data-step-up-field]")).toHaveCount(0);
    await expect(form.getByRole("button", { name: "Confirm with passkey" })).toHaveCount(0);
    const landed = await approve(page);
    expect(landed.searchParams.get("code")).toBeTruthy();
  });
});
