import { useEffect, useState } from "react";

// Precise GPS from the browser (needs HTTPS or localhost). Resolves with {lat, lon, accuracy}.
export function getPosition({ timeout = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error("This browser cannot share location."));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude, accuracy: Math.round(p.coords.accuracy * 10) / 10 }),
      (e) =>
        reject(new Error(e.code === 1 ? "Location permission is off. Turn it on in the browser settings." : "Could not get your location. Try again outside.")),
      { enableHighAccuracy: true, timeout, maximumAge: 0 },
    );
  });
}

// ---------- distance from the viewer (UI v2 feed card) ----------
// One quiet position read per visit, cached for 5 minutes and shared by every card. It never triggers the
// permission prompt from the feed: it only runs when location was already granted (it is required at sign-up, C2).
// The server still decides the vote mode from the vote's own GPS fix; this is only a hint for the viewer.

let cached = null; // { lat, lon, at }
let pending = null;
const subscribers = new Set();
const FRESH_MS = 5 * 60 * 1000;

async function readQuietly() {
  try {
    const perm = await navigator.permissions?.query({ name: "geolocation" });
    if (perm && perm.state !== "granted") return null;
  } catch {
    return null; // Permissions API missing: don't risk a prompt here
  }
  return new Promise((resolve) => {
    navigator.geolocation?.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude, at: Date.now() }),
      () => resolve(null),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: FRESH_MS },
    );
  });
}

export function useMyPosition() {
  const [pos, setPos] = useState(cached);
  useEffect(() => {
    subscribers.add(setPos);
    if ((!cached || Date.now() - cached.at > FRESH_MS) && !pending) {
      pending = readQuietly()
        .then((p) => {
          if (p) {
            cached = p;
            subscribers.forEach((fn) => fn(p));
          }
        })
        .finally(() => {
          pending = null;
        });
    }
    return () => subscribers.delete(setPos);
  }, []);
  return pos;
}

// Great-circle distance in metres (haversine; plenty for a few kilometres).
export function distanceM(a, b) {
  const R = 6371000;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// "80 m", "350 m", "1.2 km", "12 km"
export function fmtDistance(m) {
  if (m < 1000) return `${Math.max(10, Math.round(m / 10) * 10)} m`;
  return m < 10000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m / 1000)} km`;
}
