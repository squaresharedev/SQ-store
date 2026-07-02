export function GET() {
  return new Response(
    JSON.stringify({
      url: process.env.NEXT_PUBLIC_SUPABASE_URL ? "✓ Set" : "✗ Missing",
      key: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ? "✓ Set" : "✗ Missing",
      NODE_ENV: process.env.NODE_ENV,
    }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
}
