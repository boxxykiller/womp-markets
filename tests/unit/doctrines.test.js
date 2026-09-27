import { describe, expect, it } from 'vitest';
import { aggregateLines, parseEft } from '../../server/src/lib/eft.js';
import { evaluateDoctrine, evaluateFit, fitMinimum, fitRequirements } from '../../server/src/lib/doctrineMath.js';

const FEROX = `[Ferox, WOMP Ferox]
Damage Control II
Magnetic Field Stabilizer II
Magnetic Field Stabilizer II /OFFLINE
[Empty Low slot]

Large Shield Extender II
Large Shield Extender II

250mm Railgun II, Spike M
250mm Railgun II, Spike M

Medium Core Defense Field Extender I


Hornet EC-300 x5

Spike M x2,000
Nanite Repair Paste x50
`;

describe('parseEft', () => {
  it('reads the header, modules, drones and cargo', () => {
    const [fit] = parseEft(FEROX);
    expect(fit.shipName).toBe('Ferox');
    expect(fit.fitName).toBe('WOMP Ferox');
    expect(fit.lines).toContainEqual({ name: 'Hornet EC-300', quantity: 5, counted: true });
    expect(fit.lines).toContainEqual({ name: 'Spike M', quantity: 2000, counted: true });
  });

  it('drops loaded charges, offline markers and empty slots', () => {
    const [fit] = parseEft(FEROX);
    const names = fit.lines.map((l) => l.name);
    expect(names).not.toContain('[Empty Low slot]');
    expect(names.filter((n) => n === 'Magnetic Field Stabilizer II')).toHaveLength(2);
    expect(names.filter((n) => n === '250mm Railgun II')).toHaveLength(2);
  });

  it('splits several pasted fits apart and ignores text before the first header', () => {
    const fits = parseEft(`junk line\n${FEROX}\n[Scimitar, Logi]\nLarge Remote Shield Booster II\n`);
    expect(fits.map((f) => f.shipName)).toEqual(['Ferox', 'Scimitar']);
    expect(fits[1].lines).toEqual([{ name: 'Large Remote Shield Booster II', quantity: 1, counted: false }]);
    expect(fits[1].eft.startsWith('[Scimitar, Logi]')).toBe(true);
  });

  it('returns nothing for text with no fit header', () => {
    expect(parseEft('Tritanium 100')).toEqual([]);
  });
});

describe('aggregateLines', () => {
  it('sums repeated modules but keeps fitted and cargo copies apart', () => {
    const out = aggregateLines([
      { name: 'Damage Control II', quantity: 1, counted: false },
      { name: 'damage control ii', quantity: 1, counted: false },
      { name: 'Damage Control II', quantity: 1, counted: true },
    ]);
    expect(out).toHaveLength(2);
    expect(out.find((l) => !l.counted).quantity).toBe(2);
  });
});

const HULL = 1;
const MOD = 2;
const AMMO = 3;

const fit = (overrides = {}) => ({
  id: 'f1',
  name: 'Test',
  minQuantity: null,
  includeCargo: true,
  items: [
    { typeId: HULL, name: 'Hull', quantity: 1, kind: 'hull' },
    { typeId: MOD, name: 'Mod', quantity: 3, kind: 'module' },
    { typeId: AMMO, name: 'Ammo', quantity: 100, kind: 'cargo' },
  ],
  ...overrides,
});

const marketOf = (stock) => (typeId) => ({ onMarket: stock[typeId] ?? 0, jitaPrice: 10, localPrice: 12 });

describe('fitMinimum', () => {
  it("uses the fit's own minimum, falling back to the doctrine's", () => {
    expect(fitMinimum({ minQuantity: 4 }, { minQuantity: 10 })).toBe(4);
    expect(fitMinimum({ minQuantity: null }, { minQuantity: 10 })).toBe(10);
    expect(fitMinimum({ minQuantity: 0 }, { minQuantity: 10 })).toBe(0);
  });
});

describe('fitRequirements', () => {
  it('leaves cargo out when the fit does not count it', () => {
    expect(fitRequirements(fit({ includeCargo: false })).map((r) => r.typeId)).toEqual([HULL, MOD]);
  });
});

describe('evaluateFit', () => {
  it('is limited by the scarcest part', () => {
    const r = evaluateFit(fit(), { minQuantity: 5 }, marketOf({ [HULL]: 10, [MOD]: 7, [AMMO]: 1000 }));
    expect(r.fittable).toBe(2); // 7 modules / 3 per fit
    expect(r.status).toBe('critical');
    expect(r.shortfall).toBe(3);
    const mod = r.items.find((i) => i.typeId === MOD);
    expect(mod.bottleneck).toBe(true);
    expect(mod.missing).toBe(15 - 7);
  });

  it('is ok once every part covers the minimum', () => {
    const r = evaluateFit(fit(), { minQuantity: 2 }, marketOf({ [HULL]: 2, [MOD]: 6, [AMMO]: 200 }));
    expect(r.status).toBe('ok');
    expect(r.missingItems).toBe(0);
    expect(r.fitCostJita).toBe(10 * (1 + 3 + 100));
  });

  it('reads as out when any part is missing entirely', () => {
    const r = evaluateFit(fit(), { minQuantity: 1 }, marketOf({ [HULL]: 5, [MOD]: 5 }));
    expect(r.fittable).toBe(0);
    expect(r.status).toBe('out');
  });
});

describe('evaluateDoctrine', () => {
  it('counts shared parts against combined demand', () => {
    const a = fit({ id: 'a', minQuantity: 1 });
    const b = fit({ id: 'b', minQuantity: 1 });
    // Enough for either fit alone, not for both.
    const r = evaluateDoctrine({ minQuantity: 0 }, [a, b], marketOf({ [HULL]: 2, [MOD]: 3, [AMMO]: 200 }));
    expect(r.fitsReady).toBe(2);
    expect(r.status).toBe('low');
    expect(r.missing).toEqual([expect.objectContaining({ typeId: MOD, needed: 6, missing: 3 })]);
    expect(r.missingCostJita).toBe(30);
  });

  it('is ready when combined stock covers every fit', () => {
    const r = evaluateDoctrine({ minQuantity: 1 }, [fit({ id: 'a' }), fit({ id: 'b' })], marketOf({ [HULL]: 2, [MOD]: 6, [AMMO]: 200 }));
    expect(r.status).toBe('ok');
    expect(r.coverage).toBe(1);
    expect(r.hullsFittable).toBe(4);
  });

  it('ignores untargeted fits when judging status', () => {
    const targeted = fit({ id: 'a', minQuantity: 1 });
    const extra = fit({ id: 'b', minQuantity: 0, items: [{ typeId: 99, quantity: 1, kind: 'hull' }] });
    const r = evaluateDoctrine({ minQuantity: 0 }, [targeted, extra], marketOf({ [HULL]: 1, [MOD]: 3, [AMMO]: 100 }));
    expect(r.status).toBe('ok');
  });

  it('has no status with no fits', () => {
    expect(evaluateDoctrine({ minQuantity: 1 }, [], marketOf({})).status).toBeNull();
  });
});
