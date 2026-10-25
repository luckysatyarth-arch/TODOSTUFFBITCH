import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium leading-4',
  {
    variants: {
      tone: {
        neutral: 'bg-sunken text-ink-soft',
        urgent: 'bg-urgent-soft text-urgent',
        high: 'bg-high-soft text-high',
        medium: 'bg-medium-soft text-medium',
        low: 'bg-low-soft text-low',
        done: 'bg-done-soft text-done',
        blocked: 'bg-blocked-soft text-blocked',
        accent: 'bg-accent-soft text-accent',
        outline: 'border border-hairline-strong text-ink-soft',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

export function Badge({
  className, tone, ...props
}: React.ComponentProps<'span'> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}

export { badgeVariants };
