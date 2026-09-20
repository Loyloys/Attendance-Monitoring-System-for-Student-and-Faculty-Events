import React from 'react';
import { TrendingUp, TrendingDown } from 'lucide-react';

interface AttendanceStatProps {
  title: string;
  value: number | string;
  icon: React.ReactElement;
  trend?: string;
  trendUp?: boolean;
  variant?: 'green' | 'gold' | 'default'; // Aligning with COT theme
}

const AttendanceStat: React.FC<AttendanceStatProps> = ({
  title,
  value,
  icon,
  trend,
  trendUp,
  variant = 'default'
}) => {
  // Mapping variants to COT themed glass styles
  const variantStyles = {
    green: "bg-[#F97316]/5 border-[#F97316]/20 text-[#F97316]",
    gold: "bg-[#EA580C]/5 border-[#EA580C]/20 text-[#EA580C]",
    default: "bg-white/40 border-white/40 text-slate-600"
  };

  return (
    <div className={`
      relative group overflow-hidden
      backdrop-blur-xl rounded-[28px] border p-6
      transition-all duration-500 ease-out
      hover:shadow-2xl hover:shadow-[#F97316]/5 hover:-translate-y-1
      ${variantStyles[variant]}
    `}>
      {/* Liquid background glow on hover */}
      <div className="absolute w-24 h-24 transition-opacity duration-500 bg-current rounded-full opacity-0 -right-4 -top-4 group-hover:opacity-10 blur-3xl" />

      <div className="flex items-start justify-between">
        <div className="space-y-3">
          <p className="text-[13px] font-bold uppercase tracking-widest opacity-70">
            {title}
          </p>
          <div className="flex flex-col">
            <span className="text-4xl font-black tracking-tighter text-slate-900">
              {value}
            </span>
            {trend && (
              <div className={`flex items-center gap-1.5 mt-2 text-[13px] font-bold ${trendUp ? 'text-orange-600' : 'text-slate-500'}`}>
                <div className={`p-1 rounded-full ${trendUp ? 'bg-green-100' : 'bg-slate-100'}`}>
                  {trendUp ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                </div>
                {trend}
              </div>
            )}
          </div>
        </div>

          <div className={`
            p-4 rounded-2xl transition-all duration-500
            ${variant === 'green' ? 'bg-[#F97316] text-white shadow-lg shadow-[#F97316]/20' : 
              variant === 'gold' ? 'bg-[#EA580C] text-white shadow-lg shadow-[#EA580C]/20' : 
              'bg-white/80 text-slate-400 shadow-sm'}
            group-hover:scale-110
          `}>
            {icon}
          </div>
      </div>
    </div>
  );
};

export { AttendanceStat };