import { skillLabel, skillRole } from '@bw/shared';
import { Loader2 } from 'lucide-react';
import { forwardRef, useId, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { Link, type LinkProps } from 'react-router-dom';
import styles from './ui.module.css';

type Variant = 'primary' | 'secondary' | 'quiet' | 'danger' | 'foil';
type Size = 'md' | 'sm' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  busy?: boolean;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', busy, icon, children, className, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      className={[styles.btn, styles[variant], styles[size], className].filter(Boolean).join(' ')}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      {...rest}
    >
      {busy ? <Loader2 className={styles.spin} size={16} aria-hidden /> : icon}
      <span>{children}</span>
    </button>
  );
});

export function ButtonLink({ variant = 'secondary', size = 'md', icon, children, className, ...rest }: LinkProps & { variant?: Variant; size?: Size; icon?: ReactNode }) {
  return (
    <Link className={[styles.btn, styles[variant], styles[size], className].filter(Boolean).join(' ')} {...rest}>
      {icon}
      <span>{children}</span>
    </Link>
  );
}

interface FieldShell {
  label: string;
  hint?: ReactNode;
  error?: string;
  optional?: boolean;
}

export function Field({ label, hint, error, optional, children, id }: FieldShell & { children: (props: { id: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean }) => ReactNode; id?: string }) {
  const auto = useId();
  const fid = id ?? auto;
  const hintId = hint ? `${fid}-hint` : undefined;
  const errId = error ? `${fid}-err` : undefined;
  const describedBy = [errId, hintId].filter(Boolean).join(' ') || undefined;
  return (
    <div className={styles.field} data-invalid={error ? '' : undefined}>
      <label htmlFor={fid} className={styles.label}>
        {label}
        {optional && <span className={styles.optional}> (optional)</span>}
      </label>
      {children({ id: fid, 'aria-describedby': describedBy, 'aria-invalid': error ? true : undefined })}
      {error && (
        <p id={errId} className={styles.error}>
          {error}
        </p>
      )}
      {hint && !error && (
        <p id={hintId} className={styles.hint}>
          {hint}
        </p>
      )}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={[styles.input, className].filter(Boolean).join(' ')} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...rest }, ref) {
  return <textarea ref={ref} className={[styles.input, styles.textarea, className].filter(Boolean).join(' ')} {...rest} />;
});

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={[styles.input, styles.select, className].filter(Boolean).join(' ')} {...rest}>
      {children}
    </select>
  );
}

/** A skill as a typed chip. `lit` = matches the active filter; `wanted` = a skill the team is asking for. */
export function SkillChip({ id, lit, dim, wanted }: { id: string; lit?: boolean; dim?: boolean; wanted?: boolean }) {
  const role = skillRole(id);
  return (
    <span
      className={styles.chip}
      data-role={role}
      data-lit={lit ? '' : undefined}
      data-dim={dim ? '' : undefined}
      data-wanted={wanted ? '' : undefined}
      style={{ ['--chip' as string]: role ? `var(--role-${role})` : 'var(--ink-3)' }}
    >
      {wanted && <span aria-hidden>+</span>}
      {skillLabel(id)}
      {wanted && <span className="visually-hidden"> (wanted)</span>}
    </span>
  );
}

export function Badge({ tone = 'neutral', children }: { tone?: 'neutral' | 'success' | 'warn' | 'danger' | 'shell'; children: ReactNode }) {
  return (
    <span className={styles.badge} data-tone={tone}>
      {children}
    </span>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className={styles.empty}>
      <svg width="64" height="40" viewBox="0 0 64 40" aria-hidden className={styles.emptyArt}>
        <rect x="2" y="4" width="16" height="32" rx="3" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="4 3" />
        <rect x="24" y="4" width="16" height="32" rx="3" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="4 3" />
        <rect x="46" y="4" width="16" height="32" rx="3" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="4 3" />
      </svg>
      <h2 className={styles.emptyTitle}>{title}</h2>
      {children && <div className={styles.emptyBody}>{children}</div>}
      {action}
    </div>
  );
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div className={styles.loading} role="status">
      <Loader2 className={styles.spin} size={20} aria-hidden />
      <span>{label}…</span>
    </div>
  );
}

export function Panel({ title, action, children, as = 'section', id }: { title?: ReactNode; action?: ReactNode; children: ReactNode; as?: 'section' | 'div' | 'aside'; id?: string }) {
  const Tag = as;
  const hid = useId();
  return (
    <Tag className={styles.panel} aria-labelledby={title ? hid : undefined} id={id}>
      {(title || action) && (
        <header className={styles.panelHead}>
          {title && (
            <h2 id={hid} className={styles.panelTitle}>
              {title}
            </h2>
          )}
          {action}
        </header>
      )}
      {children}
    </Tag>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <p className={styles.errorNote} role="alert">
      {children}
    </p>
  );
}
