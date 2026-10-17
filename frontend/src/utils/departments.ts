/**
 * The department/program options offered on account-creation forms (Google
 * signup and the admin account editor).
 *
 * Mirrors DEPARTMENTS in backend/src/utils/domain.js. The server re-validates
 * every submission, so this list is a UX aid, not the security control.
 */
export const DEPARTMENTS: string[] = ['IT', 'BSEMC', 'BSFT', 'BSAT', 'BSET'];