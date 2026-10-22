import { useEffect, useRef, useState } from 'react';

export type Coordinate = { latitude: number; longitude: number };
type GooglePlace = {
  displayName?: { text?: string } | string;
  formattedAddress?: string;
  location?: { lat(): number; lng(): number };
  fetchFields(options: { fields: string[] }): Promise<void>;
};
type GoogleMapsApi = {
  importLibrary(name: string): Promise<unknown>;
};
type GooglePlaceAutocomplete = HTMLElement;
type GoogleMapsLibrary = {
  Map: new (element: HTMLElement, options: Record<string, unknown>) => GoogleMapInstance;
  Marker: new (options: { map: unknown; position: { lat: number; lng: number } }) => GoogleMarkerInstance;
  Polygon: new (options: { map: unknown; paths: { lat: number; lng: number }[] }) => GooglePolygonInstance;
};
type GoogleMapInstance = {
    setCenter(point: { lat: number; lng: number }): void;
    addListener(event: string, callback: (event: { latLng?: { lat(): number; lng(): number } }) => void): { remove(): void };
};
type GoogleMarkerInstance = { setMap(map: null): void };
type GooglePolygonInstance = { setMap(map: null): void };
type GooglePlacesLibrary = {
  PlaceAutocompleteElement: new () => GooglePlaceAutocomplete;
};

type WindowWithMaps = Window & {
  google?: { maps: GoogleMapsApi };
  __attendanceMapsReady?: () => void;
};

let mapsPromise: Promise<GoogleMapsApi> | null = null;

function loadGoogleMaps(key: string): Promise<GoogleMapsApi> {
  const mapsWindow = window as WindowWithMaps;
  if (mapsWindow.google?.maps) return Promise.resolve(mapsWindow.google.maps);
  if (!mapsPromise) {
    mapsPromise = new Promise((resolve, reject) => {
      mapsWindow.__attendanceMapsReady = () => {
        if (!mapsWindow.google?.maps) {
          reject(new Error('Google Maps loaded without its Maps JavaScript API.'));
          return;
        }
        resolve(mapsWindow.google.maps);
      };
      const script = document.createElement('script');
      script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly&libraries=places&loading=async&callback=__attendanceMapsReady`;
      script.async = true;
      script.onerror = () => {
        mapsPromise = null;
        reject(new Error('Google Maps could not load. Check API enablement, key restrictions, billing, and network access.'));
      };
      document.head.append(script);
    });
  }
  return mapsPromise;
}

function pointOf(point: Coordinate) {
  return { lat: point.latitude, lng: point.longitude };
}

export default function GoogleMapsVenuePicker({
  venue,
  polygon,
  onVenueSelected,
  onPolygonChanged,
}: {
  venue?: Coordinate;
  polygon: Coordinate[];
  onVenueSelected: (selection: { name: string; latitude: number; longitude: number }) => void;
  onPolygonChanged: (points: Coordinate[]) => void;
}) {
  const mapElement = useRef<HTMLDivElement>(null);
  const searchElement = useRef<HTMLDivElement>(null);
  const mapRef = useRef<GoogleMapInstance | null>(null);
  const mapsRef = useRef<GoogleMapsLibrary | null>(null);
  const markerRef = useRef<GoogleMarkerInstance | null>(null);
  const mapPolygonRef = useRef<GooglePolygonInstance | null>(null);
  const [mode, setMode] = useState<'venue' | 'polygon'>('venue');
  const [status, setStatus] = useState<'loading' | 'ready' | 'unavailable' | 'error'>('loading');
  const [message, setMessage] = useState('');
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
  const modeRef = useRef(mode);
  const pointsRef = useRef(polygon);
  const onPolygonChangedRef = useRef(onPolygonChanged);
  modeRef.current = mode;
  pointsRef.current = polygon;
  onPolygonChangedRef.current = onPolygonChanged;

  useEffect(() => {
    if (!apiKey) {
      setStatus('unavailable');
      setMessage('Google Maps is not configured. Set VITE_GOOGLE_MAPS_API_KEY in frontend/.env.local.');
      return;
    }
    let active = true;
    let clickListener: { remove(): void } | null = null;
    let placeElement: GooglePlaceAutocomplete | null = null;
    const initialize = async () => {
      try {
        const maps = await loadGoogleMaps(apiKey);
        const [mapsLibrary, placesLibrary] = await Promise.all([
          maps.importLibrary('maps') as Promise<GoogleMapsLibrary>,
          maps.importLibrary('places') as Promise<GooglePlacesLibrary>,
        ]);
        if (!active || !mapElement.current || !searchElement.current) return;
        mapsRef.current = mapsLibrary;
        let map = mapRef.current;
        const createMap = (center: Coordinate) => {
          if (!mapElement.current) throw new Error('The map display is unavailable.');
          map = new mapsLibrary.Map(mapElement.current, { center: pointOf(center), zoom: 17, mapTypeControl: false });
          mapRef.current = map;
          markerRef.current = new mapsLibrary.Marker({ map, position: pointOf(center) });
          clickListener = map.addListener('click', (event) => {
            if (modeRef.current !== 'polygon' || !event.latLng) return;
            onPolygonChangedRef.current([...pointsRef.current, { latitude: event.latLng.lat(), longitude: event.latLng.lng() }]);
          });
          return map;
        };
        if (venue && !map) createMap(venue);
        placeElement = new placesLibrary.PlaceAutocompleteElement();
        placeElement.setAttribute('aria-label', 'Search Google Maps for a venue');
        placeElement.setAttribute('placeholder', 'Search Google Maps for a venue');
        searchElement.current.replaceChildren(placeElement);
        placeElement.addEventListener('gmp-select', async (rawEvent) => {
          try {
            const event = rawEvent as CustomEvent<{ placePrediction?: { toPlace(): GooglePlace } }>;
            const place = event.detail?.placePrediction?.toPlace();
            if (!place) throw new Error('Google Maps did not return a selected place.');
            await place.fetchFields({ fields: ['displayName', 'formattedAddress', 'location'] });
            if (!place.location) throw new Error('This Google Maps result has no verified coordinates.');
            const displayName = typeof place.displayName === 'string' ? place.displayName : place.displayName?.text;
            const name = displayName?.trim() || place.formattedAddress?.trim();
            if (!name) throw new Error('This Google Maps result has no venue name.');
            const selection = { name, latitude: place.location.lat(), longitude: place.location.lng() };
            onVenueSelected(selection);
            const currentMap = map || createMap(selection);
            currentMap.setCenter(pointOf(selection));
            markerRef.current?.setMap(null);
            markerRef.current = new mapsLibrary.Marker({ map: currentMap, position: pointOf(selection) });
            setMessage(`Selected verified Google Maps result: ${name}.`);
          } catch (error) {
            setMessage(error instanceof Error ? error.message : 'The selected map result could not be used.');
          }
        });
        setStatus('ready');
      } catch (error) {
        if (!active) return;
        setStatus('error');
        setMessage(error instanceof Error ? error.message : 'Google Maps could not be initialized.');
      }
    };
    void initialize();
    return () => {
      active = false;
      clickListener?.remove();
      placeElement?.remove();
    };
  // API script is loaded once; refs keep map event handlers current without remounting it.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey]);

  useEffect(() => {
    const map = mapRef.current;
    const maps = mapsRef.current;
    if (!map || !maps) return;
    mapPolygonRef.current?.setMap(null);
    mapPolygonRef.current = polygon.length >= 2
      ? new maps.Polygon({ map, paths: polygon.map(pointOf) })
      : null;
  }, [polygon, status]);

  return <section className="sm:col-span-2 rounded-xl border border-[#E2E3DF] bg-[#FAF9F5] p-3" aria-label="Map venue and polygon picker">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div><h3 className="text-sm font-semibold text-[#10203B]">Map venue picker</h3><p className="text-xs text-[#64748B]">Selecting a Google Maps result fills the saved venue name and coordinates.</p></div>
      <div className="flex gap-2">
        <button type="button" onClick={() => setMode('venue')} aria-pressed={mode === 'venue'} className={`rounded-lg px-3 py-2 text-xs font-semibold ${mode === 'venue' ? 'bg-orange-100 text-orange-800' : 'bg-white text-slate-600'}`}>Pick venue</button>
        <button type="button" onClick={() => setMode('polygon')} aria-pressed={mode === 'polygon'} className={`rounded-lg px-3 py-2 text-xs font-semibold ${mode === 'polygon' ? 'bg-orange-100 text-orange-800' : 'bg-white text-slate-600'}`}>Draw fence</button>
      </div>
    </div>
    {apiKey && <div ref={searchElement} className={`my-3 ${status === 'ready' && mode === 'venue' ? '' : 'hidden'}`} />}
    {apiKey && <div ref={mapElement} className={`h-64 w-full rounded-lg ${status === 'ready' && venue ? '' : 'hidden'}`} aria-label="Google map" />}
    {apiKey && status === 'ready' && !venue && <p className="mt-3 rounded-lg border border-slate-200 bg-white p-3 text-xs text-slate-600">Select a Google Maps search result to display the map. Venue coordinates are never guessed.</p>}
    {mode === 'polygon' && status === 'ready' && <div className="mt-2 flex items-center justify-between gap-2 text-xs text-[#64748B]"><span>Click the map to add boundary vertices ({polygon.length}; at least 3 to save).</span><button type="button" disabled={!polygon.length} onClick={() => onPolygonChanged(polygon.slice(0, -1))} className="rounded-lg border border-[#E2E3DF] bg-white px-3 py-1.5 font-semibold disabled:opacity-50">Undo last point</button></div>}
    {status !== 'ready' && <p role={status === 'error' ? 'alert' : 'status'} className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">{message || 'Loading Google Maps…'}</p>}
    {status === 'ready' && message && <p role="status" className="mt-2 text-xs text-[#475569]">{message}</p>}
  </section>;
}
