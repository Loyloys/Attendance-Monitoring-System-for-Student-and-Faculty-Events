import crypto from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';
import { env } from '../config/env.js';
import { RevokedIdentifier, User, UserProfile } from '../models/index.js';
import { ROLES } from '../utils/domain.js';
import {
  AppError,
  AuthenticationError,
  ConflictError,
  PermissionError,
  ValidationError,
  requireString,
} from '../utils/errors.js';
import { stableCaseInsensitive } from '../utils/identifiers.js';
import { regenerateSession } from '../utils/session.js';

// Google-only accounts may never be given a fabricated password.
export const GOOGLE_SIGNED_IN = 'signed_in';
export const GOOGLE_PROFILE_INCOMPLETE = 'profile_incomplete';

function googleNotConfigured() {
  return new AppError(503, 'Google sign-in is not available on this server yet.');
}

async function verifyWithGoogleLibrary(idToken) {
  if (!env.googleClientId) throw googleNotConfigured();
  const client = new OAuth2Client(env.googleClientId);
  const ticket = await client.verifyIdToken({ idToken, audience: env.googleClientId });
  return ticket.getPayload();
}

// Single seam so the integration tests can exercise the rules this module
// enforces without reaching Google's live endpoints.
let tokenVerifier = verifyWithGoogleLibrary;
export function __setGoogleTokenVerifier(fn) { tokenVerifier = fn; }
export function __resetGoogleTokenVerifier() { tokenVerifier = verifyWithGoogleLibrary; }

function isTrue(value) {
  return value === true || value === 'true';
}

function timingSafeEqualStrings(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

export function googlePublicConfig() {
  return {
    enabled: Boolean(env.googleClientId),
    clientId: env.googleClientId || null,
    // Lets the sign-in card say "institutional Google account" honestly, and warn
    // that no domain restriction is configured yet.
    hostedDomains: [...env.googleAllowedHostedDomains],
    domainRestricted: env.googleAllowedHostedDomains.length > 0,
  };
}

function googleFields(identity) {
  return {
    googleSub: identity.sub,
    googleEmail: identity.email,
    googleEmailNormalized: identity.emailNormalized,
    googleHostedDomain: identity.hostedDomain || '',
    googlePictureUrl: identity.picture || '',
    googleLinkedAt: new Date(),
  };
}

function prefillFrom(identity, profile) {
  return {
    name: identity.name || profile?.displayName || '',
    email: identity.email,
    picture: identity.picture || '',
  };
}


/**
 * Verifies a Google Identity Services ID token and returns the trusted identity.
 *
 * The library checks the RSA signature, the expiry and the audience against
 * Google's published keys. Everything below is an extra server-side check, so a
 * token that is well formed but not meant for this application is still refused.
 */
export async function verifyGoogleCredential(credential, { nonce } = {}) {
  if (!env.googleClientId) throw googleNotConfigured();
  if (typeof credential !== 'string' || !credential.trim()) {
    throw new ValidationError({ credential: 'A Google credential is required.' });
  }

  let payload;
  try {
    payload = await tokenVerifier(credential.trim());
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AuthenticationError('Google sign-in could not be verified. Please try again.');
  }
  if (!payload || typeof payload !== 'object') {
    throw new AuthenticationError('Google sign-in could not be verified. Please try again.');
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  const skew = env.googleClockSkewSeconds;

  if (payload.aud !== env.googleClientId) {
    throw new AuthenticationError('This Google credential was issued for a different application.');
  }
  if (!env.googleAllowedIssuers.includes(payload.iss)) {
    throw new AuthenticationError('This Google credential came from an untrusted issuer.');
  }
  if (typeof payload.exp !== 'number' || payload.exp + skew <= nowSeconds) {
    throw new AuthenticationError('This Google credential has expired. Please try again.');
  }
  if (typeof payload.iat === 'number' && payload.iat - skew > nowSeconds) {
    throw new AuthenticationError('This Google credential is not valid yet.');
  }
  if (typeof payload.sub !== 'string' || !payload.sub.trim()) {
    throw new AuthenticationError('This Google credential is missing an account identifier.');
  }
  if (!isTrue(payload.email_verified)) {
    throw new PermissionError('Your Google account does not have a verified email address.');
  }
  if (typeof payload.email !== 'string' || !payload.email.includes('@')) {
    throw new AuthenticationError('This Google credential is missing an email address.');
  }
  // The nonce is mandatory, not optional. Skipping the check whenever the session
  // happens to have no nonce would let a captured credential be replayed from a
  // different session, which is exactly what the nonce exists to prevent.
  if (typeof nonce !== 'string' || !nonce) {
    throw new AuthenticationError('This Google sign-in attempt has expired. Please try again.');
  }
  if (typeof payload.nonce !== 'string' || !timingSafeEqualStrings(payload.nonce, nonce)) {
    throw new AuthenticationError('This Google sign-in attempt could not be matched to your session. Please try again.');
  }

  const hostedDomain = typeof payload.hd === 'string' ? payload.hd.trim().toLowerCase() : '';
  assertApprovedHostedDomain(hostedDomain);

  return {
    sub: payload.sub.trim(),
    email: payload.email.trim().toLowerCase(),
    emailNormalized: stableCaseInsensitive(payload.email),
    name: typeof payload.name === 'string' ? payload.name.trim().slice(0, 150) : '',
    picture: typeof payload.picture === 'string' ? payload.picture.trim().slice(0, 1000) : '',
    hostedDomain,
  };
}

/**
 * Institutional access control, decided entirely on the server from Google's
 * verified `hd` claim.
 *
 * The email suffix is deliberately NOT used for this decision, and neither is
 * anything the browser can influence: by this point the payload has already been
 * signature-checked by `google-auth-library` and re-validated above, so `hd` is
 * Google's own statement about which Workspace the account belongs to. Personal
 * Gmail accounts have no `hd` claim at all, which is what makes them easy to
 * refuse without guessing from the address text.
 */
function assertApprovedHostedDomain(hostedDomain) {
  const allowed = env.googleAllowedHostedDomains;
  if (!allowed.length) return;
  if (!hostedDomain) {
    throw new PermissionError(
      'Use your institutional Google account. Personal Gmail accounts cannot sign in here.',
      undefined,
      'google_domain_not_allowed',
    );
  }
  if (!allowed.includes(hostedDomain)) {
    throw new PermissionError(
      `This Google account belongs to ${hostedDomain}, which is not an approved institution domain. Use your institutional Google account.`,
      undefined,
      'google_domain_not_allowed',
    );
  }
}

/**
 * Mints the single-use nonce that ties a popup credential to this session.
 * The client id is public configuration; this flow uses no client secret.
 */
export function startGoogleSession(request) {
  const config = googlePublicConfig();
  if (!config.enabled) return { ...config, nonce: null };
  const nonce = crypto.randomBytes(24).toString('base64url');
  request.session.googleNonce = nonce;
  return { ...config, nonce };
}


async function loadLinkedUser(sub) {
  const user = await User.findOne({ googleSub: sub });
  if (!user) return null;
  if (!user.isActive) {
    throw new PermissionError('This account has been deactivated. Contact an administrator.');
  }
  const profile = await UserProfile.findOne({ userId: user._id });
  if (!profile) throw new AuthenticationError('This account is missing its profile record.');
  return { user: { ...user.toObject(), profile: profile.toObject() }, document: user };
}

async function signInDocument(request, document) {
  await regenerateSession(request);
  request.session.userId = String(document._id);
  document.lastLogin = new Date();
  await document.save();
  const profile = await UserProfile.findOne({ userId: document._id }).lean();
  return { status: GOOGLE_SIGNED_IN, user: { ...document.toObject(), profile } };
}

/**
 * The account type chosen on the first screen is presentation only. It never
 * grants, changes or implies a role: the stored profile role is the single
 * source of truth, and this function only reports a mismatch so the person is
 * sent to the screen that matches the account they actually hold.
 */
const LOGIN_PATHS = Object.freeze({
  [ROLES.STUDENT]: '/login/student',
  [ROLES.FACULTY]: '/login/faculty',
  [ROLES.ADMIN]: '/login/administrator',
});

const ROLE_LABELS = Object.freeze({
  [ROLES.STUDENT]: 'Student',
  [ROLES.FACULTY]: 'Faculty',
  [ROLES.ADMIN]: 'Administrator',
});

function assertRoleMatchesSelection(accountRole, selectedRole) {
  if (!selectedRole || !LOGIN_PATHS[selectedRole] || !LOGIN_PATHS[accountRole]) return;
  if (selectedRole === accountRole) return;
  throw new AppError(
    409,
    `This Google account is registered as ${ROLE_LABELS[accountRole]}. `
    + `Your role is set by an administrator and cannot be changed here, so please use the ${ROLE_LABELS[accountRole]} sign-in.`,
    { accountRole, selectedRole, correctPath: LOGIN_PATHS[accountRole] },
    'role_mismatch',
  );
}

/**
 * Step 1 of the Google flow. An already linked, active identity signs in. A new
 * identity is parked in the server-side session and the client is asked to
 * complete the profile. An identity whose email collides with an existing account
 * is refused, so accounts are never merged on the strength of an email alone.
 */
export async function authenticateWithGoogle(request, body) {
  const sessionNonce = request.session.googleNonce;
  delete request.session.googleNonce;

  const identity = await verifyGoogleCredential(body?.credential, { nonce: sessionNonce });
  // Read for the mismatch message only. It is validated against the known role
  // list, so an invented value is simply ignored.
  const selectedRole = typeof body?.selectedRole === 'string' ? body.selectedRole : null;

  const linked = await loadLinkedUser(identity.sub);
  if (linked) {
    assertRoleMatchesSelection(linked.user.profile.role, selectedRole);
    if (linked.user.profileCompleted === false) {
      request.session.pendingGoogleIdentity = identity;
      return { status: GOOGLE_PROFILE_INCOMPLETE, prefill: prefillFrom(identity, linked.user.profile) };
    }
    return signInDocument(request, linked.document);
  }

  const sameEmail = await User.find({ emailNormalized: identity.emailNormalized }).limit(2).lean();
  if (sameEmail.length) {
    throw new ConflictError(
      'An account already uses this email address. Sign in with your existing password, then link Google from your profile.',
    );
  }

  request.session.pendingGoogleIdentity = identity;
  return { status: GOOGLE_PROFILE_INCOMPLETE, prefill: prefillFrom(identity, null) };
}

const ACCOUNT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{2,29}$/;


/**
 * Step 2. Creates the account for a verified Google identity.
 *
 * The role is fixed to student on the server, and a browser supplied role is
 * rejected outright so nobody can self-assign Faculty or Administrator. The unique
 * partial index on googleSub makes simultaneous registrations for one identity
 * collapse into a single account rather than creating duplicates.
 */
export async function completeGoogleProfile(request, body) {
  const identity = request.session.pendingGoogleIdentity;
  if (!identity) {
    throw new ValidationError({ profile: 'Start Google sign-in again before completing your profile.' });
  }
  if (Object.hasOwn(body || {}, 'role')) {
    throw new ValidationError({ role: 'Your role is assigned by an administrator and cannot be chosen here.' });
  }

  const accountId = requireString(body.accountId, 'accountId', { min: 3, max: 30 }).toUpperCase();
  if (!ACCOUNT_ID_PATTERN.test(accountId)) {
    throw new ValidationError({ accountId: 'Use 3 to 30 letters, numbers, dots, dashes or underscores.' });
  }
  const department = requireString(body.department, 'department', { min: 2, max: 150 });
  const fullName = requireString(body.name || identity.name, 'name', { min: 2, max: 150 });
  const phone = body.phone === undefined || body.phone === null
    ? ''
    : requireString(body.phone, 'phone', { min: 0, max: 40 });

  const accountIdNormalized = stableCaseInsensitive(accountId);
  const usernameNormalized = accountIdNormalized;

  const revoked = await RevokedIdentifier.exists({
    _id: { $regex: `^${accountIdNormalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:` },
  });
  if (revoked) throw new ConflictError({ accountId: 'That account ID can no longer be used.' });

  if (await User.exists({ $or: [{ accountIdNormalized }, { usernameNormalized }] })) {
    throw new ConflictError({ accountId: 'That account ID is already in use.' });
  }

  const { firstName, lastName } = splitName(fullName);

  let user;
  try {
    user = await User.create({
      accountId,
      accountIdNormalized,
      username: accountId,
      usernameNormalized,
      passwordHash: null,
      authProviders: ['google'],
      email: identity.email,
      emailNormalized: identity.emailNormalized,
      firstName: firstName.slice(0, 150),
      lastName: lastName.slice(0, 150),
      isActive: true,
      isStaff: false,
      isSuperuser: false,
      profileCompleted: true,
      dateJoined: new Date(),
      dataSource: 'google',
      ...googleFields(identity),
    });
  } catch (error) {
    if (error?.code === 11000) {
      const field = Object.keys(error.keyPattern || error.keyValue || {})[0] || '';
      if (field === 'googleSub') {
        // A simultaneous request already claimed this identity. Sign that account
        // in instead of failing, so one person can never end up with two users.
        const winner = await loadLinkedUser(identity.sub);
        if (winner) {
          delete request.session.pendingGoogleIdentity;
          return signInDocument(request, winner.document);
        }
      }
      throw new ConflictError({ accountId: 'That account ID is already in use.' });
    }
    throw error;
  }

  try {
    await UserProfile.create({
      userId: user._id,
      role: ROLES.STUDENT,
      displayName: fullName,
      phone,
      department,
      cardIdentifier: null,
    });
  } catch (error) {
    // Never leave a user behind without the profile record the app requires.
    await User.deleteOne({ _id: user._id }).catch(() => {});
    throw error;
  }

  delete request.session.pendingGoogleIdentity;
  return signInDocument(request, user);
}

/**
 * Links a verified Google identity to the account that is already signed in. The
 * account's own email is never overwritten, and a subject already owned by another
 * account is refused, so linking cannot be used to take over an address.
 */
export async function linkGoogleIdentity(request, body) {
  const currentUser = request.user;
  if (!currentUser) throw new AuthenticationError();

  const sessionNonce = request.session.googleNonce;
  delete request.session.googleNonce;
  const identity = await verifyGoogleCredential(body?.credential, { nonce: sessionNonce });

  const owner = await User.findOne({ googleSub: identity.sub }).lean();
  if (owner && String(owner._id) !== String(currentUser._id)) {
    throw new ConflictError('That Google account is already linked to another COT account.');
  }

  const updated = await User.findByIdAndUpdate(
    currentUser._id,
    { $set: googleFields(identity), $addToSet: { authProviders: 'google' } },
    { new: true },
  );
  const profile = await UserProfile.findOne({ userId: updated._id }).lean();
  return { ...updated.toObject(), profile };
}

function splitName(fullName) {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return { firstName: parts[0] || '', lastName: '' };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}
