import { useEffect, useRef, useState } from "react";

export interface ColFilter {
  search: string;
  selected: string[];
}

export function FilterPopover({
  label,
  values,
  filter,
  pos,
  onSearch,
  onToggle,
  onSelectAll,
  onClear,
  onClose,
  onEscape,
}: {
  label: string;
  values: string[];
  filter: ColFilter;
  pos: { top: number; left: number };
  onSearch: (s: string) => void;
  onToggle: (v: string) => void;
  onSelectAll: () => void;
  onClear: () => void;
  onClose: () => void;
  onEscape: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const containsRef = useRef<HTMLInputElement>(null);
  const findRef = useRef<HTMLInputElement>(null);
  const selectAllRef = useRef<HTMLButtonElement>(null);
  const clearRef = useRef<HTMLButtonElement>(null);
  const doneRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<Array<HTMLInputElement | null>>([]);
  const [valSearch, setValSearch] = useState("");
  const [active, setActive] = useState(-1);
  const onToggleRef = useRef(onToggle);
  const onEscapeRef = useRef(onEscape);
  onToggleRef.current = onToggle;
  onEscapeRef.current = onEscape;

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  const shown = values.filter((v) =>
    valSearch ? (v || "(blank)").toLowerCase().includes(valSearch.toLowerCase()) : true,
  );
  const shownRef = useRef(shown);
  const activeRef = useRef(active);
  shownRef.current = shown;
  activeRef.current = active;

  useEffect(() => {
    activeRef.current = -1;
    setActive(-1);
  }, [valSearch]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const pop = ref.current;
      if (!pop) return;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onEscapeRef.current();
        return;
      }
      const target = e.target as HTMLElement | null;
      const opener = document.querySelector<HTMLElement>(".th-filter[aria-expanded='true']");
      const focusInside = pop.contains(document.activeElement) || document.activeElement === opener;
      if (e.key === "Enter" && focusInside) {
        e.preventDefault();
        e.stopPropagation();
        onEscapeRef.current();
        return;
      }
      const typing =
        !!target &&
        pop.contains(target) &&
        target.tagName === "INPUT" &&
        (target as HTMLInputElement).type !== "checkbox";
      if ((e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "ArrowLeft" || e.key === "ArrowRight") && focusInside) {
        const list = shownRef.current;
        const focusEl = document.activeElement;
        const itemIndex = itemRefs.current.findIndex((el) => el === focusEl);
        const at =
          focusEl === containsRef.current
            ? "contains"
            : focusEl === findRef.current
              ? "find"
              : focusEl === selectAllRef.current
                ? "selectAll"
                : focusEl === clearRef.current
                  ? "clear"
                  : focusEl === doneRef.current
                    ? "done"
                    : itemIndex >= 0
                      ? itemIndex
                      : null;
        if (e.key === "ArrowRight" && at === "selectAll") {
          e.preventDefault();
          e.stopPropagation();
          clearRef.current?.focus();
          return;
        }
        if (e.key === "ArrowLeft" && at === "clear") {
          e.preventDefault();
          e.stopPropagation();
          selectAllRef.current?.focus();
          return;
        }
        if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
        e.preventDefault();
        e.stopPropagation();
        const focusField = (field: "contains" | "find" | "selectAll" | "clear" | "done" | number) => {
          activeRef.current = typeof field === "number" ? field : -1;
          setActive(activeRef.current);
          const el =
            field === "contains"
              ? containsRef.current
              : field === "find"
                ? findRef.current
                : field === "selectAll"
                  ? selectAllRef.current
                  : field === "clear"
                    ? clearRef.current
                    : field === "done"
                      ? doneRef.current
                      : itemRefs.current[field];
          el?.focus();
          if (typeof field === "number") el?.scrollIntoView({ block: "nearest" });
        };
        if (e.key === "ArrowDown") {
          if (at === "contains") focusField("find");
          else if (at === "find") focusField("selectAll");
          else if (at === "selectAll" || at === "clear") focusField(list.length ? 0 : "done");
          else if (at === "done") focusField("contains");
          else if (typeof at === "number" && at < list.length - 1) focusField(at + 1);
          else if (typeof at === "number") focusField("done");
          else focusField(list.length ? 0 : "contains");
          return;
        }
        if (at === "find") focusField("contains");
        else if (at === "selectAll" || at === "clear") focusField("find");
        else if (at === "done") focusField(list.length ? list.length - 1 : "selectAll");
        else if (typeof at === "number" && at > 0) focusField(at - 1);
        else if (typeof at === "number") focusField("selectAll");
        else focusField("contains");
        return;
      }
      if (e.key === " " && !typing && activeRef.current >= 0 && target?.closest(".filter-pop-item")) {
        const list = shownRef.current;
        const value = list[activeRef.current];
        if (value === undefined) return;
        e.preventDefault();
        e.stopPropagation();
        onToggleRef.current(value);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (e.key === " " && target?.closest(".filter-pop-item")) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("keyup", onKeyUp, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("keyup", onKeyUp, true);
    };
  }, []);

  return (
    <div
      ref={ref}
      className="filter-pop"
      style={{ top: pos.top, left: pos.left }}
      role="dialog"
      aria-label={`Filter ${label}`}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="text-xs font-semibold text-slate-700 mb-2 truncate">{label}</div>
      <input
        ref={containsRef}
        autoFocus
        placeholder="Contains…"
        value={filter.search}
        onChange={(e) => onSearch(e.target.value)}
        className="w-full border border-slate-300 rounded-md px-2 py-1 text-xs mb-2"
      />
      <input
        ref={findRef}
        placeholder="Find values…"
        value={valSearch}
        onChange={(e) => setValSearch(e.target.value)}
        className="w-full border border-slate-200 rounded-md px-2 py-1 text-xs mb-1.5"
      />
      <div className="flex items-center justify-between text-[11px] text-indigo-600 mb-1">
        <button ref={selectAllRef} type="button" onClick={onSelectAll} className="hover:underline">
          Select all
        </button>
        <button ref={clearRef} type="button" onClick={onClear} className="hover:underline">
          Clear
        </button>
      </div>
      <div className="max-h-52 overflow-auto border border-slate-100 rounded-md" role="listbox" aria-multiselectable="true">
        {shown.map((v, i) => {
          const checked = filter.selected.length === 0 || filter.selected.includes(v);
          return (
            <label
              key={v || "(blank)"}
              className={`filter-pop-item flex items-center gap-2 px-2 py-1 text-xs hover:bg-slate-50 cursor-pointer ${active === i ? "is-active" : ""}`}
              role="option"
              aria-selected={filter.selected.includes(v)}
            >
              <input
                ref={(el) => {
                  itemRefs.current[i] = el;
                }}
                type="checkbox"
                checked={filter.selected.includes(v)}
                onChange={() => onToggle(v)}
                onFocus={() => {
                  activeRef.current = i;
                  setActive(i);
                }}
              />
              <span className={`truncate ${!checked ? "text-slate-400" : ""}`}>{v || "(blank)"}</span>
            </label>
          );
        })}
        {shown.length === 0 && <div className="px-2 py-2 text-xs text-slate-400">No values</div>}
      </div>
      <div className="flex justify-end mt-2">
        <button
          ref={doneRef}
          type="button"
          onClick={onClose}
          className="text-xs px-3 py-1 bg-slate-800 text-white rounded-md hover:bg-slate-700"
        >
          Done
        </button>
      </div>
    </div>
  );
}
