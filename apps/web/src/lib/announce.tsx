import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import styles from './announce.module.css';

type Tone = 'info' | 'success' | 'conflict';

interface Toast {
  id: number;
  tone: Tone;
  title: string;
  body?: string;
}

interface AnnounceApi {
  /** screen-reader only, polite (live board changes) */
  say: (message: string) => void;
  /** visible toast; conflicts are also read assertively */
  toast: (t: { tone?: Tone; title: string; body?: string }) => void;
}

const Ctx = createContext<AnnounceApi | null>(null);

export function AnnounceProvider({ children }: { children: ReactNode }) {
  const [polite, setPolite] = useState('');
  const [assertive, setAssertive] = useState('');
  const [toasts, setToasts] = useState<Toast[]>([]);
  const next = useRef(1);

  const say = useCallback((message: string) => {
    setPolite('');
    requestAnimationFrame(() => setPolite(message));
  }, []);

  const toast = useCallback(({ tone = 'info', title, body }: { tone?: Tone; title: string; body?: string }) => {
    const id = next.current++;
    setToasts((list) => [...list.slice(-3), { id, tone, title, body }]);
    const text = body ? `${title}. ${body}` : title;
    if (tone === 'conflict') {
      setAssertive('');
      requestAnimationFrame(() => setAssertive(text));
    } else {
      setPolite('');
      requestAnimationFrame(() => setPolite(text));
    }
  }, []);

  const dismiss = (id: number) => setToasts((list) => list.filter((t) => t.id !== id));

  return (
    <Ctx.Provider value={{ say, toast }}>
      {children}
      <div className="visually-hidden" aria-live="polite" aria-atomic="true">
        {polite}
      </div>
      <div className="visually-hidden" aria-live="assertive" aria-atomic="true">
        {assertive}
      </div>
      <ol className={styles.stack} aria-label="Notifications">
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onDone={() => dismiss(t.id)} />
        ))}
      </ol>
    </Ctx.Provider>
  );
}

function ToastItem({ toast, onDone }: { toast: Toast; onDone: () => void }) {
  useEffect(() => {
    const ms = toast.tone === 'conflict' ? 9000 : 5000;
    const timer = setTimeout(onDone, ms);
    return () => clearTimeout(timer);
  }, [toast, onDone]);
  return (
    <li className={styles.toast} data-tone={toast.tone}>
      <div>
        <p className={styles.title}>{toast.title}</p>
        {toast.body && <p className={styles.body}>{toast.body}</p>}
      </div>
      <button type="button" className={styles.close} onClick={onDone} aria-label="Dismiss notification">
        <X size={16} aria-hidden />
      </button>
    </li>
  );
}

export function useAnnounce(): AnnounceApi {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAnnounce outside AnnounceProvider');
  return ctx;
}
