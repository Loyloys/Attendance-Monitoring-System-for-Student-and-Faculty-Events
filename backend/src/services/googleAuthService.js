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

// The three states the sign-in card has to tell apart. They are reported
// separately because "we cannot verify an institutional domain yet" and
// "a named tester is allowed" are very different promises.
export const GOOGLE_MODE_UNAVAILABLE = 'unavailable';
export const GOOGLE_MODE_OPEN = 'open';
export const GOOGLE_MODE_INSTITUTIONAL = 'institutional';
export const GOOGLE_MODE_DEVELOPMENT_TEST = 'development_test';

/**
 * The single source of truth for "what is Google sign-in allowed to do here",
 * derived from the EXPLICIT GOOGLE_ACCESS_POLICY setting. It is never inferred
 * from whether a domain list happens to be empty, so "open" can only ever be
 * reached by someone who deliberately selected it.
 *
 * `unavailable`        policy is `off`, or no client id, or the private test
 *                      policy has no accounts named. Nothing is accepted.
 * `open`               any valid, verified Google account. Identity only; the
 *                      account becomes a Student immediately, and is never
 *                      checked against an official school roster.
 * `institutional`     the verified `hd` claim must be on the approved list.
 * `development_test`   only the explicitly named local test accounts.
 */
export function googleSignInMode() {
  if (!env.googleClientId) return GOOGLE_MODE_UNAVAILABLE;
  if (env.googleAccessPolicy === 'open') return GOOGLE_MODE_OPEN;
  if (env.googleAccessPolicy === 'institutional') return GOOGLE_MODE_INSTITUTIONAL;
  if (env.googleAccessPolicy === 'development_test') {
    // Fails closed: naming the policy but nobody being named means nothing is
    // accepted, rather than everything being accepted.
    return env.googleDevTestEmails.length ? GOOGLE_MODE_DEVELOPMENT_TEST : GOOGLE_MODE_UNAVAILABLE;
  }
  return GOOGLE_MODE_UNAVAILABLE;
}

export function googlePublicConfig() {
  const mode = googleSignInMode();
  return {
    enabled: mode !== GOOGLE_MODE_UNAVAILABLE,
    mode,
    // The policy that was actually selected, so an operator can see the intent
    // behind the effective mode rather than having to infer it.
    policy: env.googleAccessPolicy,
    clientId: env.googleClientId || null,
    // Lets the sign-in card describe the rule honestly. These are server-side
    // configuration values; the browser cannot add one.
    hostedDomains: [...env.googleAllowedHostedDomains],
    // True only when an institutional allowlist is genuinely being enforced. It
    // must never be reported while some other policy is what actually applies.
    domainRestricted: mode === GOOGLE_MODE_INSTITUTIONAL,
    developmentTesting: mode === GOOGLE_MODE_DEVELOPMENT_TEST,
    openRegistration: mode === GOOGLE_MODE_OPEN,
    // Whether the SCHOOL has approved this deployment. Deliberately NOT derived
    // from the mode or the domain list: a working configuration is not an
    // approval. Only an explicit GOOGLE_SCHOOL_APPROVED=true, set after the
    // school actually confirms permission, may set this.
    schoolApproved: env.googleSchoolApproved,
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
  // Normalized exactly as the stored identity is, so the private test list is
  // compared against the same value that is written to the account.
  const email = payload.email.trim().toLowerCase();
  assertApprovedGoogleAccount(hostedDomain, email);

  return {
    sub: payload.sub.trim(),
    email,
    emailNormalized: stableCaseInsensitive(payload.email),
    name: typeof payload.name === 'string' ? payload.name.trim().slice(0, 150) : '',
    picture: typeof payload.picture === 'string' ? payload.picture.trim().slice(0, 1000) : '',
    hostedDomain,
  };
}

/**
 * Access control, decided entirely on the server from a payload that
 * `google-auth-library` has already signature-checked. Nothing the browser sends
 * takes part in this decision.
 *
 * `hd` is Google's own statement about which Workspace an account belongs to, so
 * it is the right basis for the institutional rule. The email address suffix is
 * deliberately NOT used for it, and neither is any frontend hint.
 *
 * Three outcomes, and none of them is "allow everyone":
 *
 * 1. An approved domain list exists, so access is decided from `hd`. This is the
 *    only production-meaningful configuration, and it is the only one that may be
 *    described as school-approved.
 * 2. No approved domain yet, but private development testing is switched on with
 *    a non-empty list of named accounts, so only those exact verified addresses
 *    may sign in. This is a local, explicitly-labelled testing policy. It is NOT
 *    a fallback that relaxes the institutional rule: when a domain list exists it
 *    is still applied first, and a personal account is refused by rule 1 anyway.
 * 3. Neither is configured, so the flow is closed and the person is told to use
 *    their password. An empty domain list is never read as permission to accept
 *    every verified Google account.
 */
function assertApprovedGoogleAccount(hostedDomain, email) {
  const mode = googleSignInMode();

  if (mode === GOOGLE_MODE_OPEN) {
    // Deliberate policy: any account Google vouches for may proceed. By this
    // point the RSA signature, audience, issuer, expiry and `email_verified`
    // have all been checked, so this really does mean "a valid, verified Google
    // account".
    //
    // What it does NOT grant: Faculty or Administrator eligibility, or any role.
    // A brand-new identity becomes a Student account, and nothing more. It also
    // says nothing about membership of a school roster: `open` deliberately does
    // not check one, which is why `schoolApproved` stays a separate fact.
    return;
  }

  if (mode === GOOGLE_MODE_INSTITUTIONAL) {
    const allowed = env.googleAllowedHostedDomains;
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
    return;
  }

  if (mode === GOOGLE_MODE_DEVELOPMENT_TEST) {
    // The address has already been verified by Google at this point, so this
    // compares a trusted value against a list the developer typed into
    // GOOGLE_DEV_TEST_EMAILS. Exact match after the application's normal
    // trimming/case-folding: no suffix, domain or wildcard matching, so a listed
    // account cannot be extended to `someone+extra@` or `...@evil.example`.
    if (!env.googleDevTestEmails.includes(email)) {
      throw new PermissionError(
        'This Google account is not on the private development test list for this server. '
        + 'Development testing is limited to specifically named accounts and is not open registration.',
        undefined,
        'google_test_account_not_allowed',
      );
    }
    return;
  }

  throw new AppError(
    503,
    'Google sign-in is not available on this server yet, because no approved institutional Google '
    + 'domain has been configured. Please use your ID and password.',
  );
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
      // Automatic activation. Completing the profile IS the registration step, so
      // the account is usable immediately and is never parked in a manual queue.
      // This is NOT a bypass of authentication: the Google credential was already
      // verified against signature, audience, issuer, expiry, nonce and
      // `email_verified` above, the role is forced to Student, and the account
      // still has to pass `requireAuthentication` and CSRF on every request.
      approvalStatus: 'approved',
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
