import * as React from 'react';
import { cn } from '@/lib/utils';

const base =
  'w-full rounded-md border border-hairline-strong bg-paper px-2.5 py-1.5 text-sm text-ink ' +
  'placeholder:text-ink-faint focus:border-accent focus:outline-none focus:ring-1 ' +
  'focus:ring-accent disabled:opacity-50';

export function Input({ className, ...props }: React.ComponentProps<'input'>) {
  return <input className={cn(base, 'h-8', className)} {...props} />;
}

export function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return <textarea className={cn(base, 'min-h-20 resize-y', className)} {...props} />;
}

export function Select({ className, ...props }: React.ComponentProps<'select'>) {
  return <select className={cn(base, 'h-8 pr-7', className)} {...props} />;
}

export function Label({ className, ...props }: React.ComponentProps<'label'>) {
  return (
    <label
      className={cn('mb-1 block text-xs font-medium text-ink-soft', className)}
      {...props}
    />
  );
}
