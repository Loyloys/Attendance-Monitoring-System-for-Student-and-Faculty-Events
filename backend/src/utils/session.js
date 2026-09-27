/**
 * Helpers for the server-side session, which is backed by MongoDB and carried in
 * an HttpOnly cookie. Used by every sign-in path so password and Google logins
 * behave identically.
 */
export function regenerateSession(request) {
  return new Promise((resolve, reject) => {
    request.session.regenerate((error) => (error ? reject(error) : resolve()));
  });
}

export function destroySession(request) {
  return new Promise((resolve) => {
    request.session.destroy(() => resolve());
  });
}
