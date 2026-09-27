// Parser for EFT-format fittings — what EVE's "Copy to clipboard" on a fit,
// and pyfa's default export, both produce:
//
//   [Ferox, WOMP Ferox]
//   Damage Control II
//   Magnetic Field Stabilizer II
//
//   Large Shield Extender II
//   [Empty Mid slot]
//
//   250mm Railgun II, Spike L
//
//   Hornet EC-300 x5
//
//   Spike L x2000
//
// Pure text handling only: names are resolved to type ids (and drones told
// apart from cargo) by the caller against the SDE, because the section a line
// sits in is not reliable — pyfa and the client disagree on blank lines, and
// drones pasted into cargo are still drones.

const HEADER = /^\[([^,\]]+),\s*(.*?)\]$/;
const EMPTY_SLOT = /^\[empty .*\]$/i;
const COUNTED = /^(.+?)\s+x\s?(\d[\d,.]*)$/i;
const OFFLINE = /\s*\/\s*offline$/i;

/**
 * Splits pasted text into fits. Several fits can be pasted at once; each
 * starts at its own `[Hull, Name]` header. Text before the first header is
 * ignored rather than rejected, so a stray line copied along with the fit
 * doesn't sink the import.
 *
 * Returns [{ shipName, fitName, lines: [{ name, quantity, counted }], eft }],
 * where `counted` marks an "xN" line (drones, cargo) as opposed to a fitted
 * module, and `eft` is that fit's original text for copying back out.
 */
export function parseEft(text) {
  const fits = [];
  let current = null;

  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    const header = line.match(HEADER);
    if (header) {
      current = { shipName: header[1].trim(), fitName: header[2].trim() || header[1].trim(), lines: [], raw: [line] };
      fits.push(current);
      continue;
    }
    if (!current) continue;
    current.raw.push(raw.trimEnd());
    if (!line || EMPTY_SLOT.test(line)) continue;

    const counted = line.match(COUNTED);
    if (counted) {
      const quantity = Number(counted[2].replace(/[,.]/g, ''));
      if (quantity > 0) current.lines.push({ name: counted[1].trim(), quantity, counted: true });
      continue;
    }

    // "Module, Loaded Charge" — the loaded charge is fitted ammo with no
    // quantity; whatever the fit actually carries is listed in cargo.
    const name = line.replace(OFFLINE, '').split(',')[0].trim();
    if (name) current.lines.push({ name, quantity: 1, counted: false });
  }

  return fits.map(({ raw, ...fit }) => ({ ...fit, eft: raw.join('\n').trim() }));
}

/**
 * Collapses a parsed fit's lines into one entry per name, summing quantities
 * — a fit with six of the same launcher needs six, not one. Fitted and
 * counted lines stay apart, so a spare module in cargo doesn't become a
 * fitted one.
 */
export function aggregateLines(lines) {
  const byName = new Map();
  for (const line of lines) {
    const key = `${line.counted ? 'x' : 'm'}:${line.name.toLowerCase()}`;
    const existing = byName.get(key);
    if (existing) existing.quantity += line.quantity;
    else byName.set(key, { ...line });
  }
  return [...byName.values()];
}
