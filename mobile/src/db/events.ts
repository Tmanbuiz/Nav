/** Tiny change signal so screens reload after any write. */
type Listener = () => void;

const listeners = new Set<Listener>();

export function notifyChanged(): void {
  listeners.forEach((listener) => listener());
}

export function onChanged(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function nowStamp(): string {
  return new Date().toISOString();
}
