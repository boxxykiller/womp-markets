import { useMemo, useState } from 'react';
import { ChevronRight, Folder, FolderOpen, Layers } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * The market-group tree, laid out like the in-game market browser: top-level
 * groups expand into their sub-groups, and picking any node filters to that
 * group and everything beneath it.
 */
export function CategoryTree({ groups = [], selectedId, onSelect, className }) {
  const { children, byId, roots } = useMemo(() => {
    const byId = new Map(groups.map((g) => [g.id, g]));
    const children = new Map();
    const roots = [];
    for (const g of groups) {
      if (g.parentId != null && byId.has(g.parentId)) {
        if (!children.has(g.parentId)) children.set(g.parentId, []);
        children.get(g.parentId).push(g);
      } else {
        roots.push(g);
      }
    }
    return { children, byId, roots };
  }, [groups]);

  const [open, setOpen] = useState(() => new Set());

  // The path to the selected group stays open, so a selection is never hidden.
  const forcedOpen = useMemo(() => {
    const set = new Set();
    let node = byId.get(byId.get(selectedId)?.parentId);
    while (node) {
      set.add(node.id);
      node = byId.get(node.parentId);
    }
    return set;
  }, [byId, selectedId]);

  function toggle(id) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function renderNode(node, depth) {
    const kids = children.get(node.id) ?? [];
    const expanded = open.has(node.id) || forcedOpen.has(node.id);
    const selected = selectedId === node.id;
    return (
      <li key={node.id}>
        <div
          className={cn(
            'flex items-center gap-1 rounded-md pr-2 text-sm cursor-pointer transition-colors',
            selected ? 'bg-[#4A9EFF]/15 text-white' : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200',
          )}
          style={{ paddingLeft: depth * 12 + 4 }}
          onClick={() => {
            onSelect(node.id);
            if (kids.length && !expanded) toggle(node.id);
          }}
        >
          {kids.length ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                toggle(node.id);
              }}
              className="p-0.5 text-slate-500 hover:text-white"
              aria-label={expanded ? 'Collapse' : 'Expand'}
            >
              <ChevronRight className={cn('w-3.5 h-3.5 transition-transform', expanded && 'rotate-90')} />
            </button>
          ) : (
            <span className="w-5" />
          )}
          {expanded ? (
            <FolderOpen className="w-3.5 h-3.5 shrink-0 text-amber-400/80" />
          ) : (
            <Folder className="w-3.5 h-3.5 shrink-0 text-amber-400/60" />
          )}
          <span className="truncate py-1 flex-1">{node.name}</span>
          <span className="text-[11px] text-slate-600 tnum">{node.itemCount}</span>
        </div>
        {expanded && kids.length > 0 && <ul>{kids.map((k) => renderNode(k, depth + 1))}</ul>}
      </li>
    );
  }

  return (
    <div className={cn('rounded-lg border border-slate-800 bg-slate-900/40 p-2 overflow-y-auto scrollbar-thin', className)}>
      <div
        onClick={() => onSelect(null)}
        className={cn(
          'flex items-center gap-2 rounded-md px-2 py-1 mb-1 text-sm cursor-pointer',
          selectedId == null ? 'bg-[#4A9EFF]/15 text-white' : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200',
        )}
      >
        <Layers className="w-3.5 h-3.5 shrink-0" />
        All items
      </div>
      <ul>{roots.map((r) => renderNode(r, 0))}</ul>
    </div>
  );
}
