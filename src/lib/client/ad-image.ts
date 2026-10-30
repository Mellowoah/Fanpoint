/** Placeholder ad image drawn in the browser (canvas): artist, city, date, venue and the Qloo hook. Nothing is uploaded. */
export interface CardText { artist: string; city: string; date: string; venue?: string; hook?: string }

function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const t = line ? `${line} ${w}` : w;
    if (ctx.measureText(t).width <= maxW || !line) line = t; else { lines.push(line); line = w; }
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) { const keep = lines.slice(0, maxLines); keep[maxLines - 1] = keep[maxLines - 1]!.replace(/\s*\S*$/, "") + "…"; return keep; }
  return lines;
}

/** PNG data URL at w×h (1080×1080 or 1080×1920). */
export function adCardPng(t: CardText, w: number, h: number): string {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const ctx = c.getContext("2d");
  if (!ctx) return "";
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, "#0b0d12"); g.addColorStop(0.55, "#1e1b4b"); g.addColorStop(1, "#7c3aed");
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  const pad = 96, maxW = w - pad * 2, font = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
  let y = h > w ? 420 : 200;
  ctx.fillStyle = "#22d3ee"; ctx.font = `700 40px ${font}`; ctx.fillText("LIVE", pad, y); y += 110;
  ctx.fillStyle = "#ffffff"; ctx.font = `800 104px ${font}`;
  for (const l of wrap(ctx, t.artist, maxW, 2)) { ctx.fillText(l, pad, y); y += 116; }
  y += 10;
  ctx.font = `600 56px ${font}`; ctx.fillStyle = "#e2e8f0";
  for (const l of wrap(ctx, `${t.city} · ${t.date}`, maxW, 2)) { ctx.fillText(l, pad, y); y += 70; }
  if (t.venue) { ctx.font = `500 44px ${font}`; ctx.fillStyle = "#cbd5e1"; for (const l of wrap(ctx, t.venue, maxW, 2)) { ctx.fillText(l, pad, y); y += 58; } }
  if (t.hook) {
    y += 40; ctx.font = `500 40px ${font}`; ctx.fillStyle = "#ddd6fe";
    for (const l of wrap(ctx, `Fans here also love ${t.hook}`, maxW, 2)) { ctx.fillText(l, pad, y); y += 52; }
  }
  ctx.font = `500 30px ${font}`; ctx.fillStyle = "rgba(255,255,255,0.6)";
  ctx.fillText("Draft placeholder · replace with your artwork", pad, h - pad);
  return c.toDataURL("image/png");
}

export function downloadDataUrl(name: string, url: string) {
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
}
