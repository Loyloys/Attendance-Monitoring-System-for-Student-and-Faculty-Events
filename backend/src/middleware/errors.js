import { AppError, ValidationError } from '../utils/errors.js';

export function notFound(request, response) {
  response.status(404).json({ detail: 'Not found.' });
}

export function errorHandler(error, request, response, next) {
  if (response.headersSent) return next(error);

  let status = error.status || error.statusCode || 500;
  let payload = { detail: status >= 500 ? 'An unexpected server error occurred.' : error.message };

  if (error instanceof ValidationError) {
    payload = { detail: error.message, ...error.details };
  } else if (error.name === 'ValidationError' && error.errors) {
    status = 400;
    payload = Object.fromEntries(Object.entries(error.errors).map(([field, detail]) => [field, detail.message]));
  } else if (error.name === 'CastError') {
    status = 400;
    payload = { detail: 'A supplied identifier or value has an invalid format.' };
  } else if (error.code === 11000) {
    status = 409;
    const field = Object.keys(error.keyPattern || error.keyValue || {})[0] || 'field';
    payload = { detail: 'A record with that unique value already exists.', [field]: 'This value is already in use.' };
  } else if (error.type === 'entity.parse.failed') {
    status = 400;
    payload = { detail: 'Request body contains invalid JSON.' };
  } else if (error instanceof AppError && error.details) {
    payload = { detail: error.message, ...error.details };
  }

  // Only a string code is echoed. MongoDB's duplicate-key errors carry a numeric
  // `code`, which must never reach the client.
  if (typeof error.code === 'string') payload.code = error.code;

  if (status >= 500 && process.env.NODE_ENV !== 'test') console.error(error);
  return response.status(status).json(payload);
}
