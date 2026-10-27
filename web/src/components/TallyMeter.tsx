/** Budget progress drawn as tally marks — the app's namesake.
 *  One stroke per 10% of budget, grouped in fives (four uprights + a diagonal
 *  strike). Spent strokes are inked; the rest stay faint. Spending past the
 *  budget adds red strokes beyond the tenth (capped at one extra group). */
export default function TallyMeter({ spent, budget }: { spent: number; budget: number }) {
  if (budget <= 0) {
    return <div className="h-[22px] flex items-center text-xs text-faint">No budget set — tap to add one</div>;
  }
  const ratio = Math.max(0, spent / budget);
  const inked = Math.min(10, Math.round(ratio * 10));
  const overStrokes = Math.min(5, Math.max(0, Math.round(ratio * 10) - 10));
  const total = 10 + (overStrokes > 0 ? 5 : 0);

  const groups: number[][] = [];
  for (let g = 0; g < total / 5; g++) groups.push([0, 1, 2, 3, 4].map((i) => g * 5 + i));

  return (
    <svg width={groups.length * 46 - 14} height="22" aria-hidden="true" className="block">
      {groups.map((group, g) =>
        group.map((idx, i) => {
          const on = idx < inked;
          const over = idx >= 10 ? idx - 10 < overStrokes : on && ratio > 1;
          const x = g * 46 + i * 7;
          const color = idx >= 10
            ? (idx - 10 < overStrokes ? 'var(--color-over)' : 'transparent')
            : on ? (ratio > 1 ? 'var(--color-over)' : 'var(--color-ink)') : 'var(--color-line)';
          void over;
          if (i === 4) {
            // Diagonal strike across its group of four.
            return <line key={idx} x1={g * 46 - 3} y1="19" x2={g * 46 + 24} y2="3"
              stroke={color} strokeWidth="2.5" strokeLinecap="round" />;
          }
          return <line key={idx} x1={x} y1="2" x2={x} y2="20"
            stroke={color} strokeWidth="2.5" strokeLinecap="round" />;
        }),
      )}
    </svg>
  );
}
