import crypto from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';
import { env } from '../config/env.js';
import { RevokedIdentifier, SignupRequest, User, UserProfile } from '../models/index.js';
import { ROLES, pendingRoleForEmail } from '../utils/domain.js';
import {
  AppError,
  AuthenticationError,
  ConflictError,
  PermissionError,
  ValidationError,
} from '../utils/errors.js';
import { stableCaseInsensitive } from '../utils/identifiers.js';
import { regenerateSession } from '../utils/session.js';
import { googleClientIdStatus, googleOAuthStatus } from './systemSettingsService.js';
import { isApproved } from '../middleware/authentication.js';

// Google-only accounts may never be given a fabricated password.
export const GOOGLE_SIGNED_IN = 'signed_in';
export const GOOGLE_PROFILE_INCOMPLETE = 'profile_incomplete';
// AD003.3: a verified identity whose signup request is awaiting admin approval.
export const GOOGLE_SIGNUP_PENDING = 'signup_pending';

function googleNotConfigured() {
  return new AppError(503, 'Google sign-in is not available on this server yet.');
}

async function assertGoogleOAuthEnabled() {
  const setting = await googleOAuthStatus();
  if (!setting.available || !setting.enabled) {
    throw new AppError(503, 'Google sign-in is disabled by an administrator. Use your ID and password instead.');
  }
}

async function verifyWithGoogleLibrary(idToken, clientId) {
  if (!clientId) throw googleNotConfigured();
  const client = new OAuth2Client(clientId);
  const ticket = await client.verifyIdToken({ idToken, audience: clientId });
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
export function googleSignInMode(clientId = env.googleClientId) {
  if (!clientId) return GOOGLE_MODE_UNAVAILABLE;
  if (env.googleAccessPolicy === 'open') return GOOGLE_MODE_OPEN;
  if (env.googleAccessPolicy === 'institutional') return GOOGLE_MODE_INSTITUTIONAL;
  if (env.googleAccessPolicy === 'development_test') {
    // Fails closed: naming the policy but nobody being named means nothing is
    // accepted, rather than everything being accepted.
    return env.googleDevTestEmails.length ? GOOGLE_MODE_DEVELOPMENT_TEST : GOOGLE_MODE_UNAVAILABLE;
  }
  return GOOGLE_MODE_UNAVAILABLE;
}

export function googlePublicConfig(clientId = env.googleClientId) {
  const mode = googleSignInMode(clientId);
  return {
    enabled: mode !== GOOGLE_MODE_UNAVAILABLE,
    mode,
    // The policy that was actually selected, so an operator can see the intent
    // behind the effective mode rather than having to infer it.
    policy: env.googleAccessPolicy,
    clientId: clientId || null,
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

export async function googleOAuthAvailability() {
  const [clientIdSetting, setting] = await Promise.all([googleClientIdStatus(), googleOAuthStatus()]);
  const config = googlePublicConfig(clientIdSetting.clientId);
  const enabled = config.enabled && clientIdSetting.available && setting.available && setting.enabled;
  return {
    ...config,
    configurationAvailable: config.enabled && clientIdSetting.available,
    clientIdPresent: Boolean(config.clientId),
    settingAvailable: setting.available && clientIdSetting.available,
    settingEnabled: setting.enabled,
    enabled,
    mode: enabled ? config.mode : GOOGLE_MODE_UNAVAILABLE,
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
  const clientIdSetting = await googleClientIdStatus();
  if (!clientIdSetting.available) {
    throw new AppError(503, 'Google sign-in configuration could not be loaded. Please try again.');
  }
  const clientId = clientIdSetting.clientId;
  if (!clientId) throw googleNotConfigured();
  if (typeof credential !== 'string' || !credential.trim()) {
    throw new ValidationError({ credential: 'A Google credential is required.' });
  }

  let payload;
  try {
    payload = await tokenVerifier(credential.trim(), clientId);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AuthenticationError('Google sign-in could not be verified. Please try again.');
  }
  if (!payload || typeof payload !== 'object') {
    throw new AuthenticationError('Google sign-in could not be verified. Please try again.');
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  const skew = env.googleClockSkewSeconds;

  if (payload.aud !== clientId) {
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
  assertApprovedGoogleAccount(hostedDomain, email, clientId);

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
function assertApprovedGoogleAccount(hostedDomain, email, clientId = env.googleClientId) {
  const mode = googleSignInMode(clientId);

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
export async function startGoogleSession(request) {
  const config = await googleOAuthAvailability();
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
  if (user.archivedAt || !isApproved(user)) {
    throw new PermissionError('This account is not currently eligible to sign in. Contact an administrator.');
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
 * A legacy selectedRole value is only an optional presentation hint. It never
 * grants, changes or implies a role: the stored profile role is the single
 * source of truth, and this function only reports a mismatch for older callers.
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

  await assertGoogleOAuthEnabled();
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

/**
 * Step 2. Submits an EMAIL-ONLY account request for a verified Google identity.
 *
 * GST001.0 / AD003.3: OAuth alone must not grant an application role or access,
 * and NO User account is created here. The applicant provides NOTHING typed:
 * the email and name come from the VERIFIED ID token (never browser input), and
 * the pending role is inferred server-side from the verified email domain (see
 * PENDING_ROLE_BY_EMAIL_DOMAIN). Department/course is assigned by an
 * administrator during approval and is never collected from the applicant.
 * Repeat submissions update the same pending request (safe handling of repeats).
 */
export async function completeGoogleProfile(request, body) {
  const oauthSetting = await googleOAuthStatus();
  if (!oauthSetting.available || !oauthSetting.enabled) {
    delete request.session.pendingGoogleIdentity;
    throw new AppError(503, 'Google signup is disabled by an administrator. Use email verification instead.');
  }
  const identity = request.session.pendingGoogleIdentity;
  if (!identity) {
    throw new ValidationError({ profile: 'Start Google sign-in again before completing your profile.' });
  }
  if (Object.hasOwn(body || {}, 'role') || Object.hasOwn(body || {}, 'approvalStatus') || Object.hasOwn(body || {}, 'isActive')) {
    throw new ValidationError({ role: 'Your role is assigned by an administrator and cannot be chosen here.' });
  }
  if (Object.hasOwn(body || {}, 'department')) {
    // The department dropdown moved to the ADMIN approval screen. A browser that
    // still submits one (stale page, scripted request) is told so explicitly
    // rather than having the value silently ignored.
    throw new ValidationError({ department: 'Your department is assigned by an administrator when your request is reviewed.' });
  }

  // From the verified Google identity only. An unmatched domain simply gets no
  // inferred role; the administrator assigns one at approval.
  const pendingRole = pendingRoleForEmail(identity.email);

  // A simultaneous approval already created the account for this identity.
  // Sign that account in instead of failing, so one person never ends up with two users.
  const approved = await loadLinkedUser(identity.sub).catch(() => null);
  if (approved) {
    delete request.session.pendingGoogleIdentity;
    return signInDocument(request, approved.document);
  }

  try {
    await SignupRequest.findOneAndUpdate(
      { googleSub: identity.sub },
      {
        $set: {
          googleEmail: identity.email,
          googleEmailNormalized: identity.emailNormalized,
          googleHostedDomain: identity.hostedDomain || '',
          googlePictureUrl: identity.picture || '',
          // Verified Google profile details, kept for the administrator's review.
          displayName: (identity.name || '').slice(0, 150),
          pendingRole,
          status: 'pending',
          reviewedAt: null,
          reviewedBy: null,
        },
        // Email-only request: accountId, department and phone stay empty until
        // an administrator assigns them during approval. A repeat submission
        // never overwrites them with browser input because it never receives any.
        $setOnInsert: { createdAt: new Date(), accountId: '', department: '', phone: '' },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
  } catch (error) {
    if (error?.code === 11000) {
      throw new ConflictError({ accountId: 'A request for this Google account is already in review.' });
    }
    throw error;
  }

  delete request.session.pendingGoogleIdentity;
  return { status: GOOGLE_SIGNUP_PENDING };
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
  await assertGoogleOAuthEnabled();
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
