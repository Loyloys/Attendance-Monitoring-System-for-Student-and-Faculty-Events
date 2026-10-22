import test from 'node:test';
import assert from 'node:assert/strict';
import { distanceToPolygonMeters, pointInPolygon, polygonValidationError } from '../src/utils/geofence.js';
import { geofenceFor } from '../src/utils/domain.js';

const square = [
  { latitude: 7.87, longitude: 125.11 },
  { latitude: 7.87, longitude: 125.12 },
  { latitude: 7.88, longitude: 125.12 },
  { latitude: 7.88, longitude: 125.11 },
];

test('accepts points inside and on the polygon boundary and rejects outside points', () => {
  assert.equal(pointInPolygon(7.875, 125.115, square), true);
  assert.equal(pointInPolygon(7.87, 125.115, square), true);
  assert.equal(pointInPolygon(7.885, 125.115, square), false);
  assert.ok(distanceToPolygonMeters(7.885, 125.115, square) > 0);
});

test('rejects malformed, out-of-range, degenerate, and self-intersecting polygons', () => {
  assert.match(polygonValidationError(square.slice(0, 2)), /3-100 vertices/);
  assert.match(polygonValidationError([...square, square[0]]), /duplicate vertices|cross or overlap/);
  assert.match(polygonValidationError([
    { latitude: 7, longitude: 125 },
    { latitude: 8, longitude: 126 },
    { latitude: 9, longitude: 127 },
  ]), /non-zero area/);
  assert.match(polygonValidationError([
    { latitude: 0, longitude: 0 },
    { latitude: 1, longitude: 1 },
    { latitude: 0, longitude: 1 },
    { latitude: 1, longitude: 0 },
  ]), /cross or overlap/);
  assert.match(polygonValidationError([
    { latitude: 91, longitude: 0 },
    { latitude: 0, longitude: 1 },
    { latitude: 0, longitude: 0 },
  ]), /valid latitude and longitude/);
});

test('existing complete circles remain circular and incomplete circles remain unavailable', () => {
  assert.deepEqual(geofenceFor({ venueLatitude: 7, venueLongitude: 125, venueRadiusMeters: 50 }), {
    type: 'circle', latitude: 7, longitude: 125, radiusMeters: 50,
  });
  assert.equal(geofenceFor({ venueLatitude: 7, venueLongitude: 125, venueRadiusMeters: null }), null);
});
