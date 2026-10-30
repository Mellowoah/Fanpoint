"use client";
import { useEffect, useRef } from "react";
import "leaflet/dist/leaflet.css";
import type * as GeoJSON from "geojson";

export interface LL { lat: number; lon: number }
export interface Marker extends LL {
  label?: string; color: string; radius?: number; stroke?: string; permanent?: boolean; dir?: Dir; tooltip?: string;
  /** Shown instead of the label when the full label would overlap another one (the full label then shows on hover). */
  short?: string;
  /** Higher places its label first (anchors), so it keeps the full label. */
  priority?: number;
}
type Dir = "left" | "right" | "top" | "bottom";
interface Box { x0: number; y0: number; x1: number; y1: number }
const GAP = 9;
/** Where a label of size w x h sits for a point at (x, y) and a tooltip direction (matches Leaflet's offsets closely). */
export function labelBox(x: number, y: number, w: number, h: number, dir: Dir): Box {
  if (dir === "right") return { x0: x + GAP, y0: y - h / 2, x1: x + GAP + w, y1: y + h / 2 };
  if (dir === "left") return { x0: x - GAP - w, y0: y - h / 2, x1: x - GAP, y1: y + h / 2 };
  if (dir === "top") return { x0: x - w / 2, y0: y - GAP - h, x1: x + w / 2, y1: y - GAP };
  return { x0: x - w / 2, y0: y + GAP, x1: x + w / 2, y1: y + GAP + h };
}
const hit = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
/** Estimated pixel width of a 12 px label (Inter averages ~6.6 px a character) plus padding. */
export const labelWidth = (t: string) => Math.ceil(t.length * 6.6) + 16;

/**
 * Greedy label placement: each label (highest priority first) takes the first direction that overlaps no placed label,
 * no other dot and nothing off the map; failing that it shrinks to its short form; failing that it shows on hover only.
 */
export function placeLabels(items: { x: number; y: number; label: string; short?: string; dir?: Dir; priority?: number }[], size: { w: number; h: number }, dots: { x: number; y: number }[] = []) {
  const H = 20;
  const placed: Box[] = dots.map((d) => ({ x0: d.x - 6, y0: d.y - 6, x1: d.x + 6, y1: d.y + 6 }));
  const out: ({ text: string; dir: Dir } | null)[] = items.map(() => null);
  const order = items.map((_, i) => i).sort((a, b) => (items[b]!.priority ?? 0) - (items[a]!.priority ?? 0) || a - b);
  for (const i of order) {
    const it = items[i]!;
    const dirs: Dir[] = [...new Set<Dir>([it.dir ?? "right", "right", "left", "top", "bottom"])];
    const own = (b: Box) => b.x0 >= 0 && b.y0 >= 0 && b.x1 <= size.w && b.y1 <= size.h;
    // A label may touch its own dot, so drop that one from the obstacles.
    const others = placed.filter((b) => !(b.x0 === it.x - 6 && b.y0 === it.y - 6));
    let got: { text: string; dir: Dir; box: Box } | undefined;
    for (const text of [it.label, it.short].filter((t): t is string => !!t)) {
      for (const d of dirs) {
        const b = labelBox(it.x, it.y, labelWidth(text), H, d);
        if (own(b) && !others.some((o) => hit(o, b))) { got = { text, dir: d, box: b }; break; }
      }
      if (got) break;
    }
    if (got) { placed.push(got.box); out[i] = { text: got.text, dir: got.dir }; }
  }
  return out;
}
export interface Path { pts: LL[]; color: string; dash?: string; weight?: number }

/** Heat colour scale for Qloo fan heat (0..1): dark slate -> cyan -> purple -> pale lavender. */
export function heatColor(a: number): string {
  const stops: [number, [number, number, number]][] = [[0.3, [30, 41, 59]], [0.6, [6, 182, 212]], [0.75, [79, 120, 225]], [0.9, [124, 58, 237]], [1, [221, 214, 254]]];
  const x = Math.max(0.3, Math.min(1, a));
  for (let i = 1; i < stops.length; i++) {
    const [a0, c0] = stops[i - 1]!, [a1, c1] = stops[i]!;
    if (x > a1) continue;
    const t = (x - a0) / (a1 - a0);
    return `rgb(${c0.map((c, k) => Math.round(c + (c1[k]! - c) * t)).join(",")})`;
  }
  return "rgb(221,214,254)";
}

const NONE: never[] = [];

/**
 * Leaflet map with a self-hosted basemap (US state outlines from us-atlas: no tile server, no key).
 * Leaflet touches `window`, so everything is imported lazily inside the effect (client only).
 */
export default function MapView({ rings = NONE, cells = NONE, paths = NONE, markers = NONE, fit, height = 400 }: {
  rings?: LL[][]; cells?: [number, number, number][]; paths?: Path[]; markers?: Marker[]; fit?: LL[]; height?: number | string;
}) {
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let map: import("leaflet").Map | undefined;
    let cancelled = false;
    (async () => {
      const [L, { feature }, topo] = await Promise.all([import("leaflet"), import("topojson-client"), import("us-atlas/states-10m.json")]);
      if (cancelled || !el.current) return;
      const m = L.map(el.current, { zoomControl: false, scrollWheelZoom: false, zoomSnap: 0.25, preferCanvas: true });
      map = m;
      const pts = fit?.length ? fit : [...markers, ...paths.flatMap((p) => p.pts)];
      if (pts.length > 1) m.fitBounds(L.latLngBounds(pts.map((p) => [p.lat, p.lon] as [number, number])), { padding: [36, 36], maxZoom: 7 });
      else m.fitBounds([[24.5, -125], [49.5, -66.5]]);
      const t = (topo as { default?: unknown }).default ?? topo;
      const states = feature(t as never, (t as { objects: { states: never } }).objects.states) as unknown as GeoJSON.FeatureCollection;
      states.features = states.features.filter((f) => !["02", "15", "60", "66", "69", "72", "78"].includes(String(f.id)));
      L.geoJSON(states, { style: { color: "#2e3440", weight: 1, fillColor: "#171a21", fillOpacity: 1 }, interactive: false }).addTo(m);
      m.attributionControl.addAttribution("State outlines: US Census / us-atlas");
      for (const r of rings) L.polygon(r.map((p) => [p.lat, p.lon] as [number, number]), { color: "#7c3aed", weight: 1, opacity: 0.35, dashArray: "3 5", fillOpacity: 0.03, interactive: false }).addTo(m);
      for (const [lat, lon, a] of cells)
        L.circleMarker([lat, lon], { radius: 3 + a * 4, stroke: false, fillColor: heatColor(a), fillOpacity: 0.12 + Math.max(0, a - 0.3) * 0.7, interactive: false }).addTo(m);
      for (const p of paths) L.polyline(p.pts.map((x) => [x.lat, x.lon] as [number, number]), { color: p.color, weight: p.weight ?? 2.5, opacity: 0.9, dashArray: p.dash }).addTo(m);
      const size = m.getSize();
      const pt = (k: LL) => m.latLngToContainerPoint([k.lat, k.lon]);
      const labelled = markers.filter((k) => k.label && (k.permanent ?? true));
      const spots = placeLabels(labelled.map((k) => { const p = pt(k); return { x: p.x, y: p.y, label: k.label!, short: k.short, dir: k.dir, priority: k.priority }; }),
        { w: size.x, h: size.y }, markers.map((k) => { const p = pt(k); return { x: p.x, y: p.y }; }));
      const spot = new Map(labelled.map((k, i) => [k, spots[i]]));
      const OFF: Record<Dir, [number, number]> = { right: [8, 0], left: [-8, 0], top: [0, -8], bottom: [0, 8] };
      for (const k of markers) {
        const cm = L.circleMarker([k.lat, k.lon], { radius: k.radius ?? 7, color: k.stroke ?? "#0f1115", weight: 2, fillColor: k.color, fillOpacity: 1 });
        const sp = spot.get(k);
        if (k.label && (k.permanent ?? true)) {
          const full = k.tooltip ?? k.label;
          if (sp) {
            cm.bindTooltip(sp.text, { permanent: true, direction: sp.dir, offset: OFF[sp.dir], className: "stop-label" });
            if (sp.text !== full) { cm.on("mouseover", () => cm.setTooltipContent(full)); cm.on("mouseout", () => cm.setTooltipContent(sp.text)); }
          } else cm.bindTooltip(full, { className: "stop-label" });
        } else if (k.label) cm.bindTooltip(k.label, { permanent: false, direction: k.dir ?? "right", className: "stop-label" });
        else if (k.tooltip) cm.bindTooltip(k.tooltip, { className: "stop-label" });
        cm.addTo(m);
      }
    })();
    return () => { cancelled = true; map?.remove(); };
  }, [rings, cells, paths, markers, fit]);
  return <div ref={el} style={{ height }} className="relative w-full rounded-xl border border-line overflow-hidden [contain:paint] bg-background" />;
}
