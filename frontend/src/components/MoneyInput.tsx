/** Editable amount with a visible $ prefix. Stored value stays numeric (no $). */
export default function MoneyInput({
  value,
  onChange,
  onBlur,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  className?: string;
}) {
  return (
    <div
      className={`flex items-center border border-slate-200 rounded bg-white focus-within:border-indigo-400 ${className ?? "w-24"}`}
    >
      <span className="pl-1 text-slate-400 select-none">$</span>
      <input
        className="min-w-0 flex-1 border-0 bg-transparent px-1 py-1 text-xs outline-none"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[$,\s]/g, ""))}
        onBlur={onBlur}
        inputMode="decimal"
      />
    </div>
  );
}
