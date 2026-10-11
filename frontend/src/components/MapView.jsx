// MapLibre map for the dashboard (B2–B4, boards: Dashboard 2D, Dashboard 3D). Loaded lazily, only on map routes (B14).
// Base map: a self-hosted Protomaps PMTiles extract at /tiles/pilot.pmtiles (B3). Without it the map still works on a
// plain background (R35). No glyph files are bundled, so every label (cluster counts, hotspot scores) is an HTML marker.
// Every map move has a button (B15): zoom, fit, rotate, tilt and reset; dragging is never required.
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { Protocol } from "pmtiles";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { COLUMN_STEPS } from "./MapControls.jsx";

const GG = { ink: "#1c3d3d", primary: "#357575", line: "#86c8c8", soft: "#bee1e1", mid: "#4fa3a3", amber: "#b7791f" };
const EMPTY = { type: "FeatureCollection", features: [] };
const CAMERA_3D = { pitch: 50, bearing: -20 };
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
  const layers = [{ id: "bg", type: "background", paint: { "background-color": "#eef5f5" } }];
  const sources = {};
  if (withTiles) {
    sources.protomaps = { type: "vector", url: "pmtiles:///tiles/pilot.pmtiles", attribution: "© OpenStreetMap contributors" };
    layers.push(
      { id: "earth", type: "fill", source: "protomaps", "source-layer": "earth", paint: { "fill-color": "#f3f8f8" } },
      { id: "landuse", type: "fill", source: "protomaps", "source-layer": "landuse", paint: { "fill-color": "#e4efe9", "fill-opacity": 0.7 } },
      { id: "water", type: "fill", source: "protomaps", "source-layer": "water", paint: { "fill-color": "#cfe3ea" } },
      { id: "buildings", type: "fill", source: "protomaps", "source-layer": "buildings", minzoom: 14, paint: { "fill-color": "#e3ecec" } },
      {
        id: "roads", type: "line", source: "protomaps", "source-layer": "roads",
        paint: { "line-color": ["match", ["get", "kind"], "highway", "#cfe0e0", "major_road", "#dbe8e8", "#ffffff"], "line-width": ["interpolate", ["linear"], ["zoom"], 10, 0.6, 14, 2.5, 17, 8] },
      },
    );
  }
  return { version: 8, sources, layers };
}

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text; // textContent only: data never becomes HTML
  return n;
}

const reduceMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

const MapView = forwardRef(function MapView({ points, grid, hotspots, mode, layers, weightSeverity, until, focus, onOpenReport, onFallback, gridLabel }, ref) {
  const box = useRef(null);
  const map = useRef(null);
  const loaded = useRef(false);
  const fitted = useRef(false);
  const markers = useRef({ clusters: new Map(), hotspots: [] });
  const [failed, setFailed] = useState(null);
  const [tiles, setTiles] = useState(null);
  const [tip, setTip] = useState(null);
  const latest = useRef({});
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

  // HTML cluster markers (counts need text; no glyphs are bundled).
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
              "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 10, 22, 15, 46],
              "heatmap-intensity": 1, "heatmap-opacity": 0.75, "heatmap-weight": 1,
              "heatmap-color": ["interpolate", ["linear"], ["heatmap-density"], 0, "rgba(28,61,61,0)", 0.25, "rgba(134,200,200,0.55)", 0.55, "rgba(53,117,117,0.75)", 1, "rgba(28,61,61,0.9)"],
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
          loaded.current = true;
          m.fire("cp:data");
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
      // Hotspot score labels.
      markers.current.hotspots.forEach((mk) => mk.remove());
      markers.current.hotspots = [];
      if (!is3d && layers.hotspots)
        for (const h of hotspots || []) {
          const node = el("span", "cp-hotspot-label", `Hotspot, score ${Math.round(h.score)}`);
          markers.current.hotspots.push(new maplibregl.Marker({ element: node, anchor: "bottom", offset: [0, -14] }).setLngLat([h.lon, h.lat]).addTo(m));
        }
      const cam = is3d ? CAMERA_3D : { pitch: 0, bearing: 0 };
      if (reduceMotion()) m.jumpTo(cam);
      else m.easeTo({ ...cam, duration: 700 });
      drawClusters();
    };
    if (loaded.current) apply();
    else m.once("cp:data", apply);
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, grid, hotspots, mode, layers, weightSeverity, until]);

  useEffect(() => {
    if (!focus || !map.current) return;
    const go = () => (reduceMotion() ? map.current.jumpTo({ center: [focus.lon, focus.lat], zoom: focus.zoom || 15 }) : map.current.flyTo({ center: [focus.lon, focus.lat], zoom: focus.zoom || 15 }));
    if (loaded.current) go();
    else map.current.once("cp:data", go);
  }, [focus]);

  if (failed) return null;
  return (
    <div className="relative size-full">
      <div ref={box} className="size-full" role="region" aria-label="Map of reports" />
      {tip && mode === "3d" && (
        <div className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-[120%] rounded-xl bg-ink px-4 py-3 text-white shadow-3" style={{ left: tip.x, top: tip.y }}>
          <p className="num text-[17px] font-extrabold">{tip.count} credible reports</p>
          <p className="text-sm text-white/85">{gridLabel || "One 250 m square"}</p>
        </div>
      )}
      {tiles === false && <p className="absolute left-1/2 top-3 -translate-x-1/2 rounded-full bg-white/95 px-3 py-1 text-xs font-semibold shadow-1">Base map not installed (docs/MAPS.md)</p>}
      <p className="absolute bottom-3 right-3 rounded-md bg-white/90 px-2 py-0.5 text-[11px] text-primary">© OpenStreetMap contributors</p>
    </div>
  );
});

// "Markers" without "Clusters": every report on its own, from an un-clustered source.
function ensureFlatPoints(m, on, fc) {
  m.getSource("reports-plain")?.setData(on ? fc : EMPTY);
  m.setLayoutProperty("points-plain", "visibility", on ? "visible" : "none");
}

export default MapView;
