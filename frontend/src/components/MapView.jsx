// MapLibre map for the dashboard (B2–B4). Loaded lazily, only on map routes (B14).
// Base map: a self-hosted Protomaps PMTiles extract at /tiles/pilot.pmtiles (B3). If it is missing, the map
// still works on a plain background with all report layers (R35).
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { Protocol } from "pmtiles";
import { useEffect, useRef, useState } from "react";

const CATEGORY_COLOR = {
  waterlogging: "#2a6fd6",
  water_pollution: "#5b7f2a",
  damaged_road: "#6b6b6b",
  deforestation: "#a84a17",
  drainage: "#7a4fb0",
  garbage: "#b7791f",
  streetlight: "#1c3d3d",
};
const BAND_COLOR = { high: "#c0392b", medium: "#b7791f", low: "#4a5f7a" };

let protocolAdded = false;

async function tilesAvailable() {
  try {
    const r = await fetch("/tiles/pilot.pmtiles", { method: "HEAD" });
    return r.ok;
  } catch {
    return false;
  }
}

function baseStyle(withTiles) {
  const layers = [{ id: "bg", type: "background", paint: { "background-color": "#efe9df" } }];
  const sources = {};
  if (withTiles) {
    sources.protomaps = { type: "vector", url: "pmtiles:///tiles/pilot.pmtiles", attribution: "© OpenStreetMap contributors" };
    layers.push(
      { id: "earth", type: "fill", source: "protomaps", "source-layer": "earth", paint: { "fill-color": "#f2ede4" } },
      { id: "landuse", type: "fill", source: "protomaps", "source-layer": "landuse", paint: { "fill-color": "#dfe8d3", "fill-opacity": 0.7 } },
      { id: "water", type: "fill", source: "protomaps", "source-layer": "water", paint: { "fill-color": "#b9d3e3" } },
      { id: "buildings", type: "fill", source: "protomaps", "source-layer": "buildings", minzoom: 14, paint: { "fill-color": "#e2d9cc" } },
      {
        id: "roads", type: "line", source: "protomaps", "source-layer": "roads",
        paint: {
          "line-color": ["match", ["get", "kind"], "highway", "#d9a96b", "major_road", "#e6c79a", "#ffffff"],
          "line-width": ["interpolate", ["linear"], ["zoom"], 10, 0.5, 14, 2, 17, 7],
        },
      },
    );
  }
  return { version: 8, sources, layers };
}

function popupNode(lines, button) {
  const box = document.createElement("div");
  box.style.cssText = "font: 15px/1.4 'Anek Bangla', system-ui; color: #1c3d3d; min-width: 160px";
  lines.forEach(([text, bold]) => {
    const p = document.createElement("div");
    p.textContent = text; // textContent only: never inject HTML from data
    if (bold) p.style.fontWeight = "700";
    box.appendChild(p);
  });
  if (button) {
    const b = document.createElement("button");
    b.textContent = button.label;
    b.style.cssText = "margin-top:6px;padding:6px 10px;border-radius:8px;background:#357575;color:#fff;font-weight:600";
    b.onclick = button.onClick;
    box.appendChild(b);
  }
  return box;
}

export default function MapView({ points, grid, hotspots, mode, layer, until, focus, onOpenReport, onReady }) {
  const box = useRef(null);
  const map = useRef(null);
  const [failed, setFailed] = useState(null);
  const [tiles, setTiles] = useState(null);
  const loaded = useRef(false);
  const fitted = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const has = await tilesAvailable();
      if (cancelled) return;
      setTiles(has);
      if (has && !protocolAdded) {
        maplibregl.addProtocol("pmtiles", new Protocol().tile);
        protocolAdded = true;
      }
      try {
        const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
        const m = new maplibregl.Map({
          container: box.current, style: baseStyle(has), center: [90.47, 23.72], zoom: 10.2, attributionControl: { compact: true },
          fadeDuration: reduce ? 0 : 300,
        });
        m.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
        m.on("load", () => {
          m.addSource("reports", { type: "geojson", data: { type: "FeatureCollection", features: [] }, cluster: true, clusterRadius: 40, clusterMaxZoom: 15 });
          m.addSource("reports-flat", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
          m.addSource("grid", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
          m.addSource("hotspots", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
          m.addLayer({ id: "hot-fill", type: "fill", source: "hotspots", filter: ["==", ["geometry-type"], "Polygon"], paint: { "fill-color": ["get", "color"], "fill-opacity": 0.18 } });
          m.addLayer({ id: "hot-line", type: "line", source: "hotspots", filter: ["==", ["geometry-type"], "Polygon"], paint: { "line-color": ["get", "color"], "line-width": 2 } });
          m.addLayer({
            id: "heat", type: "heatmap", source: "reports-flat", layout: { visibility: "none" },
            paint: { "heatmap-radius": 28, "heatmap-intensity": 1.1, "heatmap-color": ["interpolate", ["linear"], ["heatmap-density"], 0, "rgba(0,0,0,0)", 0.3, "#86c8c8", 0.6, "#b7791f", 1, "#c0392b"] },
          });
          m.addLayer({
            id: "clusters", type: "circle", source: "reports", filter: ["has", "point_count"],
            paint: { "circle-color": "#357575", "circle-opacity": 0.85, "circle-stroke-color": "#fff", "circle-stroke-width": 2, "circle-radius": ["step", ["get", "point_count"], 14, 5, 20, 15, 28] },
          });
          m.addLayer({
            id: "points", type: "circle", source: "reports", filter: ["!", ["has", "point_count"]],
            paint: { "circle-color": ["get", "color"], "circle-radius": 7, "circle-stroke-color": ["case", ["get", "seen"], "#1c3d3d", "#ffffff"], "circle-stroke-width": 2 },
          });
          m.addLayer({
            id: "grid3d", type: "fill-extrusion", source: "grid", layout: { visibility: "none" },
            paint: {
              "fill-extrusion-color": ["interpolate", ["linear"], ["get", "count"], 1, "#bee1e1", 3, "#86c8c8", 6, "#357575", 10, "#1c3d3d"],
              "fill-extrusion-height": ["*", ["get", "count"], 60], "fill-extrusion-opacity": 0.85,
            },
          });
          m.addLayer({ id: "hot-centre", type: "circle", source: "hotspots", filter: ["==", ["geometry-type"], "Point"], paint: { "circle-color": ["get", "color"], "circle-radius": 9, "circle-stroke-color": "#fff", "circle-stroke-width": 3 } });

          m.on("click", "clusters", async (e) => {
            const f = e.features[0];
            const zoom = await m.getSource("reports").getClusterExpansionZoom(f.properties.cluster_id);
            m.easeTo({ center: f.geometry.coordinates, zoom });
          });
          m.on("click", "points", (e) => {
            const p = e.features[0].properties;
            const lines = [[p.category_name, true], [new Date(p.submitted_at).toLocaleString("en-US", { timeZone: "Asia/Dhaka", dateStyle: "medium", timeStyle: "short" })]];
            if (p.results_visible) lines.push([`${p.status_label} · credibility ${p.credibility_display}`]);
            else lines.push(["Vote to see its status"]);
            if (p.is_seed) lines.push(["DEMO data"]);
            new maplibregl.Popup({ closeButton: true }).setLngLat(e.features[0].geometry.coordinates)
              .setDOMContent(popupNode(lines, { label: "Open report", onClick: () => onOpenReport?.(p.id) })).addTo(m);
          });
          m.on("click", "hot-centre", (e) => {
            const p = e.features[0].properties;
            new maplibregl.Popup().setLngLat(e.features[0].geometry.coordinates)
              .setDOMContent(popupNode([[`Hotspot: ${p.category}`, true], [`Score ${p.score} (${p.band})`], [`${p.n_reports} reports from ${p.n_users} people`]])).addTo(m);
          });
          ["clusters", "points", "hot-centre"].forEach((id) => {
            m.on("mouseenter", id, () => (m.getCanvas().style.cursor = "pointer"));
            m.on("mouseleave", id, () => (m.getCanvas().style.cursor = ""));
          });
          loaded.current = true;
          onReady?.();
          m.fire("cp:data");
        });
        m.on("error", (e) => console.warn("map:", e?.error?.message || e));
        map.current = m;
      } catch (err) {
        setFailed(err?.message || "WebGL is not available");
      }
    })();
    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
      loaded.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Data and display updates.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const apply = () => {
      if (!loaded.current) return;
      const feats = (points?.features || [])
        .filter((f) => !until || new Date(f.properties.submitted_at).getTime() <= until)
        .map((f) => ({ ...f, properties: { ...f.properties, color: CATEGORY_COLOR[f.properties.category] || "#357575", seen: f.properties.results_visible } }));
      const fc = { type: "FeatureCollection", features: feats };
      m.getSource("reports")?.setData(fc);
      m.getSource("reports-flat")?.setData(fc);
      m.getSource("grid")?.setData(grid || { type: "FeatureCollection", features: [] });
      const hs = [];
      (hotspots || []).forEach((h) => {
        const props = { category: h.category.name_en, score: h.score, band: h.band, n_reports: h.n_reports, n_users: h.n_users, color: BAND_COLOR[h.band] };
        if (h.hull) hs.push({ type: "Feature", geometry: h.hull, properties: props });
        hs.push({ type: "Feature", geometry: { type: "Point", coordinates: [h.lon, h.lat] }, properties: props });
      });
      m.getSource("hotspots")?.setData({ type: "FeatureCollection", features: hs });
      if (!fitted.current && feats.length) {
        // First data: frame the reports instead of a fixed view.
        const b = new maplibregl.LngLatBounds();
        feats.forEach((f) => b.extend(f.geometry.coordinates));
        m.fitBounds(b, { padding: 50, maxZoom: 14, duration: 0 });
        fitted.current = true;
      }
      const is3d = mode === "3d";
      m.setLayoutProperty("grid3d", "visibility", is3d ? "visible" : "none");
      m.setLayoutProperty("heat", "visibility", !is3d && layer === "heat" ? "visible" : "none");
      ["clusters", "points"].forEach((id) => m.setLayoutProperty(id, "visibility", !is3d && layer === "markers" ? "visible" : "none"));
      const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      const cam = { pitch: is3d ? 55 : 0, bearing: is3d ? -20 : 0 };
      reduce ? m.jumpTo(cam) : m.easeTo({ ...cam, duration: 700 });
    };
    if (loaded.current) apply();
    else m.once("cp:data", apply);
  }, [points, grid, hotspots, mode, layer, until]);

  const fitTo = (lat, lon, zoom = 14) => map.current?.flyTo({ center: [lon, lat], zoom });
  useEffect(() => {
    if (focus) fitTo(focus.lat, focus.lon, focus.zoom || 15); // button alternative to dragging the map (B15)
  }, [focus]);

  if (failed)
    return (
      <div className="grid h-full place-items-center rounded-lg bg-soft/50 p-6 text-center">
        <p>
          The map needs WebGL2, which this browser does not offer ({failed}). Everything else on this page still works.
        </p>
      </div>
    );
  return (
    <div className="relative h-full">
      <div ref={box} className="h-full w-full overflow-hidden rounded-lg" role="region" aria-label="Map of reports" />
      {tiles === false && <p className="absolute bottom-2 left-2 rounded bg-white/90 px-2 py-1 text-xs shadow-1">Base map not installed (see docs/MAPS.md). Reports are still shown.</p>}
      <div className="absolute left-2 top-2 flex flex-col gap-1">
        <button className="rounded-md bg-white/95 px-2 py-1 text-xs font-semibold shadow-1" onClick={() => fitTo(23.8188, 90.438, 13.5)}>
          Bashundhara
        </button>
        <button className="rounded-md bg-white/95 px-2 py-1 text-xs font-semibold shadow-1" onClick={() => fitTo(23.62, 90.5, 13.5)}>
          Narayanganj
        </button>
      </div>
    </div>
  );
}
