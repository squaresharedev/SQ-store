import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * API route for auth that works around Node.js v24 fetch issues.
 * This route uses the Supabase client which may have better fetch handling.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, password, intent } = body;

    const supabase = await createClient();

    if (intent === "signin") {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }

      return NextResponse.json({ success: true });
    }

    return NextResponse.json(
      { error: "Invalid intent" },
      { status: 400 }
    );
  } catch (error) {
    console.error("Auth API error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Authentication failed",
      },
      { status: 500 }
    );
  }
}
