/** The map tool's math, formatting, GPX export and stored places. */
jest.mock('react-native', () => {
    const store = new Map<string, string>();
    return {
        NativeModules: {
            SharedStorage: {
                store,
                getItem: jest.fn(async (key: string) => store.get(key) ?? null),
                setItem: jest.fn(async (key: string, value: string) => {
                    store.set(key, value);
                    return true;
                }),
            },
        },
    };
});
jest.mock('../src/components/Icon', () => ({ isIconName: (v: unknown) => typeof v === 'string' }));

import { LngLat, MapMark } from '../src/types/types';
import {
    alongTrack,
    angleDelta,
    bearing,
    cardinal,
    crossTrack,
    distance,
    distanceParts,
    formatBearing,
    formatCoords,
    formatDuration,
    formatEta,
    routeProgress,
    speedParts,
    thin,
    turnText,
} from '../src/utils/geo';
import { buildGpx, gpxFileName } from '../src/utils/gpx';
import { buildStyle, onlineMapType, resolveBase } from '../src/utils/mapStyle';
import { clearStorageCache } from '../src/storage/core';
import { DEFAULT_MAP_PREFS, addMarks, deleteMark, getMapPrefs, getMarks, saveMark, setMapPrefs } from '../src/storage';

const { SharedStorage } = jest.requireMock('react-native').NativeModules;

beforeEach(() => {
    SharedStorage.store.clear();
    clearStorageCache();
});

// Split and Ancona, across the Adriatic.
const SPLIT: LngLat = [16.44, 43.508];
const ANCONA: LngLat = [13.5, 43.617];

describe('geo', () => {
    test('distance and bearing match known values', () => {
        expect(distance(SPLIT, ANCONA) / 1000).toBeCloseTo(237.6, 0);
        expect(distance([0, 0], [0, 1])).toBeCloseTo(111_195, -1);
        expect(bearing([0, 0], [0, 1])).toBeCloseTo(0, 5);
        expect(bearing([0, 0], [1, 0])).toBeCloseTo(90, 5);
        expect(bearing([0, 0], [0, -1])).toBeCloseTo(180, 5);
        expect(bearing([0, 0], [-1, 0])).toBeCloseTo(270, 5);
    });

    test('cross-track is positive to the right of the course', () => {
        // Course due north along the equator's meridian; a point to the east is on the right.
        expect(crossTrack([0, 0], [0, 1], [0.001, 0.5])).toBeGreaterThan(100);
        expect(crossTrack([0, 0], [0, 1], [-0.001, 0.5])).toBeLessThan(-100);
        expect(alongTrack([0, 0], [0, 1], [0.001, 0.5])).toBeCloseTo(55_597, -2);
        expect(alongTrack([0, 0], [0, 1], [0, -0.1])).toBeLessThan(0);
    });

    test('angles wrap around north', () => {
        expect(angleDelta(350, 10)).toBe(20);
        expect(angleDelta(10, 350)).toBe(-20);
        expect(cardinal(359)).toBe('N');
        expect(cardinal(225)).toBe('SW');
        expect(formatBearing(-90)).toBe('270° W');
    });

    test('units', () => {
        expect(distanceParts(850, 'metric')).toEqual({ value: '850', unit: 'm' });
        expect(distanceParts(12_345, 'metric')).toEqual({ value: '12.3', unit: 'km' });
        expect(distanceParts(1852, 'nautical')).toEqual({ value: '1.00', unit: 'nm' });
        expect(distanceParts(100, 'nautical')).toEqual({ value: '100', unit: 'm' });
        expect(distanceParts(30, 'imperial')).toEqual({ value: '98', unit: 'ft' });
        expect(speedParts(10, 'metric')).toEqual({ value: '36.0', unit: 'km/h' });
        expect(speedParts(10, 'nautical')).toEqual({ value: '19.4', unit: 'kn' });
        expect(speedParts(-1, 'imperial')).toEqual({ value: '0.0', unit: 'mph' });
    });

    test('coordinates in every format, with rounding carried over', () => {
        expect(formatCoords(45.123456, 13.5, 'dd')).toBe('45.12346° N  13.50000° E');
        expect(formatCoords(45.5, -13.25, 'dm')).toBe('45° 30.000′ N  013° 15.000′ W');
        expect(formatCoords(-0.9999999, 0, 'dm')).toBe('01° 00.000′ S  000° 00.000′ E');
        expect(formatCoords(45.5125, 13.5, 'dms')).toBe('45° 30′ 45.0″ N  013° 30′ 00.0″ E');
    });

    test('durations and ETA', () => {
        expect(formatDuration(65_000)).toBe('1:05');
        expect(formatDuration(3_909_000)).toBe('1:05:09');
        expect(formatEta(1000, 0)).toBeNull();
        expect(formatEta(6000, 10)).toBe('10 min');
        expect(formatEta(36_000 + 3000, 10)).toBe('1 h 05 min');
    });

    test('thin keeps the ends and drops close points', () => {
        const pts: LngLat[] = [[0, 0], [0, 0.00001], [0, 0.00002], [0, 0.001], [0, 0.00101]];
        expect(thin(pts, 30)).toEqual([[0, 0], [0, 0.001], [0, 0.00101]]);
    });
});

describe('route following', () => {
    // An L: north 1.1 km, then east.
    const route: LngLat[] = [[0, 0], [0, 0.01], [0.01, 0.01]];

    test('first leg: distance to the corner, the right turn ahead', () => {
        const p = routeProgress(route, [0, 0.002], 0);
        expect(p.leg).toBe(0);
        expect(p.toNext).toBeCloseTo(889.6, 0);
        expect(p.bearingToNext).toBeCloseTo(0, 3);
        expect(p.turn).toBeCloseTo(90, 0);
        expect(turnText(p.turn)).toBe('Turn right');
        expect(p.remaining).toBeCloseTo(889.6 + 1112, -1);
        expect(p.finished).toBe(false);
    });

    test('moves to the next leg once the corner is reached or passed', () => {
        expect(routeProgress(route, [0, 0.0099], 0).leg).toBe(1);
        // Overshot the corner to the north without touching it.
        expect(routeProgress(route, [0.0005, 0.0106], 0).leg).toBe(1);
        // Never goes back a leg.
        expect(routeProgress(route, [0, 0.001], 1).leg).toBe(1);
    });

    test('off course to the left is negative', () => {
        expect(routeProgress(route, [-0.001, 0.005], 0).offCourse).toBeLessThan(-100);
    });

    test('finishes only at the last point', () => {
        expect(routeProgress(route, [0.0099, 0.01], 1).finished).toBe(true);
        const p = routeProgress(route, [0.005, 0.01], 1);
        expect(p.finished).toBe(false);
        expect(p.turn).toBeNull();
        expect(turnText(p.turn)).toBe('Arrive');
    });
});

describe('GPX export', () => {
    test('writes waypoints, routes and tracks, escaping names', () => {
        const gpx = buildGpx({
            marks: [{ id: 'm', name: 'Rock & "reef"', kind: 'fish', lat: 43.5, lon: 16.4, note: '12 m <deep>', createdAt: 0 }],
            routes: [{ id: 'r', name: 'Out', points: [[16.4, 43.5], [16.5, 43.6]], createdAt: 0 }],
            tracks: [
                {
                    id: 't',
                    name: 'Trip',
                    startedAt: 0,
                    endedAt: 0,
                    distance: 0,
                    movingMs: 0,
                    maxSpeed: 0,
                    points: [[43.5, 16.4, 2.5, Date.UTC(2026, 10, 4, 6), 1]],
                },
            ],
        });
        expect(gpx).toContain('<wpt lat="43.5" lon="16.4">');
        expect(gpx).toContain('<name>Rock &amp; &quot;reef&quot;</name>');
        expect(gpx).toContain('<desc>12 m &lt;deep&gt;</desc>');
        expect(gpx).toContain('<sym>Fishing Area</sym>');
        expect(gpx).toContain('<rtept lat="43.6" lon="16.5"/>');
        expect(gpx).toContain('<trkpt lat="43.5" lon="16.4"><ele>2.5</ele><time>2026-11-04T06:00:00.000Z</time></trkpt>');
        expect(gpxFileName('a/b: c')).toBe('a b c.gpx');
    });
});

describe('map style', () => {
    const chart = {
        id: 'chart.mbtiles',
        name: 'chart',
        path: '/maps/chart.mbtiles',
        size: 1,
        kind: 'mbtiles' as const,
        type: 'raster' as const,
        format: 'png',
        minZoom: 8,
        maxZoom: 18,
        bounds: [2.8, 36.5, 17.8, 55.8] as [number, number, number, number],
    };

    test('an MBTiles chart is served by the local tile server and overzooms', () => {
        const base = resolveBase({ ...DEFAULT_MAP_PREFS, base: 'file:chart.mbtiles' }, [chart]);
        const style: any = buildStyle(base, { serverUrl: 'http://127.0.0.1:5000', seamarks: true, dark: false });
        expect(style.sources.base.tiles).toEqual(['http://127.0.0.1:5000/chart.mbtiles/{z}/{x}/{y}']);
        expect(style.sources.base.maxzoom).toBe(18);
        expect(style.sources.base.bounds).toEqual(chart.bounds);
        expect(style.layers.map((l: any) => l.id)).toEqual(['background', 'base', 'seamarks']);
    });

    test('a missing file falls back to the street map', () => {
        const base = resolveBase({ ...DEFAULT_MAP_PREFS, base: 'file:gone.mbtiles' }, [chart]);
        expect(base.kind === 'online' && base.map.id).toBe('osm');
    });

    test('online map type from its URL', () => {
        expect(onlineMapType('https://x/{z}/{x}/{y}.png')).toBe('raster');
        expect(onlineMapType('https://x/{z}/{x}/{-y}.png')).toBe('raster');
        expect(onlineMapType('https://demotiles.maplibre.org/style.json')).toBe('style');
    });
});

describe('stored places', () => {
    const mark = (id: string): MapMark => ({ id, name: id, kind: 'fish', lat: 43.5, lon: 16.4, note: '', createdAt: 1 });

    test('save, add many, delete; broken entries are dropped', async () => {
        await saveMark(mark('a'));
        await addMarks([mark('b'), { ...mark('c'), lat: 200 }]);
        expect((await getMarks()).map(m => m.id)).toEqual(['a', 'b']);
        await deleteMark('a');
        expect((await getMarks()).map(m => m.id)).toEqual(['b']);
    });

    test('prefs default sensibly and keep the camera', async () => {
        expect(await getMapPrefs()).toEqual(DEFAULT_MAP_PREFS);
        await setMapPrefs({ ...DEFAULT_MAP_PREFS, units: 'nautical', camera: { center: [16.4, 43.5], zoom: 12 } });
        const prefs = await getMapPrefs();
        expect(prefs.units).toBe('nautical');
        expect(prefs.camera).toEqual({ center: [16.4, 43.5], zoom: 12 });
    });
});

describe('satellite switch', () => {
    const { toggleSatellite } = require('../src/utils/mapStyle');

    test('goes to satellite and back to the map that was showing', () => {
        const chart = { ...DEFAULT_MAP_PREFS, base: 'file:chart.mbtiles' };
        const on = toggleSatellite(chart);
        expect(on.base).toBe('online:satellite');
        expect(toggleSatellite(on).base).toBe('file:chart.mbtiles');
    });

    test('falls back to streets when there is nothing to go back to', () => {
        expect(toggleSatellite({ ...DEFAULT_MAP_PREFS, base: 'online:satellite' }).base).toBe('online:osm');
    });
});
