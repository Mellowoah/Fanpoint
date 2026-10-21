import { findActs } from "@/lib/api/promoter";

/** GET /api/promoter?city=Nashville&genre=country -> top acts by Qloo affinity for that city (fixtures in mock mode). */
export async function GET(request: Request) {
  const sp = new URL(request.url).searchParams;
  const { status, body } = await findActs(sp.get("city"), sp.get("genre"));
  return Response.json(body, { status, headers: { "cache-control": status === 200 && !body.error ? "private, max-age=300" : "no-store" } });
}
