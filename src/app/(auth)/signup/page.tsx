import Link from 'next/link';
import { AuthForm } from '../auth-form';

export const metadata = { title: 'Create account' };

export default function SignupPage() {
  return (
    <div>
      <h1 className="text-lg font-semibold text-ink">Create your account</h1>
      <p className="mt-1 mb-5 text-sm text-ink-faint">
        A private personal workspace is created for you automatically.
      </p>
      <AuthForm mode="signup" />
      <p className="mt-4 text-xs text-ink-faint">
        Already registered?{' '}
        <Link href="/login" className="text-accent hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
