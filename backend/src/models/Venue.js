import mongoose from 'mongoose';
import crypto from 'node:crypto';

/**
 * A SAVED VENUE - a reusable template of the geofence an event checks in
 * against.
 *
 * WHY THIS EXISTS SEPARATELY FROM Event. An event's venue fields are a SNAPSHOT
 * taken when the event is created. That is the whole point: editing a saved
 * venue must NOT silently move the check-in zone of events already scheduled
 * against it, because those events have attendance already recorded against
 * those exact coordinates. So an event copies the values in; it never holds a
 * live reference back to this document.
 *
 * `defaultRequiredAttendanceMinutes` is a DEFAULT SUGGESTION only. It is
 * copied into the event form when a venue is picked, and the administrator can
 * change it per event before saving. It is never enforced server-side on an
 * existing event.
 */
const venueSchema = new mongoose.Schema({
  _id: { type: String, required: true, default: () => crypto.randomUUID() },
  name: { type: String, required: true, maxlength: 180 },
  // Free text the administrator controls. Used to state plainly that a saved
  // campus-area coordinate is approximate, so nobody mistakes it for a
  // surveyed gym or room position.
  note: { type: String, default: '', maxlength: 70_000 },
  latitude: { type: Number, required: true, min: -90, max: 90 },
  longitude: { type: Number, required: true, min: -180, max: 180 },
  radiusMeters: { type: Number, required: true, min: 1, max: 100_000 },
  // A per-venue suggestion, nullable exactly like an event's requirement: blank
  // means "no suggestion", and the event form then stays blank too.
  defaultRequiredAttendanceMinutes: { type: Number, default: null, min: 1, max: 24 * 60 },
  createdAt: { type: Date, default: Date.now },
  // Marks a record as belonging to the isolated test instance only, so a live
  // deployment can be told apart from it without inspecting the name.
  isolatedTestRecord: { type: Boolean, default: false, index: true },
}, { versionKey: false });

venueSchema.index({ name: 1 });

export default mongoose.models.Venue || mongoose.model('Venue', venueSchema);
