import { useState, useCallback } from 'react';

export function useIdempotencyKey() {
  const [key, setKey] = useState(() => crypto.randomUUID());
  const refresh = useCallback(() => setKey(crypto.randomUUID()), []);
  return { key, refresh };
}
