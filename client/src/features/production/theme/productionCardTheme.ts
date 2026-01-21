/**
 * Production Card Theme Configuration
 * 
 * Themeable color palette for production job cards.
 * Can be wired to Settings UI later.
 */

export interface ProductionCardTheme {
  base: {
    border: string;
    hover: string;
  };
  dueToday: {
    outline: string;
    glow: string;
  };
  overdue: {
    outline: string;
    glow: string;
  };
  priority: {
    accent: string;
  };
}

export const productionCardTheme: ProductionCardTheme = {
  base: {
    border: 'border-border',
    hover: 'hover:shadow-md',
  },
  dueToday: {
    outline: 'ring-2 ring-amber-400/50',
    glow: 'shadow-amber-400/20',
  },
  overdue: {
    outline: 'ring-2 ring-red-500/60',
    glow: 'shadow-red-500/30',
  },
  priority: {
    accent: 'border-l-4 border-l-blue-500',
  },
};

/**
 * Status color mapping for status bullet
 */
export const statusColors = {
  queued: {
    dot: 'bg-slate-400',
    label: 'text-slate-600',
    hover: 'hover:bg-slate-100',
  },
  in_progress: {
    dot: 'bg-blue-500',
    label: 'text-blue-600',
    hover: 'hover:bg-blue-50',
  },
  done: {
    dot: 'bg-green-500',
    label: 'text-green-600',
    hover: 'hover:bg-green-50',
  },
} as const;

/**
 * Compute urgency level for a job based on due date
 */
export function computeUrgency(dueDate: string | null): 'overdue' | 'due_today' | 'normal' {
  if (!dueDate) return 'normal';
  
  const now = new Date();
  const due = new Date(dueDate);
  
  // Reset time components for today comparison
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate());
  
  if (dueDay < today) return 'overdue';
  if (dueDay.getTime() === today.getTime()) return 'due_today';
  return 'normal';
}
