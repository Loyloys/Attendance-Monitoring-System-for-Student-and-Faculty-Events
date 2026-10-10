/**
 * GST004 saved venues.
 *
 * Administrator-only, mounted under the same `requireRole('admin')` guard as
 * every other admin route, so a student or a faculty member can never read,
 * create or delete one. The mutation endpoints are POST/PATCH/DELETE and so
 * still pass through the global CSRF layer like every other write.
 */
import * as service from '../services/venueService.js';

export async function list(request, response) {
  if (request.method === 'GET') return response.json(await service.listVenues());
  return response.status(201).json(await service.createVenue(request.body));
}

export async function detail(request, response) {
  let venue;
  if (request.method === 'PATCH') {
    venue = await service.updateVenue(request.params.venueId, request.body);
  } else if (request.method === 'DELETE') {
    venue = await service.removeVenue(request.params.venueId);
  } else {
    venue = (await service.listVenues()).find((entry) => entry.id === request.params.venueId);
  }
  return response.json(venue);
}
