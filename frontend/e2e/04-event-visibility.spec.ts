import { expect, test } from '@playwright/test';
import { ACCOUNTS, signIn } from './helpers';

/**
 * Event visibility: the audience rule must hold for eligible Students and
 * Faculty, and a cancelled event must not appear as available.
 *
 * The seeded fixture has one `all`, one `student`-only and one `faculty`-only
 * event, so each role's allowed set is distinguishable rather than coincidental.
 */
test.describe('Event visibility for eligible Students and Faculty', () => {
  test('a student sees "all" and student-only events, but not faculty-only', async ({ page }) => {
    await signIn(page, ACCOUNTS.student, 'student');
    await page.goto('/portal?view=events');

    await expect(page.getByRole('heading', { name: 'E2E-LIVE-OPEN' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'E2E-STUDENTS-ONLY' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'E2E-FACULTY-ONLY' })).toHaveCount(0);
  });

  test('faculty sees "all" and faculty-only events, but not student-only', async ({ page }) => {
    await signIn(page, ACCOUNTS.faculty, 'faculty');
    await page.goto('/portal?view=events');

    await expect(page.getByRole('heading', { name: 'E2E-LIVE-OPEN' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'E2E-FACULTY-ONLY' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'E2E-STUDENTS-ONLY' })).toHaveCount(0);
  });

  test('a cancelled event is not offered as an available event', async ({ page }) => {
    await signIn(page, ACCOUNTS.student, 'student');
    await page.goto('/portal?view=events');

    // The domain only stores published or cancelled, so a cancelled event must
    // not be listed as something a student can attend.
    await expect(page.getByRole('heading', { name: 'E2E-CANCELLED' })).toHaveCount(0);
  });

  test('assigned faculty can monitor their event; unassigned faculty cannot', async ({ page }) => {
    // The ASSIGNED faculty member sees the event offered in the monitor picker.
    await signIn(page, ACCOUNTS.faculty, 'faculty');
    await page.goto('/portal?view=monitor');
    await expect(page.getByRole('heading', { name: /monitor assigned events/i })).toBeVisible();
    const picker = page.locator('select').filter({ hasText: 'E2E-LIVE-OPEN' }).first();
    await expect(picker).toBeVisible();
    await expect(picker.locator('option', { hasText: 'E2E-LIVE-OPEN' })).toHaveCount(1);

    // And the server actually lets them read that event's attendance.
    const ok = await page.request.get('/api/events/managed/');
    expect(ok.status()).toBe(200);
    const managed = await ok.json();
    expect(managed.map((event: { name: string }) => event.name)).toContain('E2E-LIVE-OPEN');

    // The UNASSIGNED faculty member is refused by the SERVER for the same event,
    // not merely hidden in the UI. A second session is used so this is a
    // different person's credentials, not a leftover admin cookie.
    const other = await page.context().browser()!.newContext({
      baseURL: test.info().project.use.baseURL,
    });
    const otherPage = await other.newPage();
    await signIn(otherPage, ACCOUNTS.outsiderFaculty, 'faculty');
    const liveId = managed.find((event: { name: string }) => event.name === 'E2E-LIVE-OPEN').id;
    const refused = await otherPage.request.get(`/api/events/${liveId}/attendance/`);
    expect(refused.status(), 'unassigned faculty must be refused the event attendance list').toBe(400);
    // Their own managed list genuinely does not contain the event.
    const theirEvents = await (await otherPage.request.get('/api/events/managed/')).json();
    expect(theirEvents.map((event: { name: string }) => event.name)).not.toContain('E2E-LIVE-OPEN');
    await other.close();
  });
});
