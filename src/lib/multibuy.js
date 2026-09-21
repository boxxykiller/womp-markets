// EVE's multibuy window accepts lines of "Item Name<TAB>Quantity" and pastes
// straight into a shopping list. Getting the exact format right matters: the
// client rejects the whole paste if a quantity has a thousands separator or a
// decimal point, so the numbers here are always plain integers.
//
// Shared by the Cart's "copy multibuy" and by the Tracked page's bulk paste,
// which parses the same format back — one format, one place.

/** One multibuy line. Quantities are rounded up: a partial unit isn't buyable. */
export function formatMultibuyLine(name, quantity) {
  const qty = Math.max(0, Math.ceil(Number(quantity) || 0));
  return `${String(name).trim()}\t${qty}`;
}

/**
 * Renders a full multibuy block.
 * Items with a zero quantity are dropped — nothing to buy is not a line.
 */
export function formatMultibuy(items) {
  return items
    .map((item) => ({ name: item.itemName ?? item.name, quantity: Math.ceil(Number(item.quantity) || 0) }))
    .filter((item) => item.name && item.quantity > 0)
    .map((item) => formatMultibuyLine(item.name, item.quantity))
    .join('\n');
}

// "Aurora M<TAB>725 / 500<TAB>179900.00 ISK". The target may be "—" (none set)
// and the price may be "No data"; both are optional and discarded.
const STOCK_LINE = /^(.*?)[\t ]+\d[\d,.]*\s*\/\s*(\d[\d,.]*|[—–-])?\s*(?:[\d,.]+\s*ISK|No data)?$/i;

/**
 * Parses pasted text into { name, quantity } pairs.
 *
 * Accepts what people actually paste: tab- or multi-space-separated, with or
 * without a trailing quantity, and with thousands separators in the numbers
 * (EVE's own copy output includes them even though its paste input rejects
 * them). A line with no quantity is kept with quantity 0 so the caller can
 * decide a default rather than silently dropping the item.
 */
export function parseMultibuy(text) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const items = [];
  for (const line of lines) {
    // Hangar/stock export: "Name<TAB>have / target<TAB>price ISK". The target
    // is the quantity we want; the current stock and the price are ignored.
    const stock = line.match(STOCK_LINE);
    if (stock) {
      const name = stock[1].trim();
      const target = Number((stock[2] ?? '').replace(/[\s,.]/g, ''));
      if (name) items.push({ name, quantity: Number.isFinite(target) ? target : 0 });
      continue;
    }

    // Split on the LAST tab or 2+ spaces, so item names containing spaces
    // (almost all of them) survive intact.
    const match = line.match(/^(.*?)[\t ]{1,}([\d.,\s]+)$/);
    if (!match) {
      items.push({ name: line, quantity: 0 });
      continue;
    }
    const name = match[1].trim();
    const quantity = Number(match[2].replace(/[\s,.]/g, ''));
    if (!name) continue;
    items.push({ name, quantity: Number.isFinite(quantity) ? quantity : 0 });
  }
  return items;
}
