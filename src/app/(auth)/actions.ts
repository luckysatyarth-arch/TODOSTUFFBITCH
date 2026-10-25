'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { publicEnv } from '@/lib/env';

const credentials = z.object({
  email: z.string().email('Enter a valid email address'),
  password: z.string().min(8, 'Use at least 8 characters'),
  fullName: z.string().trim().max(120).optional(),
  next: z.string().startsWith('/').max(200).optional(),
});

export interface AuthFormState {
  error?: string;
  notice?: string;
}

function readForm(formData: FormData) {
  return credentials.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
    fullName: formData.get('fullName') ?? undefined,
    // Only relative paths, so `next` cannot be used as an open redirect.
    next: (formData.get('next') as string | null) ?? undefined,
  });
}

export async function signIn(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const parsed = readForm(formData);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the form and try again.' };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error) {
    // Deliberately generic: a precise message would let an attacker probe
    // which addresses are registered.
    return { error: 'That email and password combination did not work.' };
  }

  revalidatePath('/', 'layout');
  redirect(parsed.data.next ?? '/home');
}

export async function signUp(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const parsed = readForm(formData);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the form and try again.' };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { full_name: parsed.data.fullName ?? null },
      emailRedirectTo: `${publicEnv.NEXT_PUBLIC_APP_URL}/auth/callback`,
    },
  });

  if (error) return { error: error.message };

  // A project with email confirmation enabled returns a user with no session.
  // Say so rather than redirecting into a shell the user cannot load.
  if (data.user && !data.session) {
    return {
      notice:
        'Check your inbox to confirm your email address, then sign in. ' +
        '(Project owners can turn confirmation off under Authentication → Sign In / Providers.)',
    };
  }

  revalidatePath('/', 'layout');
  redirect('/home');
}

export async function signOut() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  revalidatePath('/', 'layout');
  redirect('/login');
}
