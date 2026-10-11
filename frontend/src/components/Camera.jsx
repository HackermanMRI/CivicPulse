// In-app camera capture (K2, K3, U20). Photos come only from getUserMedia + canvas, never from the gallery.
// The capture token is requested when the camera opens; captured_at is fixed then, renewals keep it,
// a retake starts a new chain (limit from the server).
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../lib/api.js";
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

export function Camera({ purpose, reportId, onShot, onCancel }) {
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
    async (retakeOf) => {
      setError(null);
      setReady(false);
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("This browser cannot open the camera. Use HTTPS and a recent browser.");
        const tok = await api("/api/capture-tokens", { method: "POST", body: { purpose, report_id: reportId || null, retake_of: retakeOf || null } });
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
    start(null);
    return stop;
  }, [start, stop]);

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
        setPreview({ blob, url: URL.createObjectURL(blob) });
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
      <div className="relative aspect-[4/3] overflow-hidden rounded-lg bg-black">
        {preview ? (
          <img src={preview.url} alt="Your photo" className="size-full object-contain" />
        ) : (
          <video ref={video} playsInline muted className="size-full object-cover" aria-label="Camera preview" />
        )}
        {!ready && !preview && !error && <div className="absolute inset-0 grid place-items-center text-white">Opening camera…</div>}
      </div>
      {error && (
        <p role="alert" className="font-medium text-err">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {!preview && (
          <Button onClick={capture} disabled={!ready} size="lg" className="flex-1">
            Take photo
          </Button>
        )}
        {preview && (
          <>
            <Button kind="outline" onClick={retake} disabled={token && token.retakes_left <= 0}>
              Retake {token ? `(${token.retakes_left} left)` : ""}
            </Button>
            <Button
              className="flex-1"
              onClick={() => onShot({ blob: preview.blob, url: preview.url, token: token.token, expires_at: token.expires_at, purpose, reportId })}
            >
              Use this photo
            </Button>
          </>
        )}
        {onCancel && (
          <Button
            kind="ghost"
            onClick={() => {
              stop();
              onCancel();
            }}
          >
            Cancel
          </Button>
        )}
        {error && (
          <Button kind="outline" onClick={() => start(null)}>
            Try again
          </Button>
        )}
      </div>
    </div>
  );
}
