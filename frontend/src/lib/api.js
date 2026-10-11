// API client. The access token lives in memory only; the refresh token is an HttpOnly cookie the page cannot
// read (spec §8). Every request carries the random device id (only its hash is stored on the server, C11).

let accessToken = null;
let refreshing = null;
const listeners = new Set();

export class ApiError extends Error {
  constructor(status, message, data) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

export function deviceId() {
  try {
    let id = localStorage.getItem("cp_device");
    if (!id) {
      const bytes = crypto.getRandomValues(new Uint8Array(24));
      id = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
      localStorage.setItem("cp_device", id);
    }
    return id;
  } catch {
    return "nostorage-" + "0".repeat(32); // private mode: the server will treat it as one device
  }
}

export function setToken(token) {
  accessToken = token;
  listeners.forEach((fn) => fn(token));
}
export const getToken = () => accessToken;
export function onToken(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function message(data, status) {
  if (data && typeof data.detail === "string") return data.detail;
  if (data && Array.isArray(data.detail)) return data.detail.map((d) => d.msg.replace(/^Value error, /, "")).join(" ");
  if (status === 0) return "You are offline. Check your connection.";
  return "Something went wrong. Please try again.";
}

export async function refresh() {
  if (!refreshing) {
    refreshing = fetch("/api/auth/refresh", { method: "POST", credentials: "same-origin" })
      .then(async (r) => {
        if (!r.ok) throw new ApiError(r.status, "Session ended");
        const data = await r.json();
        setToken(data.access_token);
        return data;
      })
      .finally(() => {
        refreshing = null;
      });
  }
  return refreshing;
}

export async function api(path, { method = "GET", body, form, query, retry = true, signal } = {}) {
  const url = new URL(path, location.origin);
  if (query) Object.entries(query).forEach(([k, v]) => v !== undefined && v !== null && v !== "" && url.searchParams.set(k, v));
  const headers = { "X-Device-Id": deviceId() };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  let payload;
  if (form) {
    payload = new FormData();
    Object.entries(form).forEach(([k, v]) => {
      if (v === undefined || v === null) return;
      if (v instanceof Blob) payload.append(k, v, `${k}.jpg`);
      else payload.append(k, String(v));
    });
  } else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(url, { method, headers, body: payload, credentials: "same-origin", signal });
  } catch (e) {
    if (e.name === "AbortError") throw e;
    throw new ApiError(0, message(null, 0));
  }
  if (res.status === 401 && retry && !path.startsWith("/api/auth/")) {
    try {
      await refresh();
      return api(path, { method, body, form, query, retry: false, signal });
    } catch {
      setToken(null);
    }
  }
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) throw new ApiError(res.status, message(data, res.status), data);
  return data;
}

// Photos are behind authorisation, so <img src> cannot load them directly; fetch them as blobs.
const photoCache = new Map();
export async function photoUrl(path) {
  if (!path) return null;
  if (photoCache.has(path)) return photoCache.get(path);
  const p = (async () => {
    const headers = { "X-Device-Id": deviceId() };
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    let r = await fetch(path, { headers, credentials: "same-origin" });
    if (r.status === 401) {
      await refresh();
      r = await fetch(path, { headers: { ...headers, Authorization: `Bearer ${accessToken}` }, credentials: "same-origin" });
    }
    if (!r.ok) throw new ApiError(r.status, "Photo not available");
    return URL.createObjectURL(await r.blob());
  })();
  photoCache.set(path, p);
  p.catch(() => photoCache.delete(path));
  return p;
}

export function clearPhotoCache() {
  photoCache.forEach((p) => p.then((u) => URL.revokeObjectURL(u)).catch(() => {}));
  photoCache.clear();
}
