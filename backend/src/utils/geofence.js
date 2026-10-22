const MIN_VERTICES = 3;
const MAX_VERTICES = 100;
const EARTH_METERS_PER_DEGREE = 111_320;

function validPoint(point) {
  return point && Number.isFinite(point.latitude) && Number.isFinite(point.longitude)
    && point.latitude >= -90 && point.latitude <= 90
    && point.longitude >= -180 && point.longitude <= 180;
}

function cross(a, b, c) {
  return (b.longitude - a.longitude) * (c.latitude - a.latitude)
    - (b.latitude - a.latitude) * (c.longitude - a.longitude);
}

function onSegment(a, b, p) {
  return Math.abs(cross(a, b, p)) < 1e-10
    && p.longitude >= Math.min(a.longitude, b.longitude) - 1e-10
    && p.longitude <= Math.max(a.longitude, b.longitude) + 1e-10
    && p.latitude >= Math.min(a.latitude, b.latitude) - 1e-10
    && p.latitude <= Math.max(a.latitude, b.latitude) + 1e-10;
}

function segmentsIntersect(a, b, c, d) {
  const abC = cross(a, b, c);
  const abD = cross(a, b, d);
  const cdA = cross(c, d, a);
  const cdB = cross(c, d, b);
  if (((abC > 0 && abD < 0) || (abC < 0 && abD > 0))
    && ((cdA > 0 && cdB < 0) || (cdA < 0 && cdB > 0))) return true;
  return (Math.abs(abC) < 1e-10 && onSegment(a, b, c))
    || (Math.abs(abD) < 1e-10 && onSegment(a, b, d))
    || (Math.abs(cdA) < 1e-10 && onSegment(c, d, a))
    || (Math.abs(cdB) < 1e-10 && onSegment(c, d, b));
}

export function polygonValidationError(polygon) {
  if (!Array.isArray(polygon) || polygon.length < MIN_VERTICES || polygon.length > MAX_VERTICES) {
    return `A polygon geofence must have ${MIN_VERTICES}-${MAX_VERTICES} vertices.`;
  }
  if (!polygon.every(validPoint)) return 'Every polygon vertex needs valid latitude and longitude coordinates.';
  for (let i = 0; i < polygon.length; i += 1) {
    const next = (i + 1) % polygon.length;
    if (polygon[i].latitude === polygon[next].latitude && polygon[i].longitude === polygon[next].longitude) {
      return 'A polygon cannot contain consecutive duplicate vertices.';
    }
  }
  for (let i = 0; i < polygon.length; i += 1) {
    const iNext = (i + 1) % polygon.length;
    for (let j = i + 1; j < polygon.length; j += 1) {
      const jNext = (j + 1) % polygon.length;
      if (i === j || iNext === j || jNext === i) continue;
      if (segmentsIntersect(polygon[i], polygon[iNext], polygon[j], polygon[jNext])) {
        return 'Polygon edges cannot cross or overlap.';
      }
    }
    let twiceArea = 0;
    for (let i = 0; i < polygon.length; i += 1) {
      const current = polygon[i];
      const next = polygon[(i + 1) % polygon.length];
      twiceArea += current.longitude * next.latitude - next.longitude * current.latitude;
    }
    if (Math.abs(twiceArea) < 1e-12) return 'The polygon must enclose a non-zero area.';
  }
  return null;
}

export function pointInPolygon(latitude, longitude, polygon) {
  const point = { latitude, longitude };
  if (!validPoint(point) || polygonValidationError(polygon)) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[j];
    const b = polygon[i];
    if (onSegment(a, b, point)) return true;
    const crossesLatitude = (a.latitude > latitude) !== (b.latitude > latitude);
    const crossingLongitude = ((b.longitude - a.longitude) * (latitude - a.latitude))
      / (b.latitude - a.latitude) + a.longitude;
    if (crossesLatitude && longitude < crossingLongitude) inside = !inside;
  }
  return inside;
}

export function distanceToPolygonMeters(latitude, longitude, polygon) {
  if (!validPoint({ latitude, longitude }) || polygonValidationError(polygon)) return Number.POSITIVE_INFINITY;
  if (pointInPolygon(latitude, longitude, polygon)) return 0;
  const referenceLatitude = latitude * Math.PI / 180;
  const xScale = EARTH_METERS_PER_DEGREE * Math.cos(referenceLatitude);
  const yScale = EARTH_METERS_PER_DEGREE;
  const point = { x: longitude * xScale, y: latitude * yScale };
  let shortest = Number.POSITIVE_INFINITY;
  for (let i = 0; i < polygon.length; i += 1) {
    const start = polygon[i];
    const end = polygon[(i + 1) % polygon.length];
    const a = { x: start.longitude * xScale, y: start.latitude * yScale };
    const b = { x: end.longitude * xScale, y: end.latitude * yScale };
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSquared = dx * dx + dy * dy;
    const fraction = lengthSquared === 0
      ? 0
      : Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared));
    shortest = Math.min(shortest, Math.hypot(point.x - (a.x + fraction * dx), point.y - (a.y + fraction * dy)));
  }
  return shortest;
}
