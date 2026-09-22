// The restock list. Deliberately per-browser (localStorage) rather than a
// server table: it is one person's working selection on the way to a
// multibuy paste, not shared state the whole corp should see change under
// them.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

const STORAGE_KEY = 'womp.cart.v2';
const CartContext = createContext(null);

function readStored() {
  // Storage throws in private windows and can come back empty after a clear,
  // so every access is guarded and the app renders fine without it.
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function CartProvider({ children }) {
  const [items, setItems] = useState(readStored);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch {
      // Out of quota or blocked — the cart still works for this session.
    }
  }, [items]);

  const addItems = useCallback((incoming) => {
    setItems((prev) => {
      const byType = new Map(prev.map((i) => [i.typeId, i]));
      for (const item of incoming) {
        if (!item?.typeId) continue;
        const existing = byType.get(item.typeId);
        byType.set(item.typeId, {
          typeId: item.typeId,
          itemName: item.itemName ?? existing?.itemName ?? null,
          // Re-adding an item refreshes its suggested quantity rather than
          // stacking, since the number is "what it takes to reach target"
          // and adding twice would over-buy.
          quantity: Math.max(0, Math.ceil(Number(item.quantity) || 0)),
          jitaBestSell: item.jitaBestSell ?? existing?.jitaBestSell ?? null,
          jitaBestBuy: item.jitaBestBuy ?? existing?.jitaBestBuy ?? null,
          volumePerUnit: item.volumePerUnit ?? existing?.volumePerUnit ?? null,
          bestSell: item.bestSell ?? existing?.bestSell ?? null,
        });
      }
      return [...byType.values()];
    });
  }, []);

  const setQuantity = useCallback((typeId, quantity) => {
    setItems((prev) =>
      prev.map((i) => (i.typeId === typeId ? { ...i, quantity: Math.max(0, Math.ceil(Number(quantity) || 0)) } : i)),
    );
  }, []);

  const removeItem = useCallback((typeId) => {
    setItems((prev) => prev.filter((i) => i.typeId !== typeId));
  }, []);

  const clear = useCallback(() => setItems([]), []);

  // Re-points items at corrected type ids ({ fromId: toId }), merging into an
  // existing entry for the target rather than leaving two rows for one item.
  const remapTypes = useCallback((remap) => {
    setItems((prev) => {
      const byType = new Map();
      for (const item of prev) {
        const typeId = remap[item.typeId] ?? item.typeId;
        const existing = byType.get(typeId);
        byType.set(typeId, existing ? { ...existing, quantity: Math.max(existing.quantity, item.quantity) } : { ...item, typeId });
      }
      return [...byType.values()];
    });
  }, []);

  const value = useMemo(
    () => ({
      items,
      count: items.length,
      addItems,
      setQuantity,
      removeItem,
      clear,
      remapTypes,
      has: (typeId) => items.some((i) => i.typeId === typeId),
    }),
    [items, addItems, setQuantity, removeItem, clear, remapTypes],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used inside a CartProvider');
  return ctx;
}
