// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach } from 'vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import MapVenuePicker from '../src/components/admin/MapVenuePicker';
import * as L from 'leaflet';

type Coordinate = { latitude: number; longitude: number };

const mockOnVenueSelected = vi.fn();
const mockOnPolygonChanged = vi.fn();

type LeafletMock = typeof L & {
  __triggerMapClick: (event: { latlng: { lat: number; lng: number } }) => void;
  __triggerMarkerDragend: () => void;
  __fireTileError: () => void;
  __resetHandlers: () => void;
  mapStub: { setView: any };
  dragPosition: { lat: number; lng: number };
};
const leafletMock = L as LeafletMock;

vi.mock('leaflet', () => {
  const clickHandler = { current: null as ((event: { latlng: { lat: number; lng: number } }) => void) | null };
  const tileErrorHandler = { current: null as (() => void) | null };
  const dragendHandler = { current: null as (() => void) | null };
  const dragPosition = { lat: 0, lng: 0 };

  const mapStub = {
    setView: vi.fn(),
    getBounds: vi.fn(() => ({ contains: vi.fn(() => false) })),
    on: vi.fn((event: string, handler: () => void) => {
      if (event === 'click') clickHandler.current = handler;
      return mapStub;
    }),
    off: vi.fn(),
    remove: vi.fn(),
  };

  const markerStub = {
    setLatLng: vi.fn(),
    getLatLng: vi.fn(() => dragPosition),
    addTo: vi.fn(() => markerStub),
    on: vi.fn((event: string, handler: () => void) => {
      if (event === 'dragend') dragendHandler.current = handler;
      return markerStub;
    }),
  };

  const tileLayerStub = {
    addTo: vi.fn(() => tileLayerStub),
    on: vi.fn((event: string, handler: () => void) => {
      if (event === 'tileerror') tileErrorHandler.current = handler;
      return tileLayerStub;
    }),
  };

  const polygonStub = { remove: vi.fn(), addTo: vi.fn(() => polygonStub) };

  return {
    latLng: vi.fn((lat: number, lng: number) => ({ lat, lng })),
    map: vi.fn(() => mapStub),
    marker: vi.fn(() => markerStub),
    tileLayer: vi.fn(() => tileLayerStub),
    polygon: vi.fn(() => polygonStub),
    mapStub: mapStub,
    dragPosition: dragPosition,
    __triggerMapClick: vi.fn((event: { latlng: { lat: number; lng: number } }) => {
      clickHandler.current?.(event);
    }),
    __triggerMarkerDragend: vi.fn(() => {
      dragendHandler.current?.();
    }),
    __fireTileError: vi.fn(() => {
      tileErrorHandler.current?.();
    }),
    __resetHandlers: vi.fn(() => {
      clickHandler.current = null;
      tileErrorHandler.current = null;
      dragendHandler.current = null;
    }),
  };
});

function renderPicker(overrides?: { venue?: Coordinate; polygon?: Coordinate[] }) {
  return render(
    <MapVenuePicker
      venue={overrides?.venue}
      polygon={overrides?.polygon ?? []}
      onVenueSelected={mockOnVenueSelected}
      onPolygonChanged={mockOnPolygonChanged}
    />,
  );
}

function triggerMapClick(latlng: { lat: number; lng: number }) {
  act(() => {
    leafletMock.__triggerMapClick({ latlng });
  });
}

function triggerMarkerDragend() {
  act(() => {
    leafletMock.__triggerMarkerDragend();
  });
}

function fireTileError() {
  act(() => {
    leafletMock.__fireTileError();
  });
}

function setDragPosition(lat: number, lng: number) {
  leafletMock.dragPosition.lat = lat;
  leafletMock.dragPosition.lng = lng;
}

describe('MapVenuePicker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    leafletMock.__resetHandlers();
    leafletMock.dragPosition.lat = 0;
    leafletMock.dragPosition.lng = 0;
  });
  afterEach(() => {
    cleanup();
  });


  it('renders the picker, mode tabs, and neutral hint', () => {
    renderPicker();

    expect(screen.getByTestId('map-venue-picker')).toBeInTheDocument();
    expect(screen.getByText('Map venue picker')).toBeInTheDocument();
    expect(screen.getByTestId('mode-venue')).toBeInTheDocument();
    expect(screen.getByTestId('mode-polygon')).toBeInTheDocument();
    expect(screen.getByTestId('map-neutral-hint')).toBeInTheDocument();
    expect(screen.getByTestId('venue-map')).toBeInTheDocument();
  });

  it('starts in venue mode', () => {
    renderPicker();
    expect(screen.getByTestId('mode-venue')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('mode-polygon')).toHaveAttribute('aria-pressed', 'false');
  });

  it('selects a venue when the map is clicked', () => {
    renderPicker();

    triggerMapClick({ lat: 10.5, lng: 123.2 });

    expect(mockOnVenueSelected).toHaveBeenCalledTimes(1);
    expect(mockOnVenueSelected).toHaveBeenCalledWith({
      name: '',
      latitude: 10.5,
      longitude: 123.2,
    });
  });

  it('selects a venue when the marker is dragged', () => {
    renderPicker();

    triggerMapClick({ lat: 1, lng: 2 });
    setDragPosition(40.5, 122.2);
    triggerMarkerDragend();

    expect(mockOnVenueSelected).toHaveBeenCalledTimes(2);
    expect(mockOnVenueSelected).toHaveBeenLastCalledWith({
      name: '',
      latitude: 40.5,
      longitude: 122.2,
    });
  });

  it('keeps a marker on a saved venue and does not treat it as a selection', () => {
    const venue: Coordinate = { latitude: 10, longitude: 123 };
    renderPicker({ venue });

    expect(L.map).toHaveBeenCalledTimes(1);
    expect(L.marker).toHaveBeenCalledTimes(1);
    expect(mockOnVenueSelected).not.toHaveBeenCalled();
    expect(L.marker.mock.calls[0][0]).toEqual({ lat: 10, lng: 123 });

    expect(
      leafletMock.mapStub.setView.mock.calls.some(
        (call) => call[0].lat === 10 && call[0].lng === 123 && call[1] === 15,
      ),
    ).toBe(true);
  });

  it('draws a polygon fence from the polygon prop', () => {
    const polygon: Coordinate[] = [
      { latitude: 10, longitude: 123 },
      { latitude: 11, longitude: 124 },
    ];
    renderPicker({ polygon });

    expect(L.polygon).toHaveBeenCalledTimes(1);
    const expected = polygon.map((point) => ({
      lat: point.latitude,
      lng: point.longitude,
    }));
    expect(L.polygon.mock.calls[0][0]).toEqual(expected);
  });

  it('shows a fallback message when the map tiles fail to load', () => {
    renderPicker();

    fireTileError();

    expect(
      screen.getByTestId('map-status-message'),
    ).toHaveTextContent('tiles could not load');
    expect(
      screen.getByTestId('map-status-message'),
    ).toHaveTextContent('coordinates manually');
  });

  it('hides fence controls while in venue mode', () => {
    renderPicker({ polygon: [{ latitude: 1, longitude: 2 }] });

    expect(screen.queryByTestId('undo-polygon-point')).not.toBeInTheDocument();
    expect(screen.queryByTestId('polygon-vertex-count')).not.toBeInTheDocument();
  });

  it('populates results from a successful place search', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve([
          {
            lat: '10.5',
            lon: '123.2',
            display_name: 'Ateneo de Manila University',
          },
        ]),
    });
    vi.stubGlobal('fetch', fetchMock);
    try {
      renderPicker();
      const input = screen.getByTestId('venue-search-input');
      const button = screen.getByTestId('venue-search-button');

      fireEvent.change(input, { target: { value: 'Ateneo de Manila University' } });
      act(() => {
        button.click();
      });
      await act(async () => {
        await new Promise<void>((resolve) => setTimeout(resolve, 400));
      });

      expect(screen.getByTestId('venue-search-results')).toBeInTheDocument();
      expect(screen.getByTestId('search-result-0')).toBeInTheDocument();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringMatching(/q=Ateneo\+de\+Manila\+University/),
        expect.objectContaining({
          headers: { 'User-Agent': expect.any(String) },
        }),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
