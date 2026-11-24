import type { ChangeEvent, ReactNode } from 'react';

interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  children?: ReactNode;
  className?: string;
  title?: string;
  ariaLabel?: string;
}

export default function Toggle({ checked, onChange, children, className, title, ariaLabel }: ToggleProps): JSX.Element {
  return (
    <label className={`toggle-row${className ? ` ${className}` : ''}`} title={title}>
      <input
        type="checkbox"
        className="toggle-input"
        checked={checked}
        aria-label={ariaLabel}
        onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.checked)}
      />
      <span className={`toggle${checked ? ' on' : ''}`} aria-hidden="true" />
      {children}
    </label>
  );
}
