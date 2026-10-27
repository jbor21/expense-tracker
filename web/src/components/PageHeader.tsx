/** Sticky page header that clears the iPhone notch (safe-area top inset).
 *  `title` is the page subject; `accessory` renders on the trailing edge. */
export default function PageHeader({ title, accessory, children }: {
  title: React.ReactNode;
  accessory?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <header className="sticky top-0 z-20 bg-paper/90 backdrop-blur border-b border-line pt-[env(safe-area-inset-top)]">
      <div className="max-w-xl mx-auto px-5 pt-3 pb-3 flex items-end justify-between gap-3">
        <h1 className="font-display text-[28px] leading-none font-semibold tracking-tight">{title}</h1>
        {accessory}
      </div>
      {children}
    </header>
  );
}
