import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { Protocol } from "pmtiles";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { COLUMN_STEPS, HEAT_STOPS } from "./MapControls.jsx";

const GG = { ink: "#1c3d3d", primary: "#357575", line: "#86c8c8", soft: "#bee1e1", mid: "#4fa3a3", amber: "#b7791f" };
const EMPTY = { type: "FeatureCollection", features: [] };
const CAMERA_3D = { pitch: 50, bearing: -20 };
let protocolAdded = false;

async function tilesAvailable() {
  try {
    const r = await fetch("/tiles/pilot.pmtiles", { method: "HEAD" });
    return r.ok && !(r.headers.get("content-type") || "").includes("text/html");
  } catch {
    return false;
  }
}

// Base map palettes. Dark mode gets a night map in the Green Guard family, so the dashboard never flashes white.
const PALETTE = {
  light: { bg: "#eef5f5", earth: "#f3f8f8", landuse: "#e4efe9", water: "#cfe3ea", buildings: "#e3ecec", highway: "#cfe0e0", major: "#dbe8e8", minor: "#ffffff", label: "#1c3d3d", halo: "#ffffff", roadLabel: "#4a6b6b" },
  dark: { bg: "#161c23", earth: "#1a2129", landuse: "#1c2826", water: "#1a2a37", buildings: "#222b34", highway: "#3b4856", major: "#323e4a", minor: "#2a343f", label: "#d5dde3", halo: "#151b22", roadLabel: "#a0adb8" },
};

function baseStyle(withTiles) {
  const c = PALETTE[document.documentElement.dataset.theme === "dark" ? "dark" : "light"];
  const layers = [{ id: "bg", type: "background", paint: { "background-color": c.bg } }];
  const sources = {};
  if (withTiles) {
    sources.protomaps = { type: "vector", url: "pmtiles:///tiles/pilot.pmtiles", attribution: "© OpenStreetMap contributors" };
    layers.push(
      { id: "earth", type: "fill", source: "protomaps", "source-layer": "earth", paint: { "fill-color": c.earth } },
      { id: "landuse", type: "fill", source: "protomaps", "source-layer": "landuse", paint: { "fill-color": c.landuse, "fill-opacity": 0.7 } },
      { id: "water", type: "fill", source: "protomaps", "source-layer": "water", paint: { "fill-color": c.water } },
      { id: "buildings", type: "fill", source: "protomaps", "source-layer": "buildings", minzoom: 14, paint: { "fill-color": c.buildings } },
      {
        id: "roads", type: "line", source: "protomaps", "source-layer": "roads",
        paint: { "line-color": ["match", ["get", "kind"], "highway", c.highway, "major_road", c.major, c.minor], "line-width": ["interpolate", ["linear"], ["zoom"], 10, 0.6, 14, 2.5, 17, 8] },
      },
      {
        id: "place-labels", type: "symbol", source: "protomaps", "source-layer": "places",
        filter: ["in", ["get", "kind"], ["literal", ["locality", "macrohood", "neighbourhood"]]],
        layout: {
          "text-field": ["coalesce", ["get", "name:en"], ["get", "name"]],
          "text-font": ["Noto Sans Medium"],
          "text-size": ["interpolate", ["linear"], ["zoom"], 10, 11, 15, 15],
          "text-max-width": 8,
        },
        paint: { "text-color": c.label, "text-halo-color": c.halo, "text-halo-width": 1.5 },
      },
            {
        id: "road-labels", type: "symbol", source: "protomaps", "source-layer": "roads", minzoom: 13,
        filter: ["all", ["has", "name:en"], ["in", ["get", "kind"], ["literal", ["highway", "major_road", "minor_road"]]]],
        layout: {
          "symbol-placement": "line",
          "text-field": ["get", "name:en"],
          "text-font": ["Noto Sans Regular"],
          "text-size": ["interpolate", ["linear"], ["zoom"], 13, 10, 17, 13],
        },
        paint: { "text-color": c.roadLabel, "text-halo-color": c.halo, "text-halo-width": 1.5 },
      },
    );
  }
  return { version: 8, glyphs: `${window.location.origin}/map-fonts/{fontstack}/{range}.pbf`, sources, layers };
}

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text; // textContent only: data never becomes HTML
  return n;
}

const reduceMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

const heatColor = ["interpolate", ["linear"], ["heatmap-density"], ...HEAT_STOPS.flat()];

// Busy places, counted on the reports already loaded (no extra request), in ~330 m squares.
//  - `cells`: each square's own count. The busiest square sets how strongly the heat glows, so red always means
//    "among the busiest places right now" in this view.
//  - `spots`: each square plus its 8 neighbours (~1 km across, about one glow), busiest first. The top few that
//    don't overlap on screen get a number badge (drawOverlays), so a badge counts what its glow shows.
const CELL = 0.003;
function busyPlaces(feats) {
  const cells = new Map();
  for (const f of feats) {
    const [lon, lat] = f.geometry.coordinates;
    const x = Math.floor(lon / CELL);
    const y = Math.floor(lat / CELL);
    const k = `${x}:${y}`;
    const c = cells.get(k) || { x, y, n: 0, lon: 0, lat: 0 };
    c.n += 1;
    c.lon += lon;
    c.lat += lat;
    cells.set(k, c);
  }
  const spots = [...cells.values()]
    .map((c) => {
      let n = 0, lon = 0, lat = 0;
      for (let dx = -1; dx <= 1; dx++)
        for (let dy = -1; dy <= 1; dy++) {
          const o = cells.get(`${c.x + dx}:${c.y + dy}`);
          if (o) (n += o.n), (lon += o.lon), (lat += o.lat);
        }
      return { x: c.x, y: c.y, n, lon: lon / n, lat: lat / n };
    })
    .sort((a, b) => b.n - a.n);
  return { top: Math.max(1, ...[...cells.values()].map((c) => c.n)), spots: spots.filter((sp) => sp.n >= BADGE_MIN) };
}
const BADGES = 3; // at most this many number badges
const BADGE_MIN = 3; // a place needs at least this many reports to get one

const BADGE_GAP = 56; // px between badge centres
// Hotspot labels that would overlap on screen share one label ("3 hotspots, top score 10"), so no score is lost.
function hotspotLabels(list, project) {
  const groups = [];
  for (const h of [...list].sort((a, b) => b.score - a.score)) {
    const p = project([h.lon, h.lat]);
    const g = groups.find((x) => Math.abs(x.p.x - p.x) < 150 && Math.abs(x.p.y - p.y) < 34);
    if (g) g.n += 1;
    else groups.push({ lat: h.lat, lon: h.lon, score: h.score, n: 1, p });
  }
  return groups.map((g) => ({ ...g, text: g.n > 1 ? `${g.n} hotspots, top score ${Math.round(g.score)}` : `Hotspot, score ${Math.round(g.score)}` }));
}

const MapView = forwardRef(function MapView({ points, grid, hotspots, mode, layers, weightSeverity, until, focus, onOpenReport, onFallback, gridLabel }, ref) {
  const box = useRef(null);
  const map = useRef(null);
  const loaded = useRef(false);
  const fitted = useRef(false);
  const markers = useRef({ clusters: new Map(), hotspots: [], badges: [] });
  const [failed, setFailed] = useState(null);
  const [tiles, setTiles] = useState(null);
  const [tip, setTip] = useState(null);
  // True once the map and its layers exist. The map is created after an async tile check, so data (often already
  // in the screen cache) can arrive first; the effects below re-run when this flips instead of dropping that data.
  const [ready, setReady] = useState(false);
  const latest = useRef({});
  const overlay = useRef(null); // what drawOverlays shows: busy spots, hotspots, and which of them are on
  latest.current = { points, mode, layers, onOpenReport, gridLabel };

  useImperativeHandle(ref, () => ({
    zoomIn: () => map.current?.zoomIn(),
    zoomOut: () => map.current?.zoomOut(),
    rotate: (deg) => map.current?.rotateTo((map.current.getBearing() || 0) + deg, { duration: reduceMotion() ? 0 : 300 }),
    tilt: (deg) => map.current?.easeTo({ pitch: Math.max(0, Math.min(70, (map.current.getPitch() || 0) + deg)), duration: reduceMotion() ? 0 : 300 }),
    reset: () => map.current && (reduceMotion() ? map.current.jumpTo(CAMERA_3D) : map.current.easeTo({ ...CAMERA_3D, duration: 700 })),
    fitAll: () => fitTo(latest.current.points?.features || [], true),
    flyTo: (lat, lon, zoom = 15) => (reduceMotion() ? map.current?.jumpTo({ center: [lon, lat], zoom }) : map.current?.flyTo({ center: [lon, lat], zoom })),
  }));

  function fitTo(feats, animate) {
    const m = map.current;
    if (!m || !feats.length) return;
    const b = new maplibregl.LngLatBounds();
    feats.forEach((f) => b.extend(f.geometry.coordinates));
    m.fitBounds(b, { padding: 60, maxZoom: 14.5, duration: animate && !reduceMotion() ? 500 : 0 });
  }

 
  // Badges and hotspot labels are spaced by screen distance, so they're redrawn after every zoom.
  function drawOverlays() {
    const m = map.current;
    const o = overlay.current;
    if (!m || !o) return;
    markers.current.badges.forEach((mk) => mk.remove());
    markers.current.badges = [];
    markers.current.hotspots.forEach((mk) => mk.remove());
    markers.current.hotspots = [];
    if (o.badges) {
      const picked = [];
      for (const sp of o.spots) {
        if (picked.length >= BADGES) break;
        const p = m.project([sp.lon, sp.lat]);
        if (picked.every((q) => Math.hypot(q.p.x - p.x, q.p.y - p.y) > BADGE_GAP)) picked.push({ ...sp, p });
      }
      picked.forEach((c, i) => {
        const node = el("button", i === 0 ? "cp-heat-badge cp-heat-badge-top" : "cp-heat-badge", String(c.n));
        node.type = "button";
        node.style.zIndex = "3"; // above hotspot labels
        node.setAttribute("aria-label", `${c.n} credible reports around here. Zoom in.`);
        node.addEventListener("click", (e) => {
          e.stopPropagation();
          const z = Math.max(m.getZoom() + 2, 15);
          if (reduceMotion()) m.jumpTo({ center: [c.lon, c.lat], zoom: z });
          else m.flyTo({ center: [c.lon, c.lat], zoom: z });
        });
        markers.current.badges.push(new maplibregl.Marker({ element: node }).setLngLat([c.lon, c.lat]).addTo(m));
      });
    }
    if (o.labels)
      for (const g of hotspotLabels(o.hotspots, (ll) => m.project(ll))) {
        const node = el("span", "cp-hotspot-label", g.text);
        node.style.zIndex = "2";
        // Lifted well above the spot, so a number badge on the same place stays readable.
        const mk = new maplibregl.Marker({ element: node, anchor: "bottom", offset: [0, -26] }).setLngLat([g.lon, g.lat]).addTo(m);
        // A label, not a control: MapLibre makes markers focusable buttons named "Map marker" by default.
        node.removeAttribute("tabindex");
        node.setAttribute("role", "note");
        node.setAttribute("aria-label", g.text);
        markers.current.hotspots.push(mk);
      }
  }

  function drawClusters() {
    const m = map.current;
    const store = markers.current.clusters;
    const show = latest.current.mode !== "3d" && latest.current.layers.clusters;
    const seen = new Set();
    if (show && m.getSource("reports")) {
      for (const f of m.querySourceFeatures("reports")) {
        if (!f.properties.cluster) continue;
        const id = f.properties.cluster_id;
        if (seen.has(id)) continue;
        seen.add(id);
        if (!store.has(id)) {
          const node = el("button", "cp-cluster", String(f.properties.point_count));
          node.setAttribute("aria-label", `${f.properties.point_count} reports. Zoom in.`);
          node.onclick = async () => {
            const zoom = await m.getSource("reports").getClusterExpansionZoom(id);
            m.easeTo({ center: f.geometry.coordinates, zoom, duration: reduceMotion() ? 0 : 400 });
          };
          store.set(id, new maplibregl.Marker({ element: node }).setLngLat(f.geometry.coordinates).addTo(m));
        }
      }
    }
    for (const [id, mk] of store) {
      if (!seen.has(id)) {
        mk.remove();
        store.delete(id);
      }
    }
  }

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
        const m = new maplibregl.Map({
          container: box.current, style: baseStyle(has), center: [90.47, 23.72], zoom: 10.5,
          attributionControl: false, fadeDuration: reduceMotion() ? 0 : 300, dragRotate: true,
        });
        m.on("load", () => {
          m.addSource("reports", { type: "geojson", data: EMPTY, cluster: true, clusterRadius: 48, clusterMaxZoom: 15 });
          m.addSource("reports-flat", { type: "geojson", data: EMPTY });
          m.addSource("grid", { type: "geojson", data: EMPTY });
          m.addSource("hotspots", { type: "geojson", data: EMPTY });
          m.addLayer({
            id: "heat", type: "heatmap", source: "reports-flat",
            paint: {
              "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 10, 40, 13, 58, 16, 84],
              "heatmap-intensity": 1, "heatmap-opacity": 0.88, "heatmap-weight": 1,
              "heatmap-color": heatColor,
            },
          });
          m.addLayer({ id: "hot-fill", type: "fill", source: "hotspots", paint: { "fill-color": GG.amber, "fill-opacity": 0.06 } });
          m.addLayer({ id: "hot-line", type: "line", source: "hotspots", paint: { "line-color": GG.amber, "line-width": 2.5, "line-dasharray": [2, 1.5] } });
          m.addLayer({
            id: "points", type: "circle", source: "reports", filter: ["!", ["has", "point_count"]],
            paint: {
              "circle-color": ["case", ["get", "approximate"], "rgba(53,117,117,0.35)", ["get", "results_visible"], GG.ink, GG.mid],
              "circle-radius": ["case", ["get", "approximate"], 6, 8], "circle-stroke-color": "#ffffff", "circle-stroke-width": 2,
            },
          });
          m.addSource("reports-plain", { type: "geojson", data: EMPTY });
          m.addLayer({
            id: "points-plain", type: "circle", source: "reports-plain", layout: { visibility: "none" },
            paint: {
              "circle-color": ["case", ["get", "approximate"], "rgba(53,117,117,0.35)", ["get", "results_visible"], GG.ink, GG.mid],
              "circle-radius": ["case", ["get", "approximate"], 6, 8], "circle-stroke-color": "#ffffff", "circle-stroke-width": 2,
            },
          });
          m.addLayer({
            id: "grid3d", type: "fill-extrusion", source: "grid", layout: { visibility: "none" },
            paint: {
              "fill-extrusion-color": ["step", ["get", "count"], COLUMN_STEPS[0][1], 3, COLUMN_STEPS[1][1], 5, COLUMN_STEPS[2][1], 8, COLUMN_STEPS[3][1], 11, COLUMN_STEPS[4][1]],
              "fill-extrusion-height": ["*", ["get", "count"], 70], "fill-extrusion-opacity": 0.92,
            },
          });

          const openPoint = (e) => {
            const p = e.features[0].properties;
            if (p.approximate || !p.id || p.id === "null") return; // snapped points have no id (X1)
            latest.current.onOpenReport?.(p.id);
          };
          m.on("click", "points", openPoint);
          m.on("click", "points-plain", openPoint);
          const showTip = (e) => {
            const f = e.features[0];
            setTip({ x: e.point.x, y: e.point.y, count: f.properties.count });
          };
          m.on("mousemove", "grid3d", showTip);
          m.on("click", "grid3d", showTip);
          m.on("mouseleave", "grid3d", () => setTip(null));
          ["points", "points-plain", "grid3d"].forEach((id) => {
            m.on("mouseenter", id, () => (m.getCanvas().style.cursor = "pointer"));
            m.on("mouseleave", id, () => (m.getCanvas().style.cursor = ""));
          });
          m.on("render", () => loaded.current && drawClusters());
          m.on("zoomend", () => loaded.current && drawOverlays());
          loaded.current = true;
          m.fire("cp:data");
          if (!cancelled) setReady(true);
        });
        m.on("webglcontextlost", () => onFallback?.());
        m.on("error", (e) => console.warn("map:", e?.error?.message || e));
        map.current = m;
      } catch (err) {
        setFailed(err?.message || "WebGL is not available");
        onFallback?.();
      }
    })();
    return () => {
      cancelled = true;
      markers.current.clusters.forEach((mk) => mk.remove());
      markers.current.clusters.clear();
      markers.current.hotspots.forEach((mk) => mk.remove());
      markers.current.badges.forEach((mk) => mk.remove());
      map.current?.remove();
      map.current = null;
      loaded.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Data and display updates.
  useEffect(() => {
    const m = map.current;
    if (!m) return undefined;
    const apply = () => {
      if (!loaded.current) return;
      const feats = (points?.features || []).filter((f) => !until || new Date(f.properties.submitted_at).getTime() <= until);
      const fc = { type: "FeatureCollection", features: feats };
      m.getSource("reports")?.setData(fc);
      m.getSource("reports-flat")?.setData(fc);
      m.getSource("grid")?.setData(grid || EMPTY);
      const hulls = (hotspots || []).filter((h) => h.hull).map((h) => ({ type: "Feature", geometry: h.hull, properties: { score: h.score } }));
      m.getSource("hotspots")?.setData({ type: "FeatureCollection", features: hulls });
      if (!fitted.current && feats.length) {
        fitTo(feats, false);
        fitted.current = true;
      }
      const is3d = mode === "3d";
      const vis = (on) => (on ? "visible" : "none");
      m.setLayoutProperty("grid3d", "visibility", vis(is3d));
      m.setLayoutProperty("heat", "visibility", vis(!is3d && layers.heat));
      m.setLayoutProperty("points", "visibility", vis(!is3d && layers.clusters)); // single points between clusters
      m.setLayoutProperty("hot-fill", "visibility", vis(!is3d && layers.hotspots));
      m.setLayoutProperty("hot-line", "visibility", vis(!is3d && layers.hotspots));
      m.setPaintProperty("heat", "heatmap-weight", weightSeverity ? ["get", "severity"] : 1);
      // Markers without clusters: every report on its own, from an un-clustered source.
      ensureFlatPoints(m, !is3d && layers.markers && !layers.clusters, fc);
      // Heat strength follows the busiest square, so the hottest place reaches red whatever the period or filter.
      const { top, spots } = busyPlaces(feats);
      const base = Math.min(1.4, Math.max(0.2, 2.2 / top));
      m.setPaintProperty("heat", "heatmap-intensity", ["interpolate", ["linear"], ["zoom"], 10, base, 16, base * 1.8]);
      // Number badges (heat view only; with clusters on, the cluster circles already count) and hotspot labels.
      overlay.current = { spots, hotspots: hotspots || [], badges: !is3d && layers.heat && !layers.clusters, labels: !is3d && layers.hotspots };
      drawOverlays();
      const cam = is3d ? CAMERA_3D : { pitch: 0, bearing: 0 };
      if (reduceMotion()) m.jumpTo(cam);
      else m.easeTo({ ...cam, duration: 700 });
      drawClusters();
    };
    if (loaded.current) apply();
    else m.once("cp:data", apply);
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, grid, hotspots, mode, layers, weightSeverity, until, ready]);

  useEffect(() => {
    if (!focus || !map.current) return;
    const go = () => (reduceMotion() ? map.current.jumpTo({ center: [focus.lon, focus.lat], zoom: focus.zoom || 15 }) : map.current.flyTo({ center: [focus.lon, focus.lat], zoom: focus.zoom || 15 }));
    if (loaded.current) go();
    else map.current.once("cp:data", go);
  }, [focus, ready]);

  if (failed) return null;
  return (
    <div className="relative size-full">
      <div ref={box} className="size-full" role="region" aria-label="Map of reports" />
      {tip && mode === "3d" && (
        <div className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-[120%] rounded-xl bg-inverse px-4 py-3 text-on-inverse shadow-3" style={{ left: tip.x, top: tip.y }}>
          <p className="num text-[17px] font-extrabold">{tip.count} credible reports</p>
          <p className="text-sm text-on-inverse/85">{gridLabel || "One 250 m square"}</p>
        </div>
      )}
      {tiles === false && <p className="absolute left-1/2 top-3 -translate-x-1/2 rounded-full bg-surface/95 px-3 py-1 text-xs font-semibold shadow-1">Base map not installed (docs/MAPS.md)</p>}
      <p className="absolute bottom-3 right-3 rounded-md bg-surface/90 px-2 py-0.5 text-xs text-primary">© OpenStreetMap contributors</p>
    </div>
  );
});

// "Markers" without "Clusters": every report on its own, from an un-clustered source.
function ensureFlatPoints(m, on, fc) {
  m.getSource("reports-plain")?.setData(on ? fc : EMPTY);
  m.setLayoutProperty("points-plain", "visibility", on ? "visible" : "none");
}

export default MapView;
