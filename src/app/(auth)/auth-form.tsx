'use client';

import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { ErrorNotice } from '@/components/ui/feedback';
import { signIn, signUp, type AuthFormState } from './actions';

export function AuthForm({ mode, next }: { mode: 'signin' | 'signup'; next?: string }) {
  const action = mode === 'signin' ? signIn : signUp;
  const [state, formAction, pending] = useActionState<AuthFormState, FormData>(action, {});

  return (
    <form action={formAction} className="space-y-3 rounded-[var(--radius-card)] border border-hairline bg-paper p-4">
      {next ? <input type="hidden" name="next" value={next} /> : null}

      {mode === 'signup' ? (
        <div>
          <Label htmlFor="fullName">Name</Label>
          <Input id="fullName" name="fullName" autoComplete="name" placeholder="Your name" />
        </div>
      ) : null}

      <div>
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" required autoComplete="email" placeholder="you@example.com" />
      </div>

      <div>
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          required
          minLength={8}
          autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
          placeholder="At least 8 characters"
        />
      </div>

      {state.error ? <ErrorNotice title="Could not continue" detail={state.error} /> : null}
      {state.notice ? (
        <p className="rounded-md border border-accent/30 bg-accent-soft px-3 py-2 text-xs text-accent">
          {state.notice}
        </p>
      ) : null}

      <Button type="submit" variant="primary" size="lg" className="w-full" disabled={pending}>
        {pending ? 'Working…' : mode === 'signin' ? 'Sign in' : 'Create account'}
      </Button>
    </form>
  );
}
