import {
  pushNotificationStatus,
  registerPushDevice,
  unregisterPushDevice,
} from '../services/pushNotificationService.js';

export async function notificationStatus(request, response) {
  response.json(await pushNotificationStatus());
}

export async function registerDevice(request, response) {
  response.status(201).json(await registerPushDevice(request.user._id, request.body.token));
}

export async function unregisterDevice(request, response) {
  response.json(await unregisterPushDevice(request.user._id, request.body.token));
}
