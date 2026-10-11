// In-app camera capture (K2, K3, U20). Photos come only from getUserMedia + canvas, never from the gallery.
// The capture token is requested when the camera opens; captured_at is fixed then, renewals keep it,
// a retake starts a new chain (`retakeOf`), at most `retakes_per_report` times (the server counts).
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../lib/api.js";
import { Icon } from "./icons.jsx";
import { Button } from "./ui.jsx";

export async function ensureFreshToken(shot) {
  // Renew a token that will expire within a minute, so a slow form does not lose the photo (U20).
  if (!shot) return null;
  if (new Date(shot.expires_at).getTime() - Date.now() > 60000) return shot.token;
  const r = await api("/api/capture-tokens", { method: "POST", body: { purpose: shot.purpose, report_id: shot.reportId || null, renew_token_id: shot.token } });
  shot.token = r.token;
  shot.expires_at = r.expires_at;
  return r.token;
}

// `confirm` = show the photo with "Use this photo" / "Retake" before handing it over (votes, price photos).
// Without it the photo is handed over at once (the report form shows its own preview and retake button).
export function Camera({ purpose, reportId, retakeOf = null, onShot, onCancel, confirm = true }) {
  const video = useRef(null);
  const streamRef = useRef(null);
  const [token, setToken] = useState(null);
  const [error, setError] = useState(null);
  const [preview, setPreview] = useState(null);
  const [ready, setReady] = useState(false);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const start = useCallback(
    async (chainOf) => {
      setError(null);
      setReady(false);
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("This browser cannot open the camera. Use HTTPS and a recent browser.");
        const tok = await api("/api/capture-tokens", { method: "POST", body: { purpose, report_id: reportId || null, retake_of: chainOf || null } });
        setToken(tok);
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 } }, audio: false });
        streamRef.current = stream;
        if (video.current) {
          video.current.srcObject = stream;
          await video.current.play().catch(() => {});
        }
        setReady(true);
      } catch (e) {
        setError(e.name === "NotAllowedError" ? "Camera permission is off. Turn it on in the browser settings." : e.message);
      }
    },
    [purpose, reportId],
  );

  useEffect(() => {
    start(retakeOf);
    return stop;
  }, [start, stop, retakeOf]);

  function hand(blob, url) {
    onShot({ blob, url, token: token.token, expires_at: token.expires_at, retakes_left: token.retakes_left, taken_at: new Date().toISOString(), purpose, reportId });
  }

  function capture() {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    const scale = Math.min(1, 2048 / Math.max(v.videoWidth, v.videoHeight));
    const c = document.createElement("canvas");
    c.width = Math.round(v.videoWidth * scale);
    c.height = Math.round(v.videoHeight * scale);
    c.getContext("2d").drawImage(v, 0, 0, c.width, c.height);
    c.toBlob(
      (blob) => {
        if (!blob) return setError("Could not take the photo. Try again.");
        stop();
        const url = URL.createObjectURL(blob);
        if (confirm) setPreview({ blob, url });
        else hand(blob, url);
      },
      "image/jpeg",
      0.88,
    );
  }

  function retake() {
    if (preview) URL.revokeObjectURL(preview.url);
    setPreview(null);
    start(token?.token);
  }

  return (
    <div className="space-y-3">
      <div className="relative aspect-[4/3] overflow-hidden rounded-2xl bg-ink">
        {preview ? (
          <img src={preview.url} alt="Your photo" className="size-full object-contain" />
        ) : (
          <video ref={video} playsInline muted className="size-full object-cover" aria-label="Camera preview" />
        )}
        {!ready && !preview && !error && (
          <div className="absolute inset-0 grid place-items-center text-white">
            <span className="flex items-center gap-2">
              <Icon name="loader" className="size-5 animate-spin" />
              Opening camera…
            </span>
          </div>
        )}
      </div>
      {error && (
        <p role="alert" className="flex items-start gap-1.5 font-medium text-err">
          <Icon name="alert" className="mt-0.5 size-5 shrink-0" />
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {!preview && !error && (
          <Button onClick={capture} disabled={!ready} size="lg" icon="camera" className="flex-1">
            Take photo
          </Button>
        )}
        {preview && (
          <>
            <Button kind="line" icon="refresh" onClick={retake} disabled={token && token.retakes_left <= 0}>
              Retake{token ? ` (${token.retakes_left} left)` : ""}
            </Button>
            <Button className="flex-1" onClick={() => hand(preview.blob, preview.url)}>
              Use this photo
            </Button>
          </>
        )}
        {error && (
          <Button kind="line" onClick={() => start(retakeOf)}>
            Try again
          </Button>
        )}
        {onCancel && (
          <Button
            kind="text"
            onClick={() => {
              stop();
              onCancel();
            }}
          >
            Cancel
          </Button>
        )}
      </div>
    </div>
  );
}
