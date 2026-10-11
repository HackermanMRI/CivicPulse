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
