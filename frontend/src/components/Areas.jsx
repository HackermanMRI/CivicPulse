// "Your areas": wards only, never a home location (sign-up step 5 and Profile → My areas).
import { useState } from "react";
import { Icon } from "./icons.jsx";
import { Select, cx } from "./ui.jsx";

const KINDS = [
  ["home", "Home"],
  ["work", "Work"],
  ["other", "Other"],
];
export const kindLabel = (k) => (KINDS.find(([v]) => v === k) || [k, k])[1];

export function AreaCard({ kind, name, onRemove, removable = true }) {
  return (
    <div className="flex min-h-[68px] items-center gap-3 rounded-2xl border border-line bg-white px-4">
      <span className="rounded-full bg-soft px-3 py-1 text-[13px] font-bold">{kindLabel(kind)}</span>
      <span className="min-w-0 flex-1 truncate text-[17px] font-semibold">{name}</span>
      {removable && (
        <button type="button" onClick={onRemove} className="-mr-2 grid size-11 place-items-center rounded-full hover:bg-soft/60" aria-label={`Remove ${name}`}>
          <Icon name="x" className="size-5" strokeWidth={2.2} />
        </button>
      )}
    </div>
  );
}

// `areas`: [{ key, kind, ward_id (number | null), name }]. `onAdd(kind, ward_id|null, name)`.
export function AreaEditor({ areas, wards, onAdd, onRemove, busy }) {
  const [kind, setKind] = useState(areas.some((a) => a.kind === "home") ? (areas.some((a) => a.kind === "work") ? "other" : "work") : "home");
  const taken = new Set(areas.map((a) => String(a.ward_id ?? "none")));
  return (
    <div>
      <div className="space-y-3">
        {areas.map((a) => (
          <AreaCard key={a.key} kind={a.kind} name={a.name} onRemove={() => onRemove(a)} removable={areas.length > 1} />
        ))}
      </div>
      <div className="mt-6 border-t border-line pt-5">
        <p className="font-bold">{areas.length ? "Add another area" : "Add an area"}</p>
        <div className="mt-3 flex gap-2" role="radiogroup" aria-label="Kind of area">
          {KINDS.map(([v, label]) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={kind === v}
              onClick={() => setKind(v)}
              className={cx("min-h-12 rounded-full border-[1.5px] px-5 text-base font-bold", kind === v ? "border-primary bg-primary text-white" : "border-ink/70 bg-white text-ink")}
            >
              {label}
            </button>
          ))}
        </div>
        <label htmlFor="ward-pick" className="mt-4 block text-[15px] font-bold">
          Ward
        </label>
        <Select
          id="ward-pick"
          className="mt-2"
          value=""
          disabled={busy}
          onChange={(e) => {
            const v = e.target.value;
            if (!v) return;
            const w = wards.find((x) => String(x.id) === v);
            onAdd(kind, v === "none" ? null : Number(v), v === "none" ? "Outside the pilot area" : w?.name_en || "");
          }}
        >
          <option value="">Choose from the pilot wards</option>
          {wards
            .filter((w) => !taken.has(String(w.id)))
            .map((w) => (
              <option key={w.id} value={w.id}>
                {w.name_en} · {w.name_bn}
                {w.is_demo ? " (DEMO)" : ""}
              </option>
            ))}
          {!taken.has("none") && <option value="none">Outside the pilot area</option>}
        </Select>
        <p className="mt-3 text-[15px] leading-relaxed text-ink/85">
          Not in Narayanganj or Bashundhara? Choose <b>Outside the pilot area</b>. You can still use the app, but your feed will be empty.
        </p>
      </div>
    </div>
  );
}
