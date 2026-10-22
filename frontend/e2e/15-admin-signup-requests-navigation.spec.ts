import { expect, test } from '@playwright/test';
import { ACCOUNTS, signIn, cleanupOwnedEvents } from './helpers';

/**
 * Verification: the admin signup-requests screen opens and behaves correctly.
 *
 * Covers:
 *  - direct navigation to /admin/signup-requests shows Signup requests section
 *  - sidebar: clicking 'Signup requests' from any section navigates there
 *  - refresh / deep-link: ?section=signups and direct URL both work
 *  - active sidebar item stays consistent with the URL
 *  - loading, empty and error states render without falling back to dashboard
 */
test.describe('Admin signup-requests navigation (AD003.3)', () => {
  test.beforeEach(async () => {
    // A clean seeded event is required so the workspace can load state.
    await cleanupOwnedEvents([]);
  });

  test('direct URL /admin/signup-requests renders the signup-request section', async ({ page }) => {
    await signIn(page, ACCOUNTS.admin, 'admin');
    await page.goto('/admin/signup-requests');
    await expect(page.getByRole('heading', { name: 'Signup requests' })).toBeVisible();
    // The workspace tab should read 'Signups', matching the sidebar active state.
    await expect(page.getByRole('nav').getByRole('button', { name: 'Signups' })).toHaveClass(/bg-[#FFF1E6]/);
  });

  test('sidebar clicking Signup requests navigates to the signup-request section', async ({ page }) => {
    await signIn(page, ACCOUNTS.admin, 'admin');
    // Start on the dashboard.
    await page.goto('/admin/dashboard');
    // Click the sidebar Signup requests item.
    await page.getByRole('navigation').getByRole('button', { name: 'Signup requests' }).click();
    await expect(page).toHaveURL(/\/admin\/signup-requests/);
    await expect(page.getByRole('heading', { name: 'Signup requests' })).toBeVisible();
  });

  test('refresh / deep-link with ?section=signups keeps the correct section', async ({ page }) => {
    await signIn(page, ACCOUNTS.admin, 'admin');
    await page.goto('/admin/signup-requests?section=signups');
    // Direct link, query param and refresh all land on the same section.
    await expect(page.getByRole('heading', { name: 'Signup requests' })).toBeVisible();
    await expect(page.getByRole('navigation').getByRole('button', { name: 'Signups' })).toHaveClass(/bg-[#FFF1E6]/);
  });

  test('sidebar active state is set for signup-requests path', async ({ page }) => {
    await signIn(page, ACCOUNTS.admin, 'admin');
    await page.goto('/admin/users');
    // On users, Signup requests is not active.
    await expect(page.getByRole('navigation').getByRole('button', { name: 'Signup requests' })).not.toHaveClass(/bg-[#FFF1E6]/);
    // Switch to signup-requests.
    await page.goto('/admin/signup-requests');
    await expect(page.getByRole('navigation').getByRole('button', { name: 'Signup requests' })).toHaveClass(/bg-[#FFF1E6]/);
  });

  test('loading state is shown while fetching requests', async ({ page }) => {
    await signIn(page, ACCOUNTS.admin, 'admin');
    await page.goto('/admin/signup-requests');
    // The panel starts in a loading state (backend delay is bounded and short).
    await expect(page.getByTestId('signup-requests-panel')).toContainText('Loading signup requests');
  });

  test('empty state shows when there are no requests', async ({ page, request }) => {
    await signIn(page, ACCOUNTS.admin, 'admin');
    // Fetch an empty list.
    await request.get('/api/admin/signup-requests/');
    await page.goto('/admin/signup-requests');
    await expect(page.getByTestId('signup-requests-panel')).toContainText('No pending signup requests');
  });

  test('error state is shown when the request fails, no fallback to dashboard', async ({ page, request }) => {
    await signIn(page, ACCOUNTS.admin, 'admin');
    // Force a 500 to see the error surface.
    await page.route('**/admin/signup-requests/**', route => route.continue().catch(() => { throw new Error('forced'); }));
    await page.goto('/admin/signup-requests');
    await expect(page.getByTestId('signup-error')).toBeVisible();
    // The dashboard must NOT appear in place.
    await expect(page.getByRole('heading', { name: 'Dashboard' })).not.toBeVisible();
  });

  test('approval and rejection actions still function', async ({ page, request }) => {
    await signIn(page, ACCOUNTS.admin, 'admin');
    // A pre-seeded pending request on the isolated instance.
    const approved = await request.post('/api/admin/signup-requests/REQ-DUMMY/approve/', {
      data: { accountId: 'STU9999', department: 'IT', role: 'Student' },
    });
    expect(approved.status).toBe(201);
    await page.goto('/admin/signup-requests');
    // After approval the request disappears from the pending list.
    await expect(page.getByTestId('signup-requests-panel')).not.toContainText('REQ-DUMMY');
  });

  test('student accounts cannot access admin dashboard', async ({ page }) => {
    await signIn(page, ACCOUNTS.student, 'student');
    await page.goto('/admin/dashboard');
    // Non-admin users are redirected to the unauthorized page.
    await expect(page).toHaveURL(/\/unauthorized/);
    await expect(page.getByRole('heading', { name: 'Access restricted' })).toBeVisible();
  });

  test('faculty accounts cannot access admin dashboard', async ({ page }) => {
    await signIn(page, ACCOUNTS.faculty, 'faculty');
    await page.goto('/admin/dashboard');
    await expect(page).toHaveURL(/\/unauthorized/);
    await expect(page.getByRole('heading', { name: 'Access restricted' })).toBeVisible();
  });

  test('student accounts cannot access any admin section', async ({ page }) => {
    await signIn(page, ACCOUNTS.student, 'student');
    await page.goto('/admin/users');
    await expect(page).toHaveURL(/\/unauthorized/);
    await page.goto('/admin/events');
    await expect(page).toHaveURL(/\/unauthorized/);
    await page.goto('/admin/attendance');
    await expect(page).toHaveURL(/\/unauthorized/);
    await page.goto('/admin/reports');
    await expect(page).toHaveURL(/\/unauthorized/);
  });

  test('non-existent role cannot access admin dashboard', async ({ page }) => {
    await signIn(page, ACCOUNTS.outsider, 'student');
    await page.goto('/admin/dashboard');
    await expect(page).toHaveURL(/\/unauthorized/);
    await expect(page.getByRole('heading', { name: 'Access restricted' })).toBeVisible();
  });
});
