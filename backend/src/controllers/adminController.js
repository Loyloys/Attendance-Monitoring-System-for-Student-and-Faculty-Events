import {
  addAttendance,
  adminState,
  correctAttendance,
  createAdminUser,
  deleteAdminUser,
  deleteAttendance,
  deleteForm,
  listAuditLog,
  saveForm,
  updateAdminUser,
} from '../services/adminService.js';

import { archiveLegacyBrowserState } from '../services/legacyBrowserImportService.js';

export async function state(request, response) {
  response.json(await adminState());
}

export async function importLegacyBrowserState(request, response) {
  response.status(201).json(await archiveLegacyBrowserState(request.user, request.body.payload));
}

// AD003: who changed whose role, and when.
export async function auditLog(request, response) {
  response.json(await listAuditLog(request.query.limit));
}

export async function createUser(request, response) {
  response.status(201).json(await createAdminUser(request.body, request.user));
}

export async function updateUser(request, response) {
  response.json(await updateAdminUser(request.params.accountId, request.body, request.user));
}

export async function deleteUser(request, response) {
  await deleteAdminUser(request.params.accountId, request.user);
  response.status(204).end();
}

export async function createAttendance(request, response) {
  response.status(201).json(await addAttendance(request.body));
}

export async function updateAttendance(request, response) {
  response.json(await correctAttendance(request.params.recordId, request.body));
}

export async function removeAttendance(request, response) {
  await deleteAttendance(request.params.recordId);
  response.status(204).end();
}

export async function createOrUpdateForm(request, response) {
  const result = await saveForm(request.body);
  response.status(request.body.id ? 200 : 201).json(result);
}

export async function removeForm(request, response) {
  await deleteForm(request.params.formId);
  response.status(204).end();
}
