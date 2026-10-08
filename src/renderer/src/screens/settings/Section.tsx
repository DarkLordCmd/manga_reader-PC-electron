import type { ReactNode } from 'react';

export default function Section({ title, children }: { title: string; children: ReactNode }): JSX.Element {
  return (
    <div className="settings-section">
      <h3 className="settings-heading">{title}</h3>
      {children}
    </div>
  );
}
