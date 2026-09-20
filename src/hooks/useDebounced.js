import { useEffect, useState } from 'react';

/**
 * Debounces a value before it enters a react-query key, so typing in a search
 * box doesn't fire a request per keystroke.
 */
export function useDebounced(value, delay = 300) {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}
