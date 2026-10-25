import Link from 'next/link';
import { AuthForm } from '../auth-form';

export const metadata = { title: 'Sign in' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  return (
    <div>
      <h1 className="text-lg font-semibold text-ink">Sign in</h1>
      <p className="mt-1 mb-5 text-sm text-ink-faint">
        Your personal workspace and any teams you belong to.
      </p>
      <AuthForm mode="signin" next={next} />
      <p className="mt-4 text-xs text-ink-faint">
        No account?{' '}
        <Link href="/signup" className="text-accent hover:underline">
          Create one
        </Link>
      </p>
    </div>
  );
}
