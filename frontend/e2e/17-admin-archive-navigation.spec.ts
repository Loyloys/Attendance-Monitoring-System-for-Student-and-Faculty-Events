import { expect, test } from '@playwright/test';
import { ACCOUNTS, apiWrite, cleanupOwnedEvents, signIn } from './helpers';

/**
 * Verification: the admin Archive screen opens and behaves correctly.
 *
 * Covers:
 *  - direct navigation to /admin/archive renders the Archive section
 *  - sidebar: clicking 'Archive' from any section navigates there
 *  - refresh / deep-link: direct URL works after browser refresh
 *  - active sidebar item stays consistent with the URL
 *  - Archive loads archived events from /admin/archive/, not from the active-events response
 *  - Archive details are read-only: no Edit/Create/Cancel/Archive buttons, Restore preserved
 *  - Dashboard section still renders correctly at /admin/dashboard
 *  - Events section still renders correctly at /admin/events
 */
test.describe('Admin archive navigation (AD028)', () => {
  test.beforeEach(async () => {
    await cleanupOwnedEvents([]);
  });

  test('direct URL /admin/archive renders the Archive section', async ({ page }) => {
    await signIn(page, ACCOUNTS.admin, 'admin');
    await page.goto('/admin/archive');
    // The Archive heading should be visible.
    await expect(page.getByRole('heading', { name: 'Archive' })).toBeVisible();
    // The workspace tab should read 'Archive', matching the sidebar active state.
    await expect(page.getByRole('navigation').getByRole('button', { name: 'Archive' })).toHaveClass(/bg-[#FFF1E6]/);
    // The Dashboard heading must NOT appear in place.
    await expect(page.getByRole('heading', { name: 'Dashboard' })).not.toBeVisible();
    // The Event Management heading must NOT appear in place.
    await expect(page.getByRole('heading', { name: 'Event management' })).not.toBeVisible();
    // No edit/create/cancel/archive buttons should be present in Archive view.
    await expect(page.getByRole('button', { name: 'Create event' })).not.toBeVisible();
    await expect(page.getByRole('button', { name: /Edit/ })).not.toBeVisible();
  });

  test('sidebar clicking Archive navigates to the archive section', async ({ page }) => {
    await signIn(page, ACCOUNTS.admin, 'admin');
    // Start on the dashboard.
    await page.goto('/admin/dashboard');
    // Click the sidebar Archive item.
    await page.getByRole('navigation').getByRole('button', { name: 'Archive' }).click();
    await expect(page).toHaveURL(/\\/admin\\/archive/);
    await expect(page.getByRole('heading', { name: 'Archive' })).toBeVisible();
  });

  test('refresh keeps the Archive section', async ({ page }) => {
    await signIn(page, ACCOUNTS.admin, 'admin');
    await page.goto('/admin/archive');
    await expect(page.getByRole('heading', { name: 'Archive' })).toBeVisible();
    // Browser refresh must keep the Archive section.
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Archive' })).toBeVisible();
    await expect(page.getByRole('navigation').getByRole('button', { name: 'Archive' })).toHaveClass(/bg-[#FFF1E6]/);
  });

  test('sidebar active state is set for archive path', async ({ page }) => {
    await signIn(page, ACCOUNTS.admin, 'admin');
    await page.goto('/admin/events');
    // On events, Archive is not active.
    await expect(page.getByRole('navigation').getByRole('button', { name: 'Archive' })).not.toHaveClass(/bg-[#FFF1E6]/);
    // Switch to archive.
    await page.goto('/admin/archive');
    await expect(page.getByRole('navigation').getByRole('button', { name: 'Archive' })).toHaveClass(/bg-[#FFF1E6]/);
  });

  test('empty state shows when there are no archived events', async ({ page }) => {
    await signIn(page, ACCOUNTS.admin, 'admin');
    await page.goto('/admin/archive');
    await expect(page.getByText('No archived events.')).toBeVisible();
  });

  test('dashboard still renders correctly at /admin/dashboard', async ({ page }) => {
    await signIn(page, ACCOUNTS.admin, 'admin');
    await page.goto('/admin/dashboard');
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    await expect(page.getByRole('navigation').getByRole('button', { name: 'Dashboard' })).toHaveClass(/bg-[#FFF1E6]/);
  });

  test('events section still renders correctly at /admin/events', async ({ page }) => {
    await signIn(page, ACCOUNTS.admin, 'admin');
    await page.goto('/admin/events');
    await expect(page.getByRole('heading', { name: 'Event management' })).toBeVisible();
    await expect(page.getByRole('navigation').getByRole('button', { name: 'Events' })).toHaveClass(/bg-[#FFF1E6]/);
  });

  test('student accounts cannot access admin archive', async ({ page }) => {
    await signIn(page, ACCOUNTS.student, 'student');
    await page.goto('/admin/archive');
    await expect(page).toHaveURL(/\\/unauthorized/);
  });

  test('archived events do not appear in Event Management', async ({ page }) => {
    await signIn(page, ACCOUNTS.admin, 'admin');
    const context = page.context();
    const eventName = `E2E-ARCHIVE-EXCLUDE-${Date.now()}`;

    // Provision a live event via the API, then archive it.
    const eventId = await apiWrite(context, 'post', '/api/admin/events/', {
      name: eventName,
      description: 'Temporary fixture owned by an automated browser spec.',
      date: '2026-12-01',
      start: '09:00',
      end: '11:00',
      cutoff: '08:45',
      status: 'published',
      method: 'qr',
      audience: 'all',
      requiredForAttendance: false,
      venue: 'Synthetic test venue (automated browser run)',
      requiredAttendanceMinutes: null,
      venueLatitude: 14.5995,
      venueLongitude: 120.9842,
      venueRadiusMeters: 150,
      locationVerificationRequired: true,
    });
    await apiWrite(context, 'post', `/api/admin/events/${eventId}/archive/`);

    // Event Management must NOT list the archived event.
    await page.goto('/admin/events');
    await expect(page.getByRole('heading', { name: 'Event management' })).toBeVisible();
    await expect(page.getByText(eventName)).not.toBeVisible();

    // Clean up: restore so the event is no longer archived, then it can be cleaned.
    await apiWrite(context, 'post', `/api/admin/events/${eventId}/restore/`);
  });

  test('archived events appear in the Archive page', async ({ page }) => {
    await signIn(page, ACCOUNTS.admin, 'admin');
    const context = page.context();
    const eventName = `E2E-ARCHIVE-INCLUDE-${Date.now()}`;

    const eventId = await apiWrite(context, 'post', '/api/admin/events/', {
      name: eventName,
      description: 'Temporary fixture owned by an automated browser spec.',
      date: '2026-12-01',
      start: '09:00',
      end: '11:00',
      cutoff: '08:45',
      status: 'published',
      method: 'qr',
      audience: 'all',
      requiredForAttendance: false,
      venue: 'Synthetic test venue (automated browser run)',
      requiredAttendanceMinutes: null,
      venueLatitude: 14.5995,
      venueLongitude: 120.9842,
      venueRadiusMeters: 150,
      locationVerificationRequired: true,
    });
    await apiWrite(context, 'post', `/api/admin/events/${eventId}/archive/`);

    // Archive page must list the archived event.
    await page.goto('/admin/archive');
    await expect(page.getByRole('heading', { name: 'Archive' })).toBeVisible();
    await expect(page.getByText(eventName)).toBeVisible();

    // Clean up: restore so the event is no longer archived.
    await apiWrite(context, 'post', `/api/admin/events/${eventId}/restore/`);
  });

  test('restoring an event moves it from Archive back to Event Management', async ({ page }) => {
    await signIn(page, ACCOUNTS.admin, 'admin');
    const context = page.context();
    const eventName = `E2E-ARCHIVE-RESTORE-${Date.now()}`;

    const eventId = await apiWrite(context, 'post', '/api/admin/events/', {
      name: eventName,
      description: 'Temporary fixture owned by an automated browser spec.',
      date: '2026-12-01',
      start: '09:00',
      end: '11:00',
      cutoff: '08:45',
      status: 'published',
      method: 'qr',
      audience: 'all',
      requiredForAttendance: false,
      venue: 'Synthetic test venue (automated browser run)',
      requiredAttendanceMinutes: null,
      venueLatitude: 14.5995,
      venueLongitude: 120.9842,
      venueRadiusMeters: 150,
      locationVerificationRequired: true,
    });
    await apiWrite(context, 'post', `/api/admin/events/${eventId}/archive/`);

    // Initially in Archive, not in Event Management.
    await page.goto('/admin/archive');
    await expect(page.getByRole('heading', { name: 'Archive' })).toBeVisible();
    await expect(page.getByText(eventName)).toBeVisible();

    await page.goto('/admin/events');
    await expect(page.getByRole('heading', { name: 'Event management' })).toBeVisible();
    await expect(page.getByText(eventName)).not.toBeVisible();

    // Restore via the Archive page UI (click Restore button on the archived card).
    await page.goto('/admin/archive');
    const restoreButton = page.getByRole('button', { name: /Restore/ }).first();
    await expect(restoreButton).toBeVisible();
    await restoreButton.click();

    // After restore: gone from Archive, back in Event Management.
    await expect(page.getByText(eventName)).not.toBeVisible();
    await page.goto('/admin/events');
    await expect(page.getByRole('heading', { name: 'Event management' })).toBeVisible();
    await expect(page.getByText(eventName)).toBeVisible();

    // Clean up: restore again is a no-op (already restored). Leave the restored
    // event in the database as a live event (harmless test fixture).
  });
});
