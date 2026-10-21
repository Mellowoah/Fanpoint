import { suggestArtists } from "@/lib/api/artist-suggest";

/** GET /api/artists?q=jap -> up to 6 artist suggestions (Qloo /search in live mode, fixtures in mock mode). */
export async function GET(request: Request) {
  const { status, body } = await suggestArtists(new URL(request.url).searchParams.get("q"));
  return Response.json(body, { status, headers: { "cache-control": status === 200 ? "private, max-age=300" : "no-store" } });
}
