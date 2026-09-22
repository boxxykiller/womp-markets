// Checks that the row shape the UI consumes is actually derived correctly
// from a seeded book, and that the admin boundary on watchlist writes is
// enforced by the dispatcher rather than only hidden in the UI.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const hasDb = !!process.env.DATABASE_URL_TEST;
const describeDb = hasDb ? describe : describe.skip;

let prisma;
let marketHandlers;
let REGISTRY;
let reportHandlers;

const STRUCTURE_ID = '1000000000002';
const TRIT = 34;
const PYE = 35;

async function seedType(typeId, name, marketGroupId = 1857) {
  await prisma.sdeRecord.upsert({
    where: { dataset_key: { dataset: 'types', key: String(typeId) } },
    create: {
      dataset: 'types',
      key: String(typeId),
      data: { name: { en: name }, groupID: 18, marketGroupID: marketGroupId, published: true, volume: 0.01 },
    },
    update: { data: { name: { en: name }, groupID: 18, marketGroupID: marketGroupId, published: true, volume: 0.01 } },
  });
}

async function seedOrder({ orderId, typeId, isBuy, price, remain }) {
  await prisma.marketOrder.create({
    data: {
      structureId: STRUCTURE_ID,
      orderId: String(orderId),
      typeId,
      isBuyOrder: isBuy,
      price,
      volumeRemain: remain,
      volumeTotal: remain,
      issued: new Date(),
      duration: 90,
    },
  });
}

async function seedDaily(typeId, daysAgo, units) {
  const d = new Date(Date.now() - daysAgo * 86400000);
  await prisma.marketDailyStat.create({
    data: {
      structureId: STRUCTURE_ID,
      typeId,
      date: new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())),
      unitsSoldConfirmed: units,
    },
  });
}

// Scoped to this suite's own structure id — see the note in
// marketPoller.test.js. ReferencePrice has no structure column, so it is
// cleared by the type ids this suite uses.
async function resetData() {
  const scope = { where: { structureId: STRUCTURE_ID } };
  await prisma.marketOrder.deleteMany(scope);
  await prisma.marketDailyStat.deleteMany(scope);
  await prisma.marketWatchItem.deleteMany(scope);
  await prisma.referencePrice.deleteMany({ where: { typeId: { in: [TRIT, PYE] } } });
  await prisma.marketSource.deleteMany(scope);
}

describeDb('market read API', () => {
  beforeAll(async () => {
    ({ prisma } = await import('../../server/src/db/prisma.js'));
    ({ marketHandlers } = await import('../../server/src/routes/market/index.js'));
    ({ REGISTRY } = await import('../../server/src/routes/functions.js'));
    ({ reportHandlers } = await import('../../server/src/routes/market/reports.js'));

    await seedType(TRIT, 'Tritanium');
    await seedType(PYE, 'Pyerite', 1858);
  });

  afterAll(async () => {
    await resetData();
    await prisma.sdeRecord.deleteMany({ where: { dataset: 'types', key: { in: [String(TRIT), String(PYE)] } } });
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await resetData();
    await prisma.marketSource.create({
      data: { structureId: STRUCTURE_ID, sourceType: 'structure', isPrimary: true, name: 'Test Citadel' },
    });
  });

  it('derives depth, rates, cover and the Jita comparison for one item', async () => {
    await seedOrder({ orderId: 1, typeId: TRIT, isBuy: false, price: 6, remain: 1000 });
    await seedOrder({ orderId: 2, typeId: TRIT, isBuy: false, price: 7, remain: 500 });
    await seedOrder({ orderId: 3, typeId: TRIT, isBuy: true, price: 5, remain: 500 });
    // 3 days of data, 100/day.
    await seedDaily(TRIT, 1, 100);
    await seedDaily(TRIT, 2, 100);
    await seedDaily(TRIT, 3, 100);
    await prisma.referencePrice.create({ data: { typeId: TRIT, bestSell: 5, bestBuy: 4, source: 'fuzzwork' } });

    const { rows } = await marketHandlers.getMarketBrowse.fn({ structureId: STRUCTURE_ID });
    const trit = rows.find((r) => r.typeId === TRIT);

    expect(trit.itemName).toBe('Tritanium');
    expect(trit.sellVolume).toBe(1500);
    expect(trit.buyVolume).toBe(500);
    // Best sell is the cheapest ask; best buy the highest bid.
    expect(trit.bestSell).toBe(6);
    expect(trit.bestBuy).toBe(5);

    // Averaged over days that have data, not over the whole window.
    expect(trit.avgDaily30).toBe(100);
    expect(trit.daysOfCover30).toBe(15); // 1500 / 100

    expect(trit.buySellSplit).toBe(0.25); // 500 / 2000
    // Local ask 6 vs Jita 5 — 20% dearer here.
    expect(trit.vsJitaSellPct).toBeCloseTo(0.2);
  });

  it('keeps a sold-out tracked item visible instead of dropping it with its orders', async () => {
    // Nothing on the market at all — the moment it matters most.
    await prisma.marketWatchItem.create({
      data: { structureId: STRUCTURE_ID, typeId: TRIT, itemName: 'Tritanium', minQuantity: 1000 },
    });

    const { rows } = await marketHandlers.getMarketBrowse.fn({ structureId: STRUCTURE_ID });
    const trit = rows.find((r) => r.typeId === TRIT);
    expect(trit).toBeDefined();
    expect(trit.status).toBe('out');
  });

  it('computes watchlist status, effective minimum and restock quantity', async () => {
    await seedOrder({ orderId: 1, typeId: TRIT, isBuy: false, price: 6, remain: 400 });
    await seedDaily(TRIT, 1, 100);
    await prisma.marketWatchItem.create({
      data: { structureId: STRUCTURE_ID, typeId: TRIT, itemName: 'Tritanium', minQuantity: 1000, targetQuantity: 2000 },
    });

    const { rows, counts } = await marketHandlers.getMarketWatchlist.fn({ structureId: STRUCTURE_ID });
    const trit = rows[0];

    expect(trit.effectiveMin).toBe(1000);
    expect(trit.status).toBe('critical'); // 400 < 500
    expect(trit.restockQuantity).toBe(1600); // 2000 - 400
    expect(counts.critical).toBe(1);
  });

  it('applies the dynamic minimum when it binds harder than the flat one', async () => {
    await seedOrder({ orderId: 1, typeId: TRIT, isBuy: false, price: 6, remain: 900 });
    await seedDaily(TRIT, 1, 200); // 200/day

    await prisma.marketWatchItem.create({
      // 5 days of cover at 200/day = 1000, which beats the flat floor of 100.
      data: { structureId: STRUCTURE_ID, typeId: TRIT, itemName: 'Tritanium', minQuantity: 100, minDaysCover: 5 },
    });

    const { rows } = await marketHandlers.getMarketWatchlist.fn({ structureId: STRUCTURE_ID });
    expect(rows[0].effectiveMin).toBe(1000);
    expect(rows[0].status).toBe('low'); // 900 < 1000 but above half
  });

  it('narrows results by name search', async () => {
    await seedOrder({ orderId: 1, typeId: TRIT, isBuy: false, price: 6, remain: 100 });
    await seedOrder({ orderId: 2, typeId: PYE, isBuy: false, price: 12, remain: 100 });

    const { rows } = await marketHandlers.getMarketBrowse.fn({ structureId: STRUCTURE_ID, search: 'pyer' });
    expect(rows.map((r) => r.typeId)).toEqual([PYE]);
  });

  it('narrows results by market group', async () => {
    await seedOrder({ orderId: 1, typeId: TRIT, isBuy: false, price: 6, remain: 100 });
    await seedOrder({ orderId: 2, typeId: PYE, isBuy: false, price: 12, remain: 100 });

    const { rows } = await marketHandlers.getMarketBrowse.fn({ structureId: STRUCTURE_ID, marketGroupId: 1858 });
    expect(rows.map((r) => r.typeId)).toEqual([PYE]);
  });

  it('filters the watchlist by status without changing the summary counts', async () => {
    await seedOrder({ orderId: 1, typeId: TRIT, isBuy: false, price: 6, remain: 50 });
    await seedOrder({ orderId: 2, typeId: PYE, isBuy: false, price: 12, remain: 5000 });
    await prisma.marketWatchItem.createMany({
      data: [
        { structureId: STRUCTURE_ID, typeId: TRIT, itemName: 'Tritanium', minQuantity: 1000 },
        { structureId: STRUCTURE_ID, typeId: PYE, itemName: 'Pyerite', minQuantity: 1000 },
      ],
    });

    const { rows, counts } = await marketHandlers.getMarketWatchlist.fn({ structureId: STRUCTURE_ID, status: ['critical'] });
    expect(rows.map((r) => r.typeId)).toEqual([TRIT]);
    // Counts describe the whole list, so the tiles don't move when the table
    // is filtered.
    expect(counts).toMatchObject({ critical: 1, ok: 1 });
  });

  it('sorts by days of cover with unknowns last', async () => {
    await seedOrder({ orderId: 1, typeId: TRIT, isBuy: false, price: 6, remain: 100 });
    await seedOrder({ orderId: 2, typeId: PYE, isBuy: false, price: 12, remain: 100 });
    await seedDaily(TRIT, 1, 100); // 1 day of cover
    // Pyerite has no sales data at all, so its cover is unknown.

    const { rows } = await marketHandlers.getMarketBrowse.fn({ structureId: STRUCTURE_ID, sort: 'daysOfCover' });
    expect(rows[0].typeId).toBe(TRIT);
    expect(rows[1].daysOfCover30).toBeNull();
  });

  describe('untracked item reports', () => {
    it('ranks untracked sellers and leaves tracked items out', async () => {
      await seedOrder({ orderId: 1, typeId: TRIT, isBuy: false, price: 6, remain: 1000 });
      await seedOrder({ orderId: 2, typeId: PYE, isBuy: false, price: 12, remain: 1000 });
      await seedDaily(TRIT, 1, 100);
      await seedDaily(PYE, 1, 100);
      await prisma.marketWatchItem.create({ data: { structureId: STRUCTURE_ID, typeId: PYE, itemName: 'Pyerite' } });

      const { rows, summary } = await reportHandlers.reportUntrackedMovers.fn({ structureId: STRUCTURE_ID });
      expect(rows.map((r) => r.typeId)).toEqual([TRIT]);
      expect(rows[0].iskPerDay).toBe(600); // 100/day x 6
      expect(summary.iskPerDay).toBe(600);
    });

    it('includes an untracked item that sold out, with a quantity to reach target cover', async () => {
      // No orders left, but it sold 50/day — gone from the book, not from demand.
      await seedDaily(TRIT, 1, 50);
      await prisma.referencePrice.create({ data: { typeId: TRIT, bestSell: 5, source: 'fuzzwork' } });

      const { rows, summary } = await reportHandlers.reportUntrackedLowStock.fn({ structureId: STRUCTURE_ID, targetDays: 10 });
      expect(rows.map((r) => r.typeId)).toEqual([TRIT]);
      expect(rows[0].restockQuantity).toBe(500); // 50/day x 10 days - 0 on market
      expect(summary).toMatchObject({ soldOut: 1, estimatedCost: 2500 });
    });
  });

  describe('watchlist write authorisation', () => {
    it('marks every watchlist write as admin-only in the registry', () => {
      // The UI hides these controls, but this is the boundary that counts.
      expect(REGISTRY.upsertMarketWatchItem.auth).toBe('admin');
      expect(REGISTRY.deleteMarketWatchItem.auth).toBe('admin');
      expect(REGISTRY.bulkAddMarketWatchItems.auth).toBe('admin');
      expect(REGISTRY.pollMarketNow.auth).toBe('admin');
    });

    it('leaves reads available to any signed-in character', () => {
      expect(REGISTRY.getMarketBrowse.auth).toBe('auth');
      expect(REGISTRY.getMarketWatchlist.auth).toBe('auth');
      expect(REGISTRY.getMarketItem.auth).toBe('auth');
    });

    it('updates rather than ignores an item that is bulk-pasted again', async () => {
      await marketHandlers.bulkAddMarketWatchItems.fn({
        structureId: STRUCTURE_ID,
        items: [{ typeId: TRIT, itemName: 'Tritanium', minQuantity: 100 }],
      });
      const second = await marketHandlers.bulkAddMarketWatchItems.fn({
        structureId: STRUCTURE_ID,
        items: [{ typeId: TRIT, itemName: 'Tritanium', minQuantity: 500 }],
      });

      expect(second).toMatchObject({ added: 0, updated: 1 });
      const item = await prisma.marketWatchItem.findFirst({ where: { typeId: TRIT } });
      // Re-pasting a revised list is how the minimums get maintained.
      expect(item.minQuantity).toBe(500);
    });

    it('removes several tracked items in one call', async () => {
      await prisma.marketWatchItem.createMany({
        data: [
          { structureId: STRUCTURE_ID, typeId: TRIT, itemName: 'Tritanium' },
          { structureId: STRUCTURE_ID, typeId: PYE, itemName: 'Pyerite' },
        ],
      });
      const all = await prisma.marketWatchItem.findMany();

      const result = await marketHandlers.deleteMarketWatchItem.fn({ ids: all.map((i) => i.id) });
      expect(result.deleted).toBe(2);
      expect(await prisma.marketWatchItem.count()).toBe(0);
    });
  });
});
