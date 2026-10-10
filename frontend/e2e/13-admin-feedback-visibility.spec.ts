import { expect, test, type Page } from '@playwright/test';
import {
  ACCOUNTS, VENUE, apiWrite, cleanupOwnedEvents, expectAttendanceRecorded, expectIsolatedBackend,
  expectServerHasAttendance, newAttendeeContext, openScanner, ownScanEvent, setLocation,
  signIn, submitCode,
} from './helpers';

/**
 * MUST match an entry in `OWNED_NAME_PREFIXES` in
 * backend/scripts/cleanup-e2e-test-event.mjs.
 */
const OWNED_PREFIX = 'E2E-FEEDBACK-';

/** Distinctive text, so the assertion cannot pass on somebody else's comment. */
const COMMENT = 'Automated regression check: the orientation walkthrough was clear.';
const RATING = 4;

/** Events this spec created, so `afterEach` can remove exactly those. */
let owned: string[] = [];

test.afterEach(() => {
  const created = owned;
  owned = [];
  cleanupOwnedEvents(created);
});

/** Feedback the admin API reports for one event, read through an admin session. */
async function feedbackForEvent(adminPage: Page, eventId: string) {
  const state = await (await adminPage.request.get('/api/admin/state/')).json();
  return (state.feedback ?? []).filter((row: { eventId: string }) => row.eventId === eventId);
}

/**
 * REGRESSION: a student's per-event feedback must be visible to an
 * administrator, for the right event, and must survive a reload.
 *
 * THE DEFECT THIS COVERS. The Portal's "Event feedback" screen posts to
 * `POST /api/events/:id/feedback/`, which writes an `EventFeedback` row. That
 * write was always correct - the row really was stored - but NO administrator
 * route ever read that collection, so `GET /admin/state/` carried no feedback
 * and the "Feedback & evaluations" screen could not show it. A person who
 * submitted feedback was told it had been received and then, correctly from
 * their side, could not find it. The form closing and the success message were
 * never evidence of anything the admin could see, which is exactly why this
 * test asserts through the SERVER as well as the screen.
 *
 * SEPARATE SESSIONS, ON PURPOSE. The student and the administrator are two
 * different people in two different browser contexts, so nothing here can pass
 * because of a leftover admin cookie, and the administrator's view is proven to
 * come from data another session actually wrote.
 *
 * THE EVENT IS OWNED, NOT SHARED. This spec provisions and deletes its own
 * event, so it can never add to or clear feedback on a seeded fixture such as
 * E2E-STUDENTS-ONLY - real submissions that belong to whoever made them. The
 * final assertion below proves that directly by comparing the seeded event's
 * feedback count before and after the run.
 */
test.describe('Student feedback reaches the administrator workspace', () => {
  test('submitted feedback is readable by the admin for that event, and still is after a reload', async ({ page, context, browser }) => {
    await expectIsolatedBackend(page);
    await setLocation(context, VENUE);
    await signIn(page, ACCOUNTS.admin, 'admin');

    const { id: eventId, token, name: eventName } = await ownScanEvent(
      browser,
      OWNED_PREFIX,
      test.info().title,
      { requiredAttendanceMinutes: 1 },
    );
    owned.push(eventId);

    // A second, INDEPENDENT administrator session: it is only ever used to read,
    // and it is the session whose view is asserted on.
    const admin = await browser.newContext({ baseURL: test.info().project.use.baseURL });
    const adminPage = await admin.newPage();
    await signIn(adminPage, ACCOUNTS.admin, 'admin');

    // The seeded event's feedback count is the baseline for the
    // non-destructiveness check at the end.
    const events = await (await adminPage.request.get('/api/admin/events/')).json();
    const seededId = (events as { id: string; name: string }[])
      .find((event) => event.name === 'E2E-STUDENTS-ONLY')?.id ?? '';
    const seededBefore = seededId ? (await feedbackForEvent(adminPage, seededId)).length : 0;

    // --- 1. The student attends, then submits, in their own session -----------
    const student = await newAttendeeContext(browser, test.info().project.use.baseURL!, VENUE, 8);
    const studentPage = await student.newPage();
    await signIn(studentPage, ACCOUNTS.student, 'student');
    await openScanner(studentPage);
    await submitCode(studentPage, token);
    await expectAttendanceRecorded(studentPage);
    // Feedback requires attendance, so the attendance row is asserted first:
    // otherwise a failed check-in would make the feedback step meaningless.
    await expectServerHasAttendance(studentPage, eventId, 1);

    await studentPage.goto('/portal?view=feedback');
    await studentPage.locator('#feedback-event').selectOption(eventId);
    await studentPage.getByRole('button', { name: `${RATING} stars` }).click();
    await studentPage.locator('#feedback-comments').fill(COMMENT);
    await studentPage.getByRole('button', { name: /submit event feedback/i }).click();
    await expect(studentPage.getByText('Thank you. Your event feedback was submitted.')).toBeVisible();

    // --- 2. PERSISTENCE, read from the server rather than the screen ----------
    //
    // The success message above proves the browser got a 201. It does not prove
    // the row is readable by an administrator, which is the actual defect. So
    // the record is now fetched through a DIFFERENT session's admin API.
    await expect
      .poll(async () => (await feedbackForEvent(adminPage, eventId)).length, { timeout: 20_000 })
      .toBe(1);
    const [stored] = await feedbackForEvent(adminPage, eventId);
    expect(stored.comments, 'the stored comment must be the one the student typed').toBe(COMMENT);
    expect(stored.rating).toBe(RATING);
    expect(stored.eventId, 'feedback must be filed against the event it was given for').toBe(eventId);
    // Attributed, like an evaluation response already is: the public account id,
    // never the internal database id.
    expect(stored.attendeeId).toBe(ACCOUNTS.student);
    expect(stored.role).toBe('Student');


    // --- 3. The administrator's own screen shows it, for the RIGHT event -----
    await adminPage.goto('/admin/feedback');
    await expect(adminPage.getByRole('heading', { name: 'Feedback & evaluations' })).toBeVisible();
    const picker = adminPage.getByLabel('Select event feedback');
    await expect(picker).toBeVisible();
    await picker.selectOption({ label: eventName });

    const row = adminPage.locator('[data-testid="feedback-row"]');
    await expect(row).toHaveCount(1);
    await expect(row.getByTestId('feedback-comments')).toHaveText(COMMENT);
    await expect(row.getByTestId('feedback-rating')).toHaveText(`${RATING} / 5`);
    await expect(row).toContainText(ACCOUNTS.student);
    await expect(row).toContainText('Student');
    await expect(adminPage.getByTestId('feedback-summary')).toContainText('1 response');

    // Scoped to the selected event: the same panel must not show this response
    // for a different event, so the fix cannot be "show everything everywhere".
    await picker.selectOption({ label: 'E2E-LIVE-OPEN' });
    await expect(row).toHaveCount(0);
    await expect(adminPage.getByTestId('feedback-summary')).toContainText('0 responses');

    // --- 4. Still there after a full reload ---------------------------------
    await adminPage.goto('/admin/feedback');
    await adminPage.getByLabel('Select event feedback').selectOption({ label: eventName });
    await expect(row).toHaveCount(1);
    await expect(row.getByTestId('feedback-comments')).toHaveText(COMMENT);

    // --- 5. Role restrictions are unchanged ---------------------------------
    // The student session that wrote the feedback must still be refused the
    // administrator read that now carries it. Without this, "admins can see
    // feedback" could have been satisfied by making it public.
    const refused = await studentPage.request.get('/api/admin/state/');
    expect(refused.status(), 'a student must not be able to read administrator state').toBe(403);

    // --- 6. A retry does not create a second response ------------------------
    //
    // The remaining half of the original symptom: the form closing and the
    // success message were never evidence of anything. A person who did not
    // trust that message would very reasonably submit again, and a second
    // accepted response would mean the administrator saw two rows for one
    // event - or, worse, that the first one silently overwrote the second.
    //
    // Both halves are asserted, because either alone is satisfiable by a broken
    // fix: the UI can refuse the retry while the endpoint still accepts it, and
    // the endpoint can refuse it while the form still invites the user to try.
    await studentPage.reload();
    await expect(studentPage.locator('#feedback-event')).toBeVisible();
    // The UI stops a retry at the source: the event is still listed, so the
    // student can see they already answered it, but the option is DISABLED and
    // labelled as such. A disabled option genuinely cannot be picked, which is
    // why this is asserted on the option rather than by selecting it - trying to
    // select it would time out against correct behaviour.
    const answered = studentPage.locator(`#feedback-event option[value="${eventId}"]`);
    await expect(answered).toContainText('already submitted');
    await expect(answered).toBeDisabled();
    // The select re-shows the attended events. After a reload the form
    // re-initialises from the server's list: the answered option is disabled,
    // and the control auto-defaults to the first event still awaiting feedback
    // - or to nothing at all when every attended event has been answered. So
    // the answered event must NEVER come back as the selection (that would be
    // the form inviting the very retry this test refuses), and the submit
    // button follows that selection alone: non-empty selection means a valid,
    // still-unanswered event and the button is enabled for THAT event; empty
    // selection means there is nothing left to answer and the button is
    // disabled. Asserted as a consequence of the selection rather than pinned
    // to one absolute state, because which of the two holds depends on what
    // other specs have this account attend - and either way the endpoint below
    // refuses the retry for the answered event with a 409.
    const selected = await studentPage.locator('#feedback-event').evaluate(
      (el) => el.value,
    );
    expect(selected, 'the answered event must never be re-selected after a reload').not.toBe(eventId);
    const submit = studentPage.getByRole('button', { name: /submit event feedback/i });
    if (selected) {
      await expect(submit).toBeEnabled();
    } else {
      await expect(submit).toBeDisabled();
    }

    // The endpoint refuses the retry too, rather than storing a second response.
    // This is the same session that wrote the first one.
    const retry = await apiWrite(student, 'post', `/api/events/${eventId}/feedback/`, {
      rating: RATING, comments: COMMENT,
    });
    expect(retry.status(), 'a repeated submission must be refused, not stored twice').toBe(409);

    // One response for one attendee on one event, still.
    expect((await feedbackForEvent(adminPage, eventId)).length).toBe(1);

    // --- 7. The spec left real submissions alone ----------------------------
    if (seededId) {
      const seededAfter = (await feedbackForEvent(adminPage, seededId)).length;
      expect(
        seededAfter,
        'this spec must not add to or remove feedback on a seeded event',
      ).toBe(seededBefore);
    }

    await student.close();
    await admin.close();
  });

  /**
   * REGRESSION: a failed admin refresh must not erase what is already displayed.
   *
   * WHY THIS IS ITS OWN TEST. The workspace polls `/admin/state/` on a timer and
   * also on "Refresh now". A transient failure is ordinary - a dropped request,
   * a restarting backend. The dangerous failure mode is not the failed request,
   * it is the UI *reacting* to it by clearing the table: an administrator
   * reviewing feedback would watch real responses vanish and reasonably conclude
   * the records had been deleted. The correct behaviour is to keep the last
   * loaded data on screen and mark it stale, which is what is asserted here.
   *
   * The failure is induced by intercepting the request in the browser, so the
   * backend and the database are untouched and the seeded feedback on
   * E2E-STUDENTS-ONLY is never at risk. The interception is a browser-level
   * route, not a change to any service, and it is removed again at the end so
   * it cannot leak into another spec.
   *
   * The seeded event is READ ONLY here: this test submits nothing and owns no
   * event, so there is nothing for `afterEach` to remove.
   */
  test('a failed refresh keeps the already loaded feedback on screen', async ({ page }) => {
    await expectIsolatedBackend(page);
    await signIn(page, ACCOUNTS.admin, 'admin');

    const events = await (await page.request.get('/api/admin/events/')).json();
    const seeded = (events as { id: string; name: string }[])
      .find((event) => event.name === 'E2E-STUDENTS-ONLY');
    expect(seeded, 'the seeded event this test reads must exist').toBeTruthy();
    const before = await feedbackForEvent(page, seeded!.id);
    expect(before.length, 'this test needs the seeded feedback to already be readable').toBeGreaterThan(0);

    // Real feedback, loaded for real.
    await page.goto('/admin/feedback');
    await page.getByLabel('Select event feedback').selectOption({ label: 'E2E-STUDENTS-ONLY' });
    const row = page.locator('[data-testid="feedback-row"]');
    await expect(row).toHaveCount(before.length);

    // The next refresh of administrator state fails. Only that one request.
    let failed = false;
    await page.route('**/api/admin/state/', async (route) => {
      if (failed) { await route.fallback(); return; }
      failed = true;
      await route.abort('failed');
    });

    await page.getByTestId('admin-refresh-now').click();

    // The UI says the data is stale...
    await expect(page.getByTestId('admin-sync-status'))
      .toContainText('the latest refresh failed', { timeout: 20_000 });
    // ...and, the part that actually matters, it did NOT blank the rows.
    await expect(row).toHaveCount(before.length);
    await expect(page.getByTestId('feedback-summary'))
      .toContainText(`${before.length} ${before.length === 1 ? 'response' : 'responses'}`);

    await page.unroute('**/api/admin/state/');

    // Once the backend is reachable again the same control recovers.
    await page.getByTestId('admin-refresh-now').click();
    await expect(page.getByTestId('admin-sync-status')).not.toContainText('the latest refresh failed');
    await expect(row).toHaveCount(before.length);
  });
});

