import { Toaster as Sonner } from 'sonner';

// Dark-only, matched to the app's popover surface rather than sonner's
// default light theme.
export function Toaster(props) {
  return (
    <Sonner
      theme="dark"
      className="toaster group"
      toastOptions={{
        classNames: {
          toast: 'group toast bg-[#0D1829] text-slate-200 border border-[#1E2D45] shadow-lg',
          description: 'text-slate-400',
          actionButton: 'bg-[#4A9EFF] text-white',
          cancelButton: 'bg-slate-800 text-slate-300',
        },
      }}
      {...props}
    />
  );
}
