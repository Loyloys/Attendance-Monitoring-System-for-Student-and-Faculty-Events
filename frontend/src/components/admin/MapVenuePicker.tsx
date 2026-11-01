import { useCallback, useEffect, useRef, useState } from 'react';
import * as L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { geocodePlaces, type GeocodeResult, isValidCoordinate } from '../../utils/geocoding';

export type Coordinate = { latitude: number; longitude: number };

const DEFAULT_CENTER: Coordinate = { latitude: 20, longitude: 0 };
const DEFAULT_ZOOM = 2;
const VENUE_ZOOM = 15;
const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_ATTRIBUTION = '� OpenStreetMap contributors';

type MapVenuePickerProps = {
  venue?: Coordinate;
  polygon: Coordinate[];
  onVenueSelected: (selection: { name: string; latitude: number; longitude: number }) => void;
  onPolygonChanged: (points: Coordinate[]) => void;
};

export default function MapVenuePicker({
  venue,
  polygon,
  onVenueSelected,
  onPolygonChanged,
}: MapVenuePickerProps) {
  const mapElement = useRef<HTMLDivElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const resultsElement = useRef<HTMLUListElement>(null);

  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const drawnPolygonRef = useRef<L.Polygon | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const initializedRef = useRef(false);
  const modeRef = useRef<'venue' | 'polygon'>('venue');
  const venueRef = useRef<Coordinate | undefined>(venue);
  const onVenueSelectedRef = useRef(onVenueSelected);
  const onPolygonChangedRef = useRef(onPolygonChanged);

  const [mode, setMode] = useState<'venue' | 'polygon'>('venue');

  modeRef.current = mode;
  venueRef.current = venue;
  onVenueSelectedRef.current = onVenueSelected;
  onPolygonChangedRef.current = onPolygonChanged;

  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState('');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GeocodeResult[]>([]);
  const [geocodePhase, setGeocodePhase] = useState<'idle' | 'searching' | 'error'>('idle');

  const selectLocation = useCallback(
    (latitude: number, longitude: number, name = '') => {
      if (!isValidCoordinate(latitude, longitude)) return;
      const map = mapRef.current;
      const position = [latitude, longitude];
      if (map) {
        map.setView(L.latLng(position[0], position[1]), VENUE_ZOOM);
        ensureMarker(L.latLng(latitude, longitude), map);
      }
      onVenueSelectedRef.current({ name, latitude, longitude });
    },
    []
  );

  const ensureMarker = useCallback(
    (latLng: L.LatLng, map: L.Map) => {
      const marker = markerRef.current;
      if (marker) {
        marker.setLatLng(latLng);
        return;
      }
      const created = L.marker(latLng, { draggable: true }).addTo(map);
      markerRef.current = created;
      created.on('dragend', () => {
        const current = created.getLatLng();
        selectLocation(current.lat, current.lng, '');
      });
    },
    [selectLocation]
  );

  function redrawPolygon(map: L.Map): void {
    drawnPolygonRef.current?.remove();
    drawnPolygonRef.current = null;
    if (polygon.length >= 2) {
      drawnPolygonRef.current = L.polygon(polygon.map(point => L.latLng(point.latitude, point.longitude))).addTo(map);
    }
  }

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (venueRef.current) {
      const position = [venueRef.current.latitude, venueRef.current.longitude];
      ensureMarker(L.latLng(position[0], position[1]), map);
      if (!map.getBounds().contains(L.latLng(position[0], position[1]))) map.setView(L.latLng(position[0], position[1]), VENUE_ZOOM);
    } else {
      markerRef.current?.remove();
      markerRef.current = null;
    }
    redrawPolygon(map);
  }, [ensureMarker, redrawPolygon]);

  useEffect(() => {
    if (initializedRef.current || !mapElement.current) return;
    const map = L.map(mapElement.current, {
      center: [DEFAULT_CENTER.latitude, DEFAULT_CENTER.longitude],
      zoom: DEFAULT_ZOOM,
      attributionControl: true,
    });
    mapRef.current = map;

    const tileLayer = L.tileLayer(TILE_URL, {
      attribution: TILE_ATTRIBUTION,
      maxZoom: 19,
    }).addTo(map);
    tileLayerRef.current = tileLayer;

    let tileFailed = false;
    tileLayer.on('tileerror', () => {
      if (tileFailed) return;
      tileFailed = true;
      setStatus('error');
      setMessage(
        'Map tiles could not load. The map display is unavailable, but you can still ' +
          'enter coordinates manually or choose a saved venue.'
      );
    });

    const start = venueRef.current
      ? [venueRef.current.latitude, venueRef.current.longitude]
      : [DEFAULT_CENTER.latitude, DEFAULT_CENTER.longitude];
    map.setView(L.latLng(start[0], start[1]), venueRef.current ? VENUE_ZOOM : DEFAULT_ZOOM);

    if (venueRef.current) {
      ensureMarker(L.latLng(venueRef.current.latitude, venueRef.current.longitude), map);
    }

    map.on('click', (event: L.LeafletMouseEvent) => {
      if (modeRef.current !== 'venue') return;
      selectLocation(event.latlng.lat, event.latlng.lng, '');
    });

    initializedRef.current = true;
    setStatus('ready');

    return () => {
      map.off();
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
      drawnPolygonRef.current = null;
      tileLayerRef.current = null;
      initializedRef.current = false;
    };
  }, [ensureMarker, selectLocation]);

  const handleSearch = useCallback(async () => {
    const q = query.trim();
    if (!q) return;
    setGeocodePhase('searching');
    setMessage('');
    try {
      const found = await geocodePlaces(q);
      setResults(found);
      setGeocodePhase('idle');
      if (found.length === 0) {
        setMessage('No places found for that search.');
      }
    } catch (error) {
      setGeocodePhase('error');
      setResults([]);
      setMessage(error instanceof Error ? error.message : 'Place search failed. Try again.');
    }
  }, [query]);

  const handleResultSelect = useCallback(
    (result: GeocodeResult) => {
      selectLocation(result.latitude, result.longitude, result.name);
      setQuery('');
      setResults([]);
      setGeocodePhase('idle');
      setMessage(`Selected ${result.name}.`);
    },
    [selectLocation]
  );

  const undoPoint = useCallback(() => {
    onPolygonChangedRef.current(polygon.slice(0, -1));
  }, [polygon]);

  return (
    <section
      className="sm:col-span-2 rounded-xl border border-[#E2E3DF] bg-[#FAF9F5] p-3"
      aria-label="Map venue and polygon picker"
      data-testid="map-venue-picker"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-[#10203B]">Map venue picker</h3>
          <p className="text-xs text-[#64748B]">
            Click the map or search for a place to choose the event venue. Coordinates
            are never guessed - a venue is chosen only by an explicit selection.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setMode('venue')}
            aria-pressed={mode === 'venue'}
            data-testid="mode-venue"
            className={`rounded-lg px-3 py-2 text-xs font-semibold ${
              mode === 'venue' ? 'bg-orange-100 text-orange-800' : 'bg-white text-slate-600'
            }`}
          >
            Pick venue
          </button>
          <button
            type="button"
            onClick={() => setMode('polygon')}
            aria-pressed={mode === 'polygon'}
            data-testid="mode-polygon"
            className={`rounded-lg px-3 py-2 text-xs font-semibold ${
              mode === 'polygon' ? 'bg-orange-100 text-orange-800' : 'bg-white text-slate-600'
            }`}
          >
            Draw fence
          </button>
        </div>
      </div>

      {mode === 'venue' && (
        <div className="my-3 flex flex-wrap gap-2" data-testid="venue-search">
          <label className="flex items-center gap-2 text-xs font-semibold text-[#10203B]">
            Search places
            <span className="text-[#64748B]" data-testid="search-provider-label">
              (OpenStreetMap Nominatim)
            </span>
          </label>
          <input
            ref={searchInput}
            type="text"
            placeholder="e.g. Ateneo de Manila University"
            value={query}
            onChange={event => setQuery(event.target.value)}
            data-testid="venue-search-input"
            className="rounded-xl border border-[#E2E3DF] bg-white px-3 py-2 text-sm text-[#10203B] focus:border-[#F97316] focus:ring-2 focus:ring-[#F97316]/15"
          />
          <button
            type="button"
            onClick={handleSearch}
            disabled={geocodePhase === 'searching'}
            data-testid="venue-search-button"
            className="rounded-xl px-3 py-2 text-sm font-semibold text-white bg-[#F97316] disabled:opacity-50"
          >
            {geocodePhase === 'searching' ? 'Searching�' : 'Search'}
          </button>
        </div>
      )}

      {geocodePhase === 'searching' && (
        <p role="status" className="mt-2 text-xs text-[#64748B]" data-testid="geocode-searching">
          Searching places�
        </p>
      )}
      {geocodePhase === 'error' && (
        <p role="alert" className="mt-2 text-xs text-rose-700" data-testid="geocode-error">
          {message}
        </p>
      )}
      {results.length > 0 && (
        <ul ref={resultsElement} className="mt-2 max-h-48 overflow-y-auto rounded-xl border border-[#E2E3DF] bg-white text-sm" data-testid="venue-search-results">
          {results.map((result, index) => (
            <li key={index} className="px-3 py-2 hover:bg-[#FAF9F5] cursor-pointer">
              <button
                type="button"
                onClick={() => handleResultSelect(result)}
                data-testid={`search-result-${index}`}
                className="w-full text-left text-[#10203B] truncate"
              >
                {result.name}
              </button>
            </li>
          ))}
        </ul>
      )}

      <div
        ref={mapElement}
        className="h-64 w-full rounded-lg"
        aria-label="Venue map"
        data-testid="venue-map"
      />

      {status === 'ready' && !venue && (
        <p className="mt-3 rounded-lg border border-slate-200 bg-white p-3 text-xs text-slate-600" data-testid="map-neutral-hint">
          The map is centred on a neutral starting view. Click the map (or search
          above) to choose the event venue; the map centre alone is not saved.
        </p>
      )}

      {mode === 'polygon' && status === 'ready' && (
        <div className="mt-2 flex items-center justify-between gap-2 text-xs text-[#64748B]">
          <span data-testid="polygon-vertex-count">
            Click the map to add boundary vertices ({polygon.length}; at least 3 to save).
          </span>
          <button
            type="button"
            disabled={!polygon.length}
            onClick={undoPoint}
            data-testid="undo-polygon-point"
            className="rounded-lg border border-[#E2E3DF] bg-white px-3 py-1.5 font-semibold disabled:opacity-50"
          >
            Undo last point
          </button>
        </div>
      )}

      {status !== 'ready' && (
        <p
          role={status === 'error' ? 'alert' : 'status'}
          className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900"
          data-testid="map-status-message"
        >
          {message || 'Loading map�'}
        </p>
      )}
      {status === 'ready' && message && (
        <p className="mt-2 text-xs text-[#475569]" data-testid="map-status-message">{message}</p>
      )}
    </section>
  );
}
