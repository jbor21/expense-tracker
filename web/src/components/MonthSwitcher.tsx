import { addMonths } from '../lib/months';

interface MonthSwitcherProps {
  month: string;
  onChange: (month: string) => void;
}

/** Chevron pair that lives in the page header next to the month title. */
export default function MonthSwitcher({ month, onChange }: MonthSwitcherProps) {
  const btn = 'w-9 h-9 rounded-full border border-line bg-white flex items-center justify-center text-ink active:bg-paper';
  return (
    <div className="flex gap-2">
      <button aria-label="Previous month" onClick={() => onChange(addMonths(month, -1))} className={btn}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="w-4 h-4">
          <path d="M14.5 5.5 8 12l6.5 6.5" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <button aria-label="Next month" onClick={() => onChange(addMonths(month, 1))} className={btn}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="w-4 h-4">
          <path d="M9.5 5.5 16 12l-6.5 6.5" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </div>
  );
}
