import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * A column heading that sorts its table when clicked. Sits inside any <th>
 * (TableHead or a plain one); `sort` is whatever useSort returns, or any
 * object with the same { key, dir, toggle } shape.
 */
export function SortLabel({ sort, sortKey, first = "asc", align, className, children }) {
  if (!sort) return children

  const active = sort.key === sortKey
  const Icon = !active ? ArrowUpDown : sort.dir === "asc" ? ArrowUp : ArrowDown

  return (
    <button
      type="button"
      onClick={() => sort.toggle(sortKey, first)}
      aria-label={`Sort by ${typeof children === "string" ? children : sortKey}`}
      className={cn(
        "inline-flex items-center gap-1 select-none whitespace-nowrap hover:text-slate-200 transition-colors",
        align === "right" && "flex-row-reverse",
        active && "text-slate-200",
        className
      )}
    >
      {children}
      <Icon className={cn("w-3 h-3 shrink-0", !active && "opacity-40")} />
    </button>
  )
}
