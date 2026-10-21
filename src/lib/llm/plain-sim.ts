/**
 * MOCK "plain AI" answer for Fill the gaps (used only when LLM_API_KEY is not set).
 * It is NOT a model output. It is a deterministic heuristic that imitates what LLM-only routing typically does:
 * fill every off day, prefer famous/major markets near the route, order them roughly along the way, and name venues
 * from general knowledge (here: generic placeholders). It is shown with a SIMULATED badge. Real comparisons need a live LLM.
 */
import { US_CITIES, findCity } from "../route/cities";
import { addDays, daysBetween } from "../route/fill";
import { gcMi } from "../route/geo";

export function simulatePlainFill(req: { anchors: { city: string; date: string }[] }) {
  const anchors = [...req.anchors].sort((a, b) => a.date.localeCompare(b.date));
  const used = new Set(anchors.map((a) => a.city.toLowerCase()));
  const stops: { date: string; city: string; venue: string; why: string }[] = [];
  anchors.slice(0, -1).forEach((from, i) => {
    const to = anchors[i + 1]!;
    const A = findCity(from.city), B = findCity(to.city);
    if (!A || !B) return;
    const off = daysBetween(from.date, to.date) - 1;
    const AB = gcMi(A, B);
    // Big metros (Census metro population >= 1M) within a loose band of the route, biggest first: the
    // "famous markets" bias LLM-only routing tends to show. One city per metro.
    const metros = new Set<string>();
    const pool = US_CITIES.filter((c) => !used.has(c.name.toLowerCase()) && c.metro.population >= 1_000_000 && gcMi(A, c) + gcMi(c, B) < AB + 260)
      .sort((x, y) => y.metro.population - x.metro.population)
      .filter((c) => (metros.has(c.metro.cbsa) ? false : (metros.add(c.metro.cbsa), true)))
      .slice(0, off)
      .sort((x, y) => gcMi(A, x) - gcMi(A, y));
    pool.forEach((c, k) => {
      used.add(c.name.toLowerCase());
      const big = c.metro.population >= 2_500_000;
      stops.push({ date: addDays(from.date, k + 1), city: c.name, venue: big ? "a well-known mid-size club" : "a popular local venue",
        why: big ? `${c.name} is a major market with a big live-music scene.` : `${c.name} is a solid regional market on the way.` });
    });
  });
  return { _simulated: true, summary: "Every off day filled with established markets along the route.", stops };
}
