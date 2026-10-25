import { test, expect } from '@playwright/test';

/**
 * End-to-end smoke coverage.
 *
 * These run against a built application with no credentials beyond Supabase
 * itself, so they verify the things that must hold regardless of which
 * optional providers are configured: the auth gate, the public pages, and that
 * protected routes cannot be reached by URL.
 *
 * The signed-in journeys live in authenticated.spec.ts and need seeded demo
 * users; they skip themselves when those are absent.
 */

test.describe('unauthenticated access', () => {
  test('redirects the root to the login page', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  });

  test.describe('protected routes', () => {
    const protectedPaths = [
      '/home', '/tasks', '/inbox', '/calendar', '/projects',
      '/team', '/search', '/reports', '/integrations', '/settings', '/notes',
    ];

    for (const path of protectedPaths) {
      test(`refuses ${path} without a session`, async ({ page }) => {
        await page.goto(path);
        await expect(page).toHaveURL(/\/login/);
        // The intended destination is preserved for after sign-in.
        expect(page.url()).toContain(`next=${encodeURIComponent(path)}`);
      });
    }
  });

  test('offers a signup route', async ({ page }) => {
    await page.goto('/signup');
    await expect(page.getByRole('heading', { name: /create your account/i })).toBeVisible();
    await expect(page.getByLabel('Email')).toBeVisible();
    await expect(page.getByLabel('Password')).toBeVisible();
  });

  test('rejects bad credentials without revealing whether the account exists', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill('definitely-not-registered@example.test');
    await page.getByLabel('Password').fill('wrong-password-12345');
    await page.getByRole('button', { name: /sign in/i }).click();

    // Scoped to the form: Next injects its own empty role="alert" region for
    // route announcements, so a bare getByRole('alert') matches two elements.
    const alert = page.locator('form [role="alert"]');
    await expect(alert).toBeVisible();
    // Deliberately generic, so the form cannot be used to enumerate accounts.
    await expect(alert).toContainText(/did not work/i);
  });
});

test.describe('scheduled endpoint', () => {
  test('refuses the cron route without the shared secret', async ({ request }) => {
    const response = await request.get('/api/cron/daily-reports');
    // 401 when a secret is configured, 503 when it is not. Never 200.
    expect([401, 503]).toContain(response.status());
  });

  test('refuses the retry route without the shared secret', async ({ request }) => {
    const response = await request.get('/api/cron/retry-deliveries');
    expect([401, 503]).toContain(response.status());
  });
});

test.describe('webhook endpoint', () => {
  test('refuses an unsigned payload', async ({ request }) => {
    const response = await request.post('/api/webhooks/whatsapp', {
      data: { entry: [{ changes: [{ value: { messages: [{ id: 'forged', from: '919876543210', text: { body: 'Create a task' } }] } }] }] },
    });
    // 401 for a bad signature, 503 when no app secret is configured.
    expect([401, 503]).toContain(response.status());
  });

  test('refuses the verification handshake with a wrong token', async ({ request }) => {
    const response = await request.get(
      '/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=123',
    );
    expect([403, 503]).toContain(response.status());
  });
});

test.describe('accessibility basics', () => {
  test('the login page has a labelled form and a single h1', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.getByLabel('Email')).toBeVisible();
    await expect(page.getByLabel('Password')).toBeVisible();
  });

  test('is usable at phone width without horizontal scroll', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 720 });
    await page.goto('/login');
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    expect(overflow).toBe(false);
  });
});
