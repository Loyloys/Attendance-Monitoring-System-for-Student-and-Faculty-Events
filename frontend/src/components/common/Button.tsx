import { type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  variant?: 'primary' | 'secondary' | 'gold' | 'glass';
  className?: string;
  isLoading?: boolean;
}

export default function Button({
  children,
  variant = 'primary',
  className = '',
  isLoading = false,
  disabled,
  type = 'button',
  ...props
}: ButtonProps) {
  const base = 'relative inline-flex min-h-10 items-center justify-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold outline-none transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50';
  const variants = {
    primary: 'app-button-primary',
    secondary: 'app-button-secondary',
    gold: 'border border-rose-200 bg-rose-500 text-white shadow-lg shadow-rose-200/50 hover:bg-rose-600 focus-visible:ring-2 focus-visible:ring-rose-400 focus-visible:ring-offset-2',
    glass: 'app-button-secondary',
  };

  return (
    <button type={type} className={`${base} ${variants[variant]} ${className}`} disabled={isLoading || disabled} aria-busy={isLoading} {...props}>
      {isLoading ? <><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /><span className="opacity-80">Processing…</span></> : children}
    </button>
  );
}
