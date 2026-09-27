export class AppError extends Error {
  constructor(status, message, details, code) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    if (details !== undefined) this.details = details;
    // A stable, machine-readable marker so the browser can react to one specific
    // condition (for example a Google role mismatch) without parsing prose. It is
    // always a string, because MongoDB reuses a numeric `code` for duplicate keys.
    if (typeof code === 'string') this.code = code;
  }
}

export class ValidationError extends AppError {
  constructor(details, message = 'The submitted data is invalid.') {
    super(400, message, details);
    this.name = 'ValidationError';
  }
}

export class AuthenticationError extends AppError {
  constructor(message = 'Authentication credentials were not provided.') {
    super(401, message);
    this.name = 'AuthenticationError';
  }
}

export class PermissionError extends AppError {
  constructor(message = 'This action is not available for your role.', details, code) {
    super(403, message, details, code);
    this.name = 'PermissionError';
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'The requested resource was not found.') {
    super(404, message);
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends AppError {
  constructor(message = 'The request conflicts with existing data.') {
    super(409, message);
    this.name = 'ConflictError';
  }
}

export const asyncHandler = (handler) => (request, response, next) => {
  Promise.resolve(handler(request, response, next)).catch(next);
};

export const asyncRoute = (handler) => asyncHandler(handler);

export function requireFields(body, fields) {
  const missing = fields.filter((field) => body[field] === undefined || body[field] === null);
  if (missing.length) {
    throw new ValidationError(Object.fromEntries(missing.map((field) => [field, 'This field is required.'])));
  }
}

export function requireString(value, field, { min = 1, max = 1000, trim = true } = {}) {
  if (typeof value !== 'string') throw new ValidationError({ [field]: 'A string value is required.' });
  const result = trim ? value.trim() : value;
  if (result.length < min || result.length > max) {
    throw new ValidationError({ [field]: `Use between ${min} and ${max} characters.` });
  }
  return result;
}

export function requireEmail(value, field = 'email') {
  const email = requireString(value, field, { max: 254 }).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new ValidationError({ [field]: 'Enter a valid email address.' });
  }
  return email;
}
