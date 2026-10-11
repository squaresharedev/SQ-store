import { z } from "zod";
import {
  AUTO_TARGETS,
  checkAvatar,
  checkHandle,
  checkSellerText,
  checkTarget,
} from "@/lib/moderation/auto/check";
import { cronAuthorized } from "@/lib/ops/cron";
import { presignGetUrl } from "@/lib/r2";

/**
 * POST /api/moderation/check: the automatic check, for the other apps on the
 * platform (the marketplace Worker today).
 *
 * WHY IT EXISTS. No app NEEDS to call this to be safe: the moderation wall is
 * in the database, and a row nobody checked is hidden until the sweep reaches
 * it. This is for the app that wants its answer now, while the person who
 * saved is still looking at the screen.
 *
 * FOUR QUESTIONS, one per request:
 *
 *   { target: { type, id } }   settle one stored row; answers its outcome.
 *                              The caller names the row and nothing else:
 *                              the content is read from the database.
 *   { text: { field: value } } judge a few fields of text that are checked
 *                              before they are stored (a collection name, an
 *                              artifact's title).
 *   { handle }                 judge a handle. A clean answer is what lets
 *                              the public directory list a profile under it.
 *   { avatar: { key, url } }   judge one stored profile picture by its object
 *                              key. A clean answer is recorded against `url`,
 *                              the value the profile will hold, which is what
 *                              lets the directory show it.
 *
 * Server to server only: behind the same secret as the scheduled jobs
 * (lib/ops/cron.ts), and a 404 to anyone without it.
 */
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

/** The object-key shape buildObjectKey mints, in this app and the marketplace. */
const OBJECT_KEY = /^[a-z]{1,20}\/[0-9a-f-]{36}\/[0-9a-f-]{36}-[A-Za-z0-9._-]{1,120}$/;

const bodySchema = z.union([
  z.strictObject({
    target: z.strictObject({ type: z.enum(AUTO_TARGETS), id: z.uuid() }),
  }),
  z.strictObject({
    text: z
      .record(z.string().regex(/^[A-Za-z][A-Za-z0-9_.]{0,39}$/), z.string().max(4000))
      .refine((fields) => Object.keys(fields).length >= 1 && Object.keys(fields).length <= 10),
  }),
  z.strictObject({ handle: z.string().regex(/^[A-Za-z0-9_]{3,30}$/) }),
  z.strictObject({
    avatar: z
      .strictObject({ key: z.string().regex(OBJECT_KEY), url: z.url().max(700) })
      // The approval is recorded against the URL, so the URL has to be the
      // object that was judged and nothing else: https, and ending in its key.
      .refine(({ key, url }) => url.startsWith("https://") && url.endsWith(`/${key}`)),
  }),
]);

export async function POST(request: Request) {
  if (!(await cronAuthorized(request))) return new Response(null, { status: 404, headers: NO_STORE });

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return Response.json({ error: "invalid" }, { status: 400, headers: NO_STORE });
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return Response.json({ error: "invalid" }, { status: 400, headers: NO_STORE });
  }
  const body = parsed.data;

  if ("target" in body) {
    const outcome = await checkTarget(body.target.type, body.target.id);
    return Response.json({ outcome }, { headers: NO_STORE });
  }

  // A standalone verdict. `unavailable` is its own answer so a caller cannot
  // mistake "nobody could say" for "it is fine".
  const verdict =
    "text" in body
      ? await checkSellerText(body.text)
      : "handle" in body
        ? await checkHandle(body.handle)
        : await presignGetUrl(body.avatar.key).then((url) =>
            url ? checkAvatar(body.avatar.url, url) : null,
          );
  return Response.json(
    verdict
      ? { verdict: verdict.verdict, ground: verdict.ground, paths: verdict.paths }
      : { verdict: "unavailable" },
    { headers: NO_STORE },
  );
}
