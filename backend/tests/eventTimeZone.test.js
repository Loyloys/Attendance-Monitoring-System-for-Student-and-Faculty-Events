import assert from 'node:assert/strict';
import test, { describe } from 'node:test';

import {
  EVENT_TIME_ZONE,
  assertManilaOffsetIsStable,
  manilaDate,
  manilaTime,
  manilaWallClockToInstant,
} from '../src/utils/eventTimeZone.js';

/**
 * The eight-hour event-schedule bug.
 *
 * The API used to parse an administrator's `Date` + `Start time` + `End time`
 * fields as UTC, by appending `Z`. "5:25 PM" in the Philippines was therefore
 * stored as 17:25Z instead of 09:25Z, and every attendee's card showed the event
 * eight hours late. These tests pin the conversion in both directions.
 */

describe('event time zone', () => {
  test('Asia/Manila is UTC+8, and the server refuses to start if that changes', () => {
    assert.equal(EVENT_TIME_ZONE, 'Asia/Manila');
    assert.equal(assertManilaOffsetIsStable(), 8);
  });

  test('an evening wall-clock is stored as the correct UTC instant', () => {
    // THE REPORTED BUG, exactly: 5:25 PM Manila on 4 Oct 2026.
    const instant = manilaWallClockToInstant('2026-10-04', '17:25');
    assert.equal(instant.toISOString(), '2026-10-04T09:25:00.000Z');
  });

  test('a morning wall-clock is not shifted across the previous UTC day', () => {
    const instant = manilaWallClockToInstant('2026-10-04', '09:25');
    assert.equal(instant.toISOString(), '2026-10-04T01:25:00.000Z');
  });

  test('just after midnight in Manila is the PREVIOUS day in UTC', () => {
    // The midnight-crossing case: 00:30 on 4 Oct Manila is 16:30 on 3 Oct UTC.
    // A UTC parser would have stored 4 Oct 00:30Z and shown it as 8:30 AM.
    const instant = manilaWallClockToInstant('2026-10-04', '00:30');
    assert.equal(instant.toISOString(), '2026-10-03T16:30:00.000Z');
    assert.equal(manilaDate(instant), '2026-10-04', 'still 4 Oct once read back in Manila');
    assert.equal(manilaTime(instant), '00:30');
  });

  test('just before midnight in Manila is the same day in UTC', () => {
    const instant = manilaWallClockToInstant('2026-10-04', '23:59');
    assert.equal(instant.toISOString(), '2026-10-04T15:59:00.000Z');
  });

  test('midnight and noon are exact, with no rounding drift', () => {
    assert.equal(manilaWallClockToInstant('2026-10-04', '00:00').toISOString(), '2026-10-03T16:00:00.000Z');
    assert.equal(manilaWallClockToInstant('2026-10-04', '12:00').toISOString(), '2026-10-04T04:00:00.000Z');
  });

  test('an explicit seconds component is honoured', () => {
    assert.equal(
      manilaWallClockToInstant('2026-10-04', '17:25:30').toISOString(),
      '2026-10-04T09:25:30.000Z',
    );
  });

  test('every minute of a full day maps to exactly one Manila instant', () => {
    // Guards against any hour that slips through an off-by-one, which a handful
    // of hand-picked examples would miss.
    for (let minuteOfDay = 0; minuteOfDay < 24 * 60; minuteOfDay += 1) {
      const hours = String(Math.floor(minuteOfDay / 60)).padStart(2, '0');
      const minutes = String(minuteOfDay % 60).padStart(2, '0');
      const instant = manilaWallClockToInstant('2026-10-04', `${hours}:${minutes}`);
      assert.equal(manilaTime(instant), `${hours}:${minutes}`, `minute ${minuteOfDay} round-trips`);
      assert.equal(manilaDate(instant), '2026-10-04', `minute ${minuteOfDay} keeps its Manila day`);
    }
  });

  test('parsing and formatting round-trip across a year boundary', () => {
    for (const date of ['2026-12-31', '2027-01-01', '2028-02-29']) {
      const instant = manilaWallClockToInstant(date, '08:15');
      assert.equal(manilaDate(instant), date);
      assert.equal(manilaTime(instant), '08:15');
    }
  });

  test('ordering is preserved, so an end time still follows its start', () => {
    const start = manilaWallClockToInstant('2026-10-04', '17:25');
    const end = manilaWallClockToInstant('2026-10-04', '18:00');
    assert.ok(end > start, '18:00 Manila is later than 17:25 Manila');
    assert.equal(end.getTime() - start.getTime(), 35 * 60_000);
  });

  test('malformed input is rejected rather than stored as a wrong instant', () => {
    for (const [date, time] of [
      ['', '17:25'],
      ['2026-10-04', ''],
      ['04/10/2026', '17:25'],
      ['2026-10-04', '5:25'],
      ['2026-10-04', '99:99'],
      ['not-a-date', '17:25'],
    ]) {
      assert.equal(manilaWallClockToInstant(date, time), null, `${date} ${time} must be rejected`);
    }
  });

  test('the conversion is the identity that undoes the old bug', () => {
    // The old code's arithmetic, kept here only to show what changed. Reading a
    // Manila wall-clock as UTC is exactly the eight-hour error being removed.
    const oldStored = new Date('2026-10-04T17:25:00Z');
    const newStored = manilaWallClockToInstant('2026-10-04', '17:25');
    assert.equal(oldStored.getTime() - newStored.getTime(), 8 * 3_600_000);
    assert.equal(manilaDate(newStored), '2026-10-04', 'the corrected instant reads back as the day typed');
  });
});