import { actsForRoom } from "@/lib/api/promoter";

/** GET /api/promoter/room?city=Durham&venue=<Qloo place id> -> music acts whose fans fit that room (fixtures in mock mode). */
export async function GET(request: Request) {
  const sp = new URL(request.url).searchParams;
  const { status, body } = await actsForRoom(sp.get("city"), sp.get("venue"));
  return Response.json(body, { status, headers: { "cache-control": status === 200 && !body.error ? "private, max-age=300" : "no-store" } });
}
