"use client";
import { useEffect, useRef } from "react";
import "leaflet/dist/leaflet.css";
import type * as GeoJSON from "geojson";

export interface LL { lat: number; lon: number }
export interface Marker extends LL { label?: string; color: string; radius?: number; stroke?: string; permanent?: boolean; dir?: "left" | "right" | "top" | "bottom"; tooltip?: string }
export interface Path { pts: LL[]; color: string; dash?: string; weight?: number }

/** Heat colour scale for Qloo fan heat (0..1): cool slate -> amber -> hot orange/white. */
export function heatColor(a: number): string {
  const stops: [number, [number, number, number]][] = [[0.3, [40, 52, 80]], [0.6, [120, 70, 140]], [0.75, [235, 110, 60]], [0.9, [255, 170, 60]], [1, [255, 240, 200]]];
  const x = Math.max(0.3, Math.min(1, a));
  for (let i = 1; i < stops.length; i++) {
    const [a0, c0] = stops[i - 1]!, [a1, c1] = stops[i]!;
    if (x > a1) continue;
    const t = (x - a0) / (a1 - a0);
    return `rgb(${c0.map((c, k) => Math.round(c + (c1[k]! - c) * t)).join(",")})`;
  }
  return "rgb(255,240,200)";
}

const NONE: never[] = [];

/**
 * Leaflet map with a self-hosted basemap (US state outlines from us-atlas: no tile server, no key).
 * Leaflet touches `window`, so everything is imported lazily inside the effect (client only).
 */
export default function MapView({ rings = NONE, cells = NONE, paths = NONE, markers = NONE, fit, height = 400 }: {
  rings?: LL[][]; cells?: [number, number, number][]; paths?: Path[]; markers?: Marker[]; fit?: LL[]; height?: number;
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
      L.geoJSON(states, { style: { color: "#2b3242", weight: 1, fillColor: "#131824", fillOpacity: 1 }, interactive: false }).addTo(m);
      m.attributionControl.addAttribution("State outlines: US Census / us-atlas");
      for (const r of rings) L.polygon(r.map((p) => [p.lat, p.lon] as [number, number]), { color: "#ff7a45", weight: 1, opacity: 0.35, dashArray: "3 5", fillOpacity: 0.03, interactive: false }).addTo(m);
      for (const [lat, lon, a] of cells)
        L.circleMarker([lat, lon], { radius: 3 + a * 4, stroke: false, fillColor: heatColor(a), fillOpacity: 0.12 + Math.max(0, a - 0.3) * 0.7, interactive: false }).addTo(m);
      for (const p of paths) L.polyline(p.pts.map((x) => [x.lat, x.lon] as [number, number]), { color: p.color, weight: p.weight ?? 2.5, opacity: 0.9, dashArray: p.dash }).addTo(m);
      for (const k of markers) {
        const cm = L.circleMarker([k.lat, k.lon], { radius: k.radius ?? 7, color: k.stroke ?? "#0b0d12", weight: 2, fillColor: k.color, fillOpacity: 1 });
        if (k.label) cm.bindTooltip(k.label, { permanent: k.permanent ?? true, direction: k.dir ?? "right", offset: [k.dir === "left" ? -8 : 8, 0], className: "stop-label" });
        else if (k.tooltip) cm.bindTooltip(k.tooltip, { className: "stop-label" });
        cm.addTo(m);
      }
    })();
    return () => { cancelled = true; map?.remove(); };
  }, [rings, cells, paths, markers, fit]);
  return <div ref={el} style={{ height }} className="w-full rounded-xl border border-line overflow-hidden" />;
}
