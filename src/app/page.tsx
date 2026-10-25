import { redirect } from 'next/navigation';

export default function RootPage() {
  // The middleware has already decided whether a session exists; by the time a
  // request reaches here it is authenticated.
  redirect('/home');
}
