export function requireJsonObject(request, response, next) {
  if (!request.is('application/json') || !request.body || typeof request.body !== 'object' || Array.isArray(request.body)) {
    return response.status(400).json({ detail: 'Request body must be a JSON object.' });
  }
  return next();
}
