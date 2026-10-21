import { connection } from "next/server";
import { publicModes } from "@/lib/config";

/** GET /api/health -> which providers are live vs mock. Never exposes keys. */
export async function GET() {
  await connection();
  return Response.json({ ok: true, modes: publicModes() });
}
