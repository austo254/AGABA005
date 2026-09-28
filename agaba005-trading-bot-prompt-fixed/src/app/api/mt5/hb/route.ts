import { ingestHeartbeat } from "@/server/engine";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const EXPECTED = () => process.env.MT5_BRIDGE_KEY ?? "agaba-demo-key";

export async function POST(req: Request) {
  const key = req.headers.get("x-agaba-key") ?? "";
  if (key !== EXPECTED()) {
    return new Response("UNAUTHORIZED", { status: 401 });
  }
  try {
    const raw = await req.text();
    if (!raw || raw.length > 512_000) return new Response("BAD BODY", { status: 400 });
    const out = await ingestHeartbeat(raw);
    return new Response(out, {
      status: 200,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    });
  } catch (err) {
    return new Response(`ERR ${err instanceof Error ? err.message : "ingest"}`, { status: 500 });
  }
}
