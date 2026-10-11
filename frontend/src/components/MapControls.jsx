// Map buttons and the 3D colour steps, kept apart from MapView so pages don't load MapLibre to draw them.
// Every map move has a button (B15): zoom, fit, rotate, tilt and reset; dragging is never required.
import { Icon } from "./icons.jsx";
import { Tip, cx } from "./ui.jsx";

export const COLUMN_STEPS = [
  [1, "#bee1e1"],
  [3, "#86c8c8"],
  [5, "#4fa3a3"],
  [8, "#357575"],
  [11, "#1c3d3d"],
];

export function MapControls({ mode, api: ctl }) {
  const btn = "grid size-11 place-items-center border-b border-line/70 text-ink last:border-b-0 hover:bg-soft/40";
  const items =
    mode === "3d"
      ? [
          ["plus", "Zoom in", () => ctl.current?.zoomIn()],
          ["minus", "Zoom out", () => ctl.current?.zoomOut()],
          ["rotateLeft", "Rotate left", () => ctl.current?.rotate(-30)],
          ["rotateRight", "Rotate right", () => ctl.current?.rotate(30)],
          ["chevronUp", "Tilt up", () => ctl.current?.tilt(10)],
          ["chevronDown", "Tilt down", () => ctl.current?.tilt(-10)],
        ]
      : [
          ["plus", "Zoom in", () => ctl.current?.zoomIn()],
          ["minus", "Zoom out", () => ctl.current?.zoomOut()],
          ["move", "Show all reports", () => ctl.current?.fitAll()],
        ];
  return (
    <div className="absolute right-4 top-4 z-10 flex flex-col overflow-hidden rounded-xl border border-line/80 bg-white shadow-1">
      {items.map(([icon, label, fn]) => (
        <Tip key={label} label={label}>
          <button className={btn} onClick={fn} aria-label={label}>
            <Icon name={icon} className="size-5" strokeWidth={2.2} />
          </button>
        </Tip>
      ))}
      {mode === "3d" && (
        <button className={cx(btn, "h-11 w-11 text-[13px] font-bold")} onClick={() => ctl.current?.reset()}>
          Reset
        </button>
      )}
    </div>
  );
}

