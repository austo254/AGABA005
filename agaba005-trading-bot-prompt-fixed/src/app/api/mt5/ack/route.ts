import { ingestAck } from "@/server/engine";

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
    if (raw && raw.length <= 64_000) await ingestAck(raw);
    return new Response("OK", { status: 200, headers: { "Content-Type": "text/plain" } });
  } catch {
    return new Response("ERR", { status: 500 });
  }
}
