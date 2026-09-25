import type { ReactNode } from 'react';
import { AlertCircle, CheckCircle2, Clock, Info } from 'lucide-react';

type StatusType = 'success' | 'warning' | 'error' | 'info' | 'danger';

interface StatusBadgeProps {
  status: StatusType;
  children: ReactNode;
}

const statusConfig: Record<StatusType, { styles: string; icon: ReactNode }> = {
  success: { styles: 'border-emerald-400/15 bg-emerald-400/[0.08] text-emerald-300', icon: <CheckCircle2 size={12} /> },
  warning: { styles: 'border-amber-400/15 bg-amber-400/[0.08] text-amber-300', icon: <Clock size={12} /> },
  error: { styles: 'border-rose-400/15 bg-rose-400/[0.08] text-rose-300', icon: <AlertCircle size={12} /> },
  danger: { styles: 'border-rose-400/15 bg-rose-400/[0.08] text-rose-300', icon: <AlertCircle size={12} /> },
  info: { styles: 'border-blue-400/15 bg-blue-400/[0.08] text-blue-300', icon: <Info size={12} /> },
};

export function StatusBadge({ status, children }: StatusBadgeProps) {
  const config = statusConfig[status];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.1em] ${config.styles}`}>
      {config.icon}{children}
    </span>
  );
}
