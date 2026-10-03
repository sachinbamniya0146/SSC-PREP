"use client";

// Date field that works both ways (NEW — Oct 3 2026):
//   * type it:  05102026 -> 05/10/2026   (slashes are added automatically)
//   * or tap the calendar icon and pick it
// The value that goes out is always YYYY-MM-DD (what the server stores) or "".
import * as React from "react";

function isoToDisplay(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
}

function displayToIso(d: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(d);
  if (!m) return null;
  const day = +m[1], mon = +m[2], yr = +m[3];
  const dt = new Date(Date.UTC(yr, mon - 1, day));
  if (yr < 1990 || yr > 2100 || dt.getUTCFullYear() !== yr || dt.getUTCMonth() !== mon - 1 || dt.getUTCDate() !== day) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

export default function DateField({
  value,
  onChange,
  className = "",
  placeholder = "DD/MM/YYYY",
}: {
  value: string;
  onChange: (iso: string) => void;
  className?: string;
  placeholder?: string;
}) {
  const [text, setText] = React.useState(isoToDisplay(value));
  const [bad, setBad] = React.useState(false);

  // value changed from outside (calendar / loaded question)
  React.useEffect(() => {
    const shown = isoToDisplay(value);
    if (value && shown !== text) setText(shown);
    if (!value && displayToIso(text)) setText("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const type = (raw: string) => {
    const digits = raw.replace(/\D/g, "").slice(0, 8);
    let out = digits;
    if (digits.length > 4) out = `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
    else if (digits.length > 2) out = `${digits.slice(0, 2)}/${digits.slice(2)}`;
    setText(out);
    if (digits.length === 0) {
      setBad(false);
      onChange("");
    } else if (digits.length === 8) {
      const iso = displayToIso(out);
      setBad(!iso);
      onChange(iso ?? "");
    } else {
      setBad(false);
      onChange("");
    }
  };

  return (
    <div className="relative">
      <input
        className={`${className} pr-10 ${bad ? "border-red-500" : ""}`}
        inputMode="numeric"
        placeholder={placeholder}
        value={text}
        onChange={(e) => type(e.target.value)}
        aria-invalid={bad}
      />
      <label className="absolute right-1 top-1/2 flex h-8 w-8 -translate-y-1/2 cursor-pointer items-center justify-center rounded text-base hover:bg-muted" title="Calendar se chunein">
        📅
        <input
          type="date"
          tabIndex={-1}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          value={value || ""}
          onChange={(e) => {
            setBad(false);
            onChange(e.target.value);
            setText(isoToDisplay(e.target.value));
          }}
        />
      </label>
      {bad && <p className="mt-1 text-xs text-red-600">Date galat hai — DD/MM/YYYY me likhein (jaise 05/10/2026).</p>}
    </div>
  );
}
