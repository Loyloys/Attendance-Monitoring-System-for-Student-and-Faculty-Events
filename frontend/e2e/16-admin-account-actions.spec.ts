import { expect, test } from '@playwright/test';
import { ACCOUNTS, signIn } from './helpers';

test.describe('Admin account actions and signup ID prefill', () => {
  test('user management shows the archive action without blocking or deactivation controls', async ({ page }) => {
    await signIn(page, ACCOUNTS.admin, 'admin');
    await page.goto('/admin/users');

    const row = page.locator('tr').filter({ hasText: ACCOUNTS.student }).first();
    const archive = row.getByRole('button', { name: 'Archive account' });
    await expect(archive).toBeVisible();
    await expect(archive.locator('svg.lucide-archive')).toHaveCount(1);
    await expect(row.getByRole('button', { name: /block account|restore access|deactivate account|reactivate account/i })).toHaveCount(0);
  });

  test('signup review prefills a verified ID suggestion and keeps it editable', async ({ page }) => {
    await signIn(page, ACCOUNTS.admin, 'admin');
    await page.route('**/api/admin/signup-requests/**', route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([{
        id: 'REQ-UI-PREFILL',
        provider: 'email',
        emailVerified: true,
        googleEmail: '2401105160@student.buksu.edu.ph',
        accountId: '2401105160',
        name: 'Verified Applicant',
        department: '',
        phone: '',
        pendingRole: 'student',
        status: 'pending',
        createdAt: null,
        reviewedAt: null,
      }]),
    }));
    await page.goto('/admin/signup-requests');

    const accountId = page.getByTestId('signup-account-id');
    await expect(accountId).toHaveValue('2401105160');
    await expect(accountId).toBeEditable();
    await accountId.fill('2401105161');
    await expect(accountId).toHaveValue('2401105161');
  });
});
