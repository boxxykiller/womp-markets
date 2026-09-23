// The poller's diff is where every "how fast does this sell" number in the
// app comes from, and none of it is verifiable against ESI — CCP confirms no
// fills for structure markets. These tests pin the inference rules.
//
// Skipped unless DATABASE_URL_TEST is set, so `npm test` works on a bare
// checkout without a database.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const hasDb = !!process.env.DATABASE_URL_TEST;
const describeDb = hasDb ? describe : describe.skip;

let prisma;
let pollSource;
let esiFetchPagedMock;

const STRUCTURE_ID = '1000000000001';
const READER = 'Test Reader';

// The poller reaches ESI through esiClient, so the whole network boundary is
// stubbed there — one seam, and the diff logic under test is untouched.
vi.mock('../../server/src/lib/esiClient.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    esiFetch: vi.fn(async () => null),
    esiFetchPaged: vi.fn(async () => []),
  };
});

function order({ orderId, typeId = 34, isBuy = false, price = 100, remain = 1000, total = 1000, issuedDaysAgo = 1, duration = 90 }) {
  return {
    order_id: Number(orderId),
    type_id: typeId,
    is_buy_order: isBuy,
    price,
    volume_remain: remain,
    volume_total: total,
    min_volume: 1,
    range: 'station',
    duration,
    issued: new Date(Date.now() - issuedDaysAgo * 86400000).toISOString(),
    location_id: STRUCTURE_ID,
  };
}

async function pollWith(orders, sourceId) {
  esiFetchPagedMock.mockResolvedValueOnce(orders);
  return pollSource(sourceId);
}

// Scoped to this suite's own structure id rather than truncating the tables:
// the integration suites share one database, and a blanket deleteMany would
// pull fixtures out from under any other suite.
async function resetData() {
  const scope = { where: { structureId: STRUCTURE_ID } };
  await prisma.marketOrderEvent.deleteMany(scope);
  await prisma.marketOrderArchive.deleteMany(scope);
  await prisma.marketOrder.deleteMany(scope);
  await prisma.marketDailyStat.deleteMany(scope);
  await prisma.marketSnapshot.deleteMany(scope);
  await prisma.marketWatchItem.deleteMany(scope);
  await prisma.marketSource.deleteMany(scope);
}

async function createSource(overrides = {}) {
  return prisma.marketSource.create({
    data: {
      structureId: STRUCTURE_ID,
      sourceType: 'structure',
      readerCharacterName: READER,
      pollIntervalMinutes: 15,
      ...overrides,
    },
  });
}

describeDb('market poller diff', () => {
  beforeAll(async () => {
    ({ prisma } = await import('../../server/src/db/prisma.js'));
    ({ pollSource } = await import('../../server/src/lib/marketPoller.js'));
    ({ esiFetchPaged: esiFetchPagedMock } = await import('../../server/src/lib/esiClient.js'));

    await prisma.eveCharacter.deleteMany({ where: { characterName: READER } });
    await prisma.eveCharacter.create({
      data: {
        characterId: '90000001',
        characterName: READER,
        ownerKey: '90000001',
        accessToken: 'test-token',
        refreshToken: 'test-refresh',
        // Far future, so ensureFreshToken never tries to refresh over the
        // network during a test.
        expiresAt: new Date(Date.now() + 86400000),
      },
    });
  });

  afterAll(async () => {
    await resetData();
    await prisma.eveCharacter.deleteMany({ where: { characterName: READER } });
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await resetData();
    esiFetchPagedMock.mockReset();
  });

  it('records every order as new on a first poll, with no fills', async () => {
    const source = await createSource();
    const result = await pollWith([order({ orderId: 1 }), order({ orderId: 2, isBuy: true, price: 90 })], source.id);

    expect(result.ok).toBe(true);
    expect(await prisma.marketOrder.count()).toBe(2);

    const events = await prisma.marketOrderEvent.findMany();
    expect(events).toHaveLength(2);
    expect(events.every((e) => e.eventType === 'new')).toBe(true);
  });

  it('emits no events when the book is unchanged', async () => {
    const source = await createSource();
    const book = [order({ orderId: 1 })];
    await pollWith(book, source.id);
    await prisma.marketOrderEvent.deleteMany({});

    await pollWith(book, source.id);
    expect(await prisma.marketOrderEvent.count()).toBe(0);
  });

  it('counts a reduced volume as a confirmed fill of exactly the difference', async () => {
    const source = await createSource();
    await pollWith([order({ orderId: 1, remain: 1000, price: 100 })], source.id);
    await pollWith([order({ orderId: 1, remain: 600, price: 100 })], source.id);

    const fill = await prisma.marketOrderEvent.findFirst({ where: { eventType: 'fill' } });
    expect(fill).toMatchObject({ volume: 400, price: 100 });

    const stat = await prisma.marketDailyStat.findFirst({ where: { typeId: 34 } });
    expect(stat.unitsSoldConfirmed).toBe(400);
    // Confirmed volume must never leak into the estimated column.
    expect(stat.unitsSoldEstimated).toBe(0);
    expect(stat.iskTradedConfirmed).toBe(40000);
  });

  it('treats a vanished best-priced order as an estimated fill, not a confirmed one', async () => {
    const source = await createSource();
    await pollWith([order({ orderId: 1, price: 100, remain: 500 }), order({ orderId: 2, price: 120, remain: 500 })], source.id);
    // The 100 ISK ask was the best sell, so its disappearance is most likely
    // someone buying it out.
    await pollWith([order({ orderId: 2, price: 120, remain: 500 })], source.id);

    const est = await prisma.marketOrderEvent.findFirst({ where: { eventType: 'fill_estimated' } });
    expect(est).toMatchObject({ volume: 500, price: 100 });

    const stat = await prisma.marketDailyStat.findFirst({ where: { typeId: 34 } });
    expect(stat.unitsSoldEstimated).toBe(500);
    // Kept strictly apart from observed fills.
    expect(stat.unitsSoldConfirmed).toBe(0);
  });

  it('treats a vanished non-best order as cancelled, attributing no volume', async () => {
    const source = await createSource();
    await pollWith([order({ orderId: 1, price: 100 }), order({ orderId: 2, price: 120 })], source.id);
    // The 120 ISK ask was never the cheapest, so nobody bought it out.
    await pollWith([order({ orderId: 1, price: 100 })], source.id);

    expect(await prisma.marketOrderEvent.count({ where: { eventType: 'cancelled' } })).toBe(1);
    const stat = await prisma.marketDailyStat.findFirst({ where: { typeId: 34 } });
    expect(stat.unitsSoldConfirmed + stat.unitsSoldEstimated).toBe(0);
  });

  it('treats an order past its duration as expired, not as a sale', async () => {
    const source = await createSource();
    // Issued 91 days ago on a 90-day order: it aged out rather than sold.
    await pollWith([order({ orderId: 1, price: 100, issuedDaysAgo: 91, duration: 90 })], source.id);
    await pollWith([], source.id);

    expect(await prisma.marketOrderEvent.count({ where: { eventType: 'expired' } })).toBe(1);
    expect(await prisma.marketOrderEvent.count({ where: { eventType: 'fill_estimated' } })).toBe(0);

    const stat = await prisma.marketDailyStat.findFirst({ where: { typeId: 34 } });
    expect(stat.unitsSoldEstimated).toBe(0);
  });

  it('records a price change with the previous price', async () => {
    const source = await createSource();
    await pollWith([order({ orderId: 1, price: 100 })], source.id);
    await pollWith([order({ orderId: 1, price: 95 })], source.id);

    const change = await prisma.marketOrderEvent.findFirst({ where: { eventType: 'price_change' } });
    expect(change).toMatchObject({ price: 95, prevPrice: 100 });
  });

  it('attributes no fills at all when too many ticks were missed', async () => {
    const source = await createSource({ pollIntervalMinutes: 15 });
    await pollWith([order({ orderId: 1, price: 100, remain: 500 })], source.id);

    // Backdate the last poll well beyond 3x the interval: the server was
    // down, and anything could have happened to that order in the gap.
    await prisma.marketSource.update({
      where: { id: source.id },
      data: { lastPolledAt: new Date(Date.now() - 10 * 60 * 60 * 1000) },
    });
    await prisma.marketDailyStat.deleteMany({});
    await pollWith([], source.id);

    expect(await prisma.marketOrderEvent.count({ where: { eventType: 'fill_estimated' } })).toBe(0);
    expect(await prisma.marketOrderEvent.count({ where: { eventType: 'cancelled' } })).toBe(0);

    // The order is still archived — the row isn't lost, it's just unattributed.
    const archived = await prisma.marketOrderArchive.findFirst({ where: { orderId: '1' } });
    expect(archived.endState).toBe('unknown');
  });

  describe('order archive', () => {
    it('archives every disappearance exactly once, with its end state', async () => {
      const source = await createSource();
      await pollWith(
        [order({ orderId: 1, price: 100 }), order({ orderId: 2, price: 120 }), order({ orderId: 3, price: 130, issuedDaysAgo: 91, duration: 90 })],
        source.id,
      );
      await pollWith([order({ orderId: 2, price: 120 })], source.id);

      const archived = await prisma.marketOrderArchive.findMany({ orderBy: { orderId: 'asc' } });
      expect(archived).toHaveLength(2);
      expect(archived.find((a) => a.orderId === '1').endState).toBe('filled_estimated');
      expect(archived.find((a) => a.orderId === '3').endState).toBe('expired');
      // Order 2 is still live, so it must not be archived yet.
      expect(archived.find((a) => a.orderId === '2')).toBeUndefined();
    });

    it('keeps the volumes needed to tell how much of the order traded', async () => {
      const source = await createSource();
      await pollWith([order({ orderId: 1, price: 100, remain: 1000, total: 1000 })], source.id);
      await pollWith([order({ orderId: 1, price: 100, remain: 250, total: 1000 })], source.id);
      await pollWith([], source.id);

      const archived = await prisma.marketOrderArchive.findFirst({ where: { orderId: '1' } });
      // 250 of the original 1000 left when it vanished — 75% traded.
      expect(archived).toMatchObject({ volumeRemain: 250, volumeTotal: 1000 });
    });
  });

  describe('daily rollup', () => {
    it('accumulates across polls within one UTC day and tracks the extremes', async () => {
      const source = await createSource();
      await pollWith([order({ orderId: 1, price: 100, remain: 1000 })], source.id);
      await pollWith([order({ orderId: 1, price: 90, remain: 800 })], source.id);
      await pollWith([order({ orderId: 1, price: 110, remain: 700 })], source.id);

      const stat = await prisma.marketDailyStat.findFirst({ where: { typeId: 34 } });
      expect(stat.unitsSoldConfirmed).toBe(300); // 200 + 100
      expect(stat.sampleCount).toBe(3);
      // The day's cheapest ask, even though the price has since risen.
      expect(stat.lowSell).toBe(90);
    });

    it('records the end-of-poll book size and order counts', async () => {
      const source = await createSource();
      await pollWith(
        [order({ orderId: 1, remain: 600 }), order({ orderId: 2, remain: 400 }), order({ orderId: 3, isBuy: true, price: 80, remain: 50 })],
        source.id,
      );

      const stat = await prisma.marketDailyStat.findFirst({ where: { typeId: 34 } });
      expect(stat).toMatchObject({ endSellVolume: 1000, endBuyVolume: 50, sellOrderCount: 2, buyOrderCount: 1 });
      expect(stat.highBuy).toBe(80);
    });
  });

  it('snapshots tracked items only', async () => {
    const source = await createSource();
    await prisma.marketWatchItem.create({
      data: { structureId: STRUCTURE_ID, typeId: 34, itemName: 'Tritanium', minQuantity: 100 },
    });

    await pollWith([order({ orderId: 1, typeId: 34, remain: 500 }), order({ orderId: 2, typeId: 35, remain: 700 })], source.id);

    const snapshots = await prisma.marketSnapshot.findMany();
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toMatchObject({ typeId: 34, sellVolume: 500 });
  });

  it('records the failure on the source instead of throwing when ESI is unreachable', async () => {
    const source = await createSource();
    esiFetchPagedMock.mockRejectedValueOnce(new Error('ESI 403: no docking access'));

    const result = await pollSource(source.id);
    expect(result.error).toContain('no docking access');

    const after = await prisma.marketSource.findUnique({ where: { id: source.id } });
    expect(after.lastPollStatus).toBe('error');
    expect(after.lastPollError).toContain('no docking access');
  });
});
