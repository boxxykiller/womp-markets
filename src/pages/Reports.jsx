import { useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowLeftRight,
  FileBarChart,
  HeartPulse,
  LineChart as LineChartIcon,
  PackageSearch,
  PackageX,
  Receipt,
  Scale,
  Sparkles,
  Sprout,
  TrendingUp,
} from 'lucide-react';
import { Page, PageHeader } from '@/components/layout/PageHeader';
import { ReportDialog } from '@/components/market/ReportDialog';
import { cn } from '@/lib/utils';

// Period and moving-average choices for the history reports. Market data is
// never pruned, so "All time" reaches back to the first poll.
const PERIOD_OPTIONS = [
  { value: '7', label: '7 days' },
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
  { value: '180', label: '180 days' },
  { value: '365', label: '1 year' },
  { value: '0', label: 'All time' },
];

// Sales windows in UTC days, today included: "1" is today so far.
const SALES_PERIOD_OPTIONS = [
  { value: '1', label: 'Today' },
  { value: '2', label: '2 days' },
  { value: '3', label: '3 days' },
  { value: '7', label: '7 days' },
  { value: '14', label: '14 days' },
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
  { value: '0', label: 'All time' },
  { value: 'custom', label: 'Custom…' },
];

const todayUtc = () => new Date().toISOString().slice(0, 10);
const isCustom = (params) => params.days === 'custom';

const MA_OPTIONS = [
  { value: '3', label: '3-day' },
  { value: '7', label: '7-day' },
  { value: '14', label: '14-day' },
  { value: '30', label: '30-day' },
];

const VERDICT_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'seed', label: 'Seed' },
  { value: 'stale', label: 'Stale' },
  { value: 'ok', label: 'Moving' },
  { value: 'idle', label: 'Idle' },
];

// Each report is a handler name plus how its dialog should present the rows.
// Keeping the definitions declarative means adding a report is one entry here
// plus one server handler, not a new page.
const REPORTS = [
  {
    key: 'restock',
    handler: 'reportRestock',
    title: 'Restock list',
    description: 'Everything below its minimum, with the quantity needed to bring it back to target.',
    icon: AlertTriangle,
    accent: 'rose',
    columns: ['status', 'min', 'volume', 'restock', 'jitaSell', 'lineCost'],
    multibuy: true,
  },
  {
    key: 'trackedSales',
    handler: 'reportTrackedSales',
    title: 'Tracked sales',
    description: 'Every tracked item sold in a chosen time frame, with quantities — copy it as a multibuy to buy back what went out.',
    icon: Receipt,
    accent: 'emerald',
    columns: ['sold', 'unitsConfirmed', 'unitsEstimated', 'volume', 'isk', 'jitaSell', 'lineCost'],
    chart: 'units',
    filters: [
      { key: 'days', label: 'Period', type: 'select', options: SALES_PERIOD_OPTIONS, default: '7' },
      { key: 'from', label: 'From', type: 'date', default: todayUtc(), showWhen: isCustom },
      { key: 'to', label: 'To', type: 'date', default: todayUtc(), showWhen: isCustom },
    ],
    multibuy: true,
  },
  {
    key: 'stockout',
    handler: 'reportStockoutForecast',
    title: 'Stockout forecast',
    description: 'What runs out first, ordered by how many days of stock remain.',
    icon: Activity,
    accent: 'amber',
    columns: ['status', 'volume', 'rate', 'cover', 'stockoutAt'],
    filters: [{ key: 'withinDays', label: 'Within days', type: 'number', default: 30 }],
    multibuy: true,
  },
  {
    key: 'jita',
    handler: 'reportJitaSpread',
    title: 'Jita spread',
    description: 'Where local pricing diverges most from Jita 4-4, in both directions.',
    icon: ArrowLeftRight,
    accent: 'blue',
    columns: ['localSell', 'jitaSell', 'spread', 'volume'],
    filters: [{ key: 'minAbsPct', label: 'Min difference %', type: 'percent', default: 5 }],
  },
  {
    key: 'velocity',
    handler: 'reportVelocity',
    title: 'Velocity',
    description: 'Units and ISK traded per item, with observed and inferred volume shown separately.',
    icon: TrendingUp,
    accent: 'emerald',
    columns: ['unitsConfirmed', 'unitsEstimated', 'units', 'isk', 'perDay'],
    filters: [{ key: 'days', label: 'Window (days)', type: 'number', default: 30 }],
  },
  {
    key: 'dead',
    handler: 'reportDeadStock',
    title: 'Dead stock',
    description: 'Items sitting on the market with no recorded sales, and the ISK tied up in them.',
    icon: PackageX,
    accent: 'slate',
    columns: ['volume', 'localSell', 'iskTiedUp'],
    filters: [{ key: 'days', label: 'No sales in (days)', type: 'number', default: 30 }],
  },
  {
    key: 'balance',
    handler: 'reportBuySellBalance',
    title: 'Buy/sell balance',
    description: 'Depth on each side, to find items nobody is bidding on.',
    icon: Scale,
    accent: 'violet',
    columns: ['buyVolume', 'volume', 'split', 'localBuy', 'localSell'],
  },
  {
    key: 'untrackedMovers',
    handler: 'reportUntrackedMovers',
    title: 'Untracked movers',
    description: 'Items that sell here but are not on the tracked list, ranked by ISK moved per day.',
    icon: Sparkles,
    accent: 'emerald',
    columns: ['rate', 'volume', 'cover', 'localSell', 'jitaSell', 'iskPerDay'],
    chart: 'iskPerDay',
    filters: [{ key: 'minPerDay', label: 'Min sold/day', type: 'number', default: 0 }],
  },
  {
    key: 'untrackedLow',
    handler: 'reportUntrackedLowStock',
    title: 'Untracked low stock',
    description: 'Untracked items that sell and are running out or already gone, with a quantity to reach the target cover.',
    icon: PackageSearch,
    accent: 'amber',
    columns: ['rate', 'volume', 'cover', 'restock', 'jitaSell', 'lineCost'],
    chart: 'restockQuantity',
    filters: [{ key: 'targetDays', label: 'Target days of cover', type: 'number', default: 14 }],
    multibuy: true,
  },
  {
    key: 'seeding',
    handler: 'reportSeedingHistory',
    title: 'Seed or stale',
    description: 'Every item judged on its stored history: what sells but is running dry, and what sits unsold.',
    icon: Sprout,
    accent: 'amber',
    columns: ['verdict', 'volume', 'maRate', 'periodRate', 'volumeTrend', 'maPrice', 'priceTrend', 'jitaRate', 'lastSale', 'historyCover', 'restock', 'lineCost', 'iskTiedUp'],
    chart: 'periodIsk',
    filters: [
      { key: 'days', label: 'Period', type: 'select', options: PERIOD_OPTIONS, default: '30' },
      { key: 'maDays', label: 'Moving avg', type: 'select', options: MA_OPTIONS, default: '7' },
      { key: 'verdict', label: 'Show', type: 'select', options: VERDICT_OPTIONS, default: 'all' },
      { key: 'targetDays', label: 'Target days of cover', type: 'number', default: 14 },
      { key: 'staleDays', label: 'Stale after (days)', type: 'number', default: 14 },
    ],
    multibuy: true,
    opensHistory: true,
  },
  {
    key: 'history',
    handler: 'reportItemHistory',
    title: 'Item history',
    description: "One item's daily volume, price and stock over any period, beside Jita's, with a moving average over each.",
    icon: LineChartIcon,
    accent: 'blue',
    kind: 'history',
    filters: [
      { key: 'days', label: 'Period', type: 'select', options: PERIOD_OPTIONS, default: '90' },
      { key: 'maDays', label: 'Moving avg', type: 'select', options: MA_OPTIONS, default: '7' },
    ],
  },
  {
    key: 'health',
    handler: 'reportDataHealth',
    title: 'Poll & data health',
    description: 'Polling status, how much history exists, and recent SDE builds.',
    icon: HeartPulse,
    accent: 'blue',
    kind: 'health',
  },
];

const ACCENTS = {
  rose: 'from-rose-500/20 to-rose-600/5 border-rose-500/20 text-rose-400',
  amber: 'from-amber-500/20 to-amber-600/5 border-amber-500/20 text-amber-400',
  blue: 'from-blue-500/20 to-blue-600/5 border-blue-500/20 text-blue-400',
  emerald: 'from-emerald-500/20 to-emerald-600/5 border-emerald-500/20 text-emerald-400',
  violet: 'from-violet-500/20 to-violet-600/5 border-violet-500/20 text-violet-400',
  slate: 'from-slate-800/60 to-slate-900/40 border-slate-700/40 text-slate-300',
};

export default function Reports() {
  const [active, setActive] = useState(null);

  return (
    <Page>
      <PageHeader
        icon={FileBarChart}
        accent="emerald"
        title="Reports"
        subtitle="Open a report to filter it, chart it and copy the results"
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {REPORTS.map((report) => {
          const Icon = report.icon;
          return (
            <button
              key={report.key}
              onClick={() => setActive(report)}
              className={cn(
                'rounded-2xl border bg-gradient-to-br p-5 text-left transition-colors hover:border-white/25',
                ACCENTS[report.accent],
              )}
            >
              <div className="w-11 h-11 rounded-xl bg-black/20 flex items-center justify-center mb-3">
                <Icon className="w-5 h-5" />
              </div>
              <h2 className="text-base font-semibold text-white">{report.title}</h2>
              <p className="text-sm text-slate-400 mt-1">{report.description}</p>
            </button>
          );
        })}
      </div>

      <ReportDialog
        report={active}
        open={!!active}
        onOpenChange={(v) => !v && setActive(null)}
        // A row in a history-backed report drills into that item's history,
        // carrying the same period and average across.
        onOpenItem={(item, params) => {
          const history = REPORTS.find((r) => r.key === 'history');
          setActive({ ...history, initialItem: item, initialParams: { days: params.days, maDays: params.maDays } });
        }}
      />
    </Page>
  );
}
