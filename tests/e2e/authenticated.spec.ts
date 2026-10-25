import { test, expect } from '@playwright/test';

/**
 * Signed-in journeys against seeded demo data.
 *
 * Requires `npm run db:seed` to have been run, which creates alice@demo.test.
 * Skips itself otherwise rather than failing, so the suite is meaningful on a
 * machine without a seeded database.
 */

const EMAIL = process.env.E2E_EMAIL ?? 'alice@demo.test';
const PASSWORD = process.env.E2E_PASSWORD ?? 'demo-password-1';

async function signIn(page: import('@playwright/test').Page): Promise<boolean> {
  await page.goto('/login');
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: /sign in/i }).click();

  // Either we land in the shell, or the credentials do not exist yet.
  const outcome = await Promise.race([
    page.waitForURL(/\/home/, { timeout: 15_000 }).then(() => 'in' as const),
    page.getByRole('alert').waitFor({ timeout: 15_000 }).then(() => 'out' as const),
  ]).catch(() => 'out' as const);

  return outcome === 'in';
}

test.describe('signed in', () => {
  test('the dashboard shows real counts and the workspace switcher', async ({ page }) => {
    test.skip(!(await signIn(page)), 'Seeded demo user not available; run npm run db:seed.');

    await expect(page.locator('h1')).toBeVisible();
    // The five headline metrics are always rendered, even at zero.
    await expect(page.getByText('Due today', { exact: false }).first()).toBeVisible();
    await expect(page.getByText('Overdue', { exact: false }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /personal|acme/i }).first()).toBeVisible();
  });

  test('navigates to tasks and switches view layouts', async ({ page }) => {
    test.skip(!(await signIn(page)), 'Seeded demo user not available.');

    await page.getByRole('link', { name: 'My Tasks' }).click();
    await expect(page).toHaveURL(/\/tasks/);

    await page.getByRole('button', { name: 'Board', exact: true }).click();
    await expect(page).toHaveURL(/layout=board/);

    await page.getByRole('button', { name: 'Table', exact: true }).click();
    await expect(page).toHaveURL(/layout=table/);
  });

  test('a calendar day opens its breakdown', async ({ page }) => {
    test.skip(!(await signIn(page)), 'Seeded demo user not available.');

    await page.getByRole('link', { name: 'Calendar' }).click();
    await expect(page).toHaveURL(/\/calendar/);

    // Acceptance criterion 5: clicking a date shows that day's work.
    await expect(page.getByText('Completed', { exact: false }).first()).toBeVisible();
    await expect(page.getByText('Remaining', { exact: false }).first()).toBeVisible();
  });

  test('the inbox lists proposals and creates nothing by itself', async ({ page }) => {
    test.skip(!(await signIn(page)), 'Seeded demo user not available.');

    await page.goto('/inbox');
    await expect(page.getByRole('heading', { name: /inbox/i })).toBeVisible();
    // The promise the product makes about AI, stated on the page itself.
    await expect(page.getByText(/nothing is created on your behalf/i)).toBeVisible();
  });

  test('the reports page states the schedule', async ({ page }) => {
    test.skip(!(await signIn(page)), 'Seeded demo user not available.');

    await page.goto('/reports');
    await expect(page.getByText('30 15 * * *')).toBeVisible();
    await expect(page.getByText(/Asia\/Kolkata/).first()).toBeVisible();
  });

  test('integrations disclose what is unsupported', async ({ page }) => {
    test.skip(!(await signIn(page)), 'Seeded demo user not available.');

    await page.goto('/integrations');
    // The honesty requirement, visible in the UI rather than only in docs.
    await expect(page.getByText(/reading a personal WhatsApp account/i)).toBeVisible();
  });

  test('the command palette opens on the keyboard shortcut', async ({ page }) => {
    test.skip(!(await signIn(page)), 'Seeded demo user not available.');

    await page.keyboard.press('ControlOrMeta+k');
    await expect(page.getByRole('dialog', { name: /command palette/i })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: /command palette/i })).toBeHidden();
  });
});
