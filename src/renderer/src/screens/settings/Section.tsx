import type { ReactNode } from 'react';

interface SectionProps {
  title: string;
  desc?: string;
  children: ReactNode;
}

/** Settings card: uppercase title, optional one-line description, body rows. */
export default function Section({ title, desc, children }: SectionProps): JSX.Element {
  return (
    <section className="settings-section">
      <header className="settings-head">
        <h3 className="settings-heading">{title}</h3>
        {desc && <p className="settings-desc">{desc}</p>}
      </header>
      <div className="settings-body">{children}</div>
    </section>
  );
}

interface RowProps {
  /** Left column. Omit for a full-width row. */
  label?: ReactNode;
  /** `stack` puts the label above the control (textareas, long inputs). */
  stack?: boolean;
  /** Muted text under the control, spanning the row. */
  note?: ReactNode;
  children: ReactNode;
}

export function Row({ label, stack, note, children }: RowProps): JSX.Element {
  const cls = ['set-row', stack ? 'stack' : '', label ? '' : 'bare'].filter(Boolean).join(' ');
  return (
    <div className={cls}>
      {label ? <div className="set-label">{label}</div> : null}
      <div className="set-control">{children}</div>
      {note ? <div className="set-note">{note}</div> : null}
    </div>
  );
}

/** Sub-heading inside a card that holds too many rows for one list. */
export function SubHead({ children }: { children: ReactNode }): JSX.Element {
  return <div className="set-sub">{children}</div>;
}
