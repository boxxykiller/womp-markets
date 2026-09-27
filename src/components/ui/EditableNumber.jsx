import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/**
 * Inline-editable numeric cell. Saves on blur rather than on every keystroke
 * so a half-typed "10" never briefly becomes a minimum of 1.
 */
export function EditableNumber({ value, onSave, title, className }) {
  const [draft, setDraft] = useState(String(value ?? 0));
  const [editing, setEditing] = useState(false);

  if (!editing) {
    return (
      <button
        onClick={(e) => {
          e.stopPropagation();
          setDraft(String(value ?? 0));
          setEditing(true);
        }}
        title={title}
        className={cn('w-full text-right tnum text-slate-300 hover:text-[#4A9EFF] transition-colors', className)}
      >
        {Math.round(value ?? 0).toLocaleString()}
      </button>
    );
  }

  return (
    <Input
      autoFocus
      type="number"
      min="0"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onBlur={() => {
        setEditing(false);
        const next = Number(draft);
        if (Number.isFinite(next) && next !== value) onSave(next);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') setEditing(false);
      }}
      className="h-7 w-24 text-right bg-slate-900 border-slate-700 tnum"
    />
  );
}
