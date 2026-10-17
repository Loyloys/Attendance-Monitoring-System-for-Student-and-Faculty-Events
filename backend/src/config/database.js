import mongoose from 'mongoose';
import { env } from './env.js';
import '../models/index.js';

export async function connectDatabase(uri = env.mongoUri) {
  mongoose.set('strictQuery', true);
  // Automatic index building is DISABLED, and this is load-bearing rather than a
  // tidy-up. Mongoose's global `autoIndex` (true by default) creates the indexes
  // of EVERY registered model asynchronously once the connection opens, so simply
  // importing a model is enough to create its collection and indexes on the live
  // database - which would silently bypass INDEX_CREATION_EXCLUDED_MODELS below and
  // quietly perform the approval-gated rollout on the next normal `npm start`.
  //
  // `autoCreate: false` closes the matching half of that hole: Mongoose's `init()`
  // also CREATES a missing collection, so a model import would otherwise still
  // create `attendancesessions` on the live database even with no indexes on it.
  //
  // With both off, creating a collection and its indexes is explicit and awaited:
  // exactly the models in `ensureDatabaseIndexes()` are built, and the excluded one
  // is only ever built by its own approved rollout script, which creates its
  // indexes deliberately.
  mongoose.set('autoIndex', false);
  mongoose.set('autoCreate', false);
  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 10_000,
    maxPoolSize: 20,
    autoIndex: false,
    autoCreate: false,
  });
  return mongoose.connection;
}

/**
 * Models whose collections and indexes must NOT be created by a routine start.
 *
 * Registering a model is enough for Mongoose to build it, so merely importing one
 * would make a normal `npm start` write to the live database. `autoIndex` and
 * `autoCreate` are therefore both disabled on connect (see connectDatabase), which
 * makes this function the ONLY thing a normal start uses, and it skips these
 * models. They are created instead by an explicit, separately approved rollout step
 * (`scripts/create-attendance-session-indexes.js`).
 *
 * BOTH approval-gated models belong here:
 *   - `AttendanceSession` - `unique_user_event_session` backs the single-session
 *     rule, and GST006 tracking is refused outright until it really exists.
 *   - `AttendanceCode`    - `unique_active_code_per_event` is what makes concurrent
 *     issuance converge on one credential. Excluding only the tracking model would
 *     still let a routine restart apply the QR index to the live database, which is
 *     exactly the rollout that has to be authorised.
 *   - `SignupRequest`     - AD003.3 email-only pending requests. A new collection
 *     plus its indexes must never be created implicitly on the live database by a
 *     routine start; creation waits for explicit approval.
 *
 * Nothing is lost in the meantime:
 *   - tracking endpoints stay refused until their index exists;
 *   - QR issuance/rotation stay refused until their index exists (see
 *     `isQrIndexReady` in eventQrService), and a scan already validates the
 *     credential by hash lookup, which does not depend on the index;
 *   - the single-active-code rule is also enforced in the service, so a missing
 *     index cannot produce two competing codes even before the rollout.
 *
 * Excluding a model here does NOT drop an index that already exists: `createIndexes`
 * only ever creates what is missing, and nothing in this file removes anything.
 */
export const INDEX_CREATION_EXCLUDED_MODELS = Object.freeze(['AttendanceSession', 'AttendanceCode', 'SignupRequest']);

/**
 * Creates the collections and indexes of every NON-excluded model.
 *
 * `createIndexes()` is used rather than `init()` because `autoCreate` is off: it
 * would skip a collection that does not exist yet, leaving a fresh database with
 * no collections and no indexes. Creating an index creates its collection, so this
 * still bootstraps a brand-new database correctly.
 */
export async function ensureDatabaseIndexes() {
  const models = mongoose.modelNames()
    .filter((name) => !INDEX_CREATION_EXCLUDED_MODELS.includes(name))
    .map((name) => mongoose.model(name));
  await Promise.all(models.map((model) => model.createIndexes()));
}

export async function disconnectDatabase() {
  await mongoose.disconnect();
}
