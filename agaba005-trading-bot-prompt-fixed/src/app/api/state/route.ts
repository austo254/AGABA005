import { NextResponse } from "next/server";
import { getSnapshot } from "@/server/engine";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    const snap = await getSnapshot();
    return NextResponse.json(snap);
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "engine failure" },
      { status: 500 },
    );
  }
}
