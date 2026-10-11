// Live notifications over SSE, read with fetch() so the Authorization header is sent (open parameter B11).
import { getToken, refresh } from "./api.js";

export function openStream(onEvent) {
  let stopped = false;
  let controller = null;
  let delay = 2000;

  async function run() {
    while (!stopped) {
      controller = new AbortController();
      try {
        if (!getToken()) await refresh();
        const res = await fetch("/api/stream", { headers: { Authorization: `Bearer ${getToken()}` }, signal: controller.signal });
        if (res.status === 401) {
          await refresh();
          continue;
        }
        if (!res.ok || !res.body) throw new Error("stream failed");
        delay = 2000;
        const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
        let buf = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += value;
          let i;
          while ((i = buf.indexOf("\n\n")) >= 0) {
            const chunk = buf.slice(0, i);
            buf = buf.slice(i + 2);
            const ev = /^event: (.+)$/m.exec(chunk)?.[1];
            const data = /^data: (.+)$/m.exec(chunk)?.[1];
            if (ev === "unavailable") onEvent({ type: "unavailable" });
            if (ev === "notification" && data) onEvent({ type: "notification", data: JSON.parse(data) });
          }
        }
      } catch (e) {
        if (stopped || e.name === "AbortError") return;
      }
      await new Promise((r) => setTimeout(r, delay));
      delay = Math.min(delay * 2, 60000);
    }
  }
  run();
  return () => {
    stopped = true;
    controller?.abort();
  };
}
