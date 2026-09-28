import { NextResponse } from "next/server";
import { control } from "@/server/engine";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as { action?: string; value?: number | string };
    const action = String(body.action ?? "");
    const allowed = new Set(["start", "stop", "flatten", "risk", "reset", "mode"]);
    if (!allowed.has(action)) {
      return NextResponse.json({ ok: false, error: "unknown action" }, { status: 400 });
    }
    const res = await control(action, body.value);
    return NextResponse.json(res);
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "control failure" },
      { status: 500 },
    );
  }
}
