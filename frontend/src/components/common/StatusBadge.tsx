import type { ReactNode } from 'react';
import { AlertCircle, CheckCircle2, Clock, Info } from 'lucide-react';

type StatusType = 'success' | 'warning' | 'error' | 'info' | 'danger';

interface StatusBadgeProps {
  status: StatusType;
  children: ReactNode;
}

const statusConfig: Record<StatusType, { styles: string; icon: ReactNode }> = {
  success: { styles: 'border-emerald-200 bg-emerald-50 text-emerald-700', icon: <CheckCircle2 size={12} /> },
  warning: { styles: 'border-amber-200 bg-amber-50 text-amber-700', icon: <Clock size={12} /> },
  error: { styles: 'border-rose-200 bg-rose-50 text-rose-700', icon: <AlertCircle size={12} /> },
  danger: { styles: 'border-rose-200 bg-rose-50 text-rose-700', icon: <AlertCircle size={12} /> },
  info: { styles: 'border-sky-200 bg-sky-50 text-sky-700', icon: <Info size={12} /> },
};

export function StatusBadge({ status, children }: StatusBadgeProps) {
  const config = statusConfig[status];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.1em] ${config.styles}`}>
      {config.icon}{children}
    </span>
  );
}
