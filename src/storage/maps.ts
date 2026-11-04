/**
 * The map tool's own data: saved places (marks), planned routes and map
 * preferences. Tracks and offline map files are big, so they live in native
 * files instead (see utils/mapNative.ts).
 */
import { CoordFormat, LngLat, MapMark, MapPrefs, MapRoute, MapUnits, MarkKind, OnlineMap } from '../types/types';
import { KEYS, isNumber, isString, readList, readObject, updateList, upsertById, withoutId, writeJson } from './core';

export const MARK_KINDS: MarkKind[] = ['spot', 'fish', 'anchor', 'danger', 'flag', 'home', 'camp'];
const UNITS: MapUnits[] = ['metric', 'nautical', 'imperial'];
const COORDS: CoordFormat[] = ['dd', 'dm', 'dms'];

const isLat = (v: unknown): v is number => isNumber(v) && v >= -90 && v <= 90;
const isLon = (v: unknown): v is number => isNumber(v) && v >= -180 && v <= 180;
const toLngLat = (v: any): LngLat | null => (Array.isArray(v) && isLon(v[0]) && isLat(v[1]) ? [v[0], v[1]] : null);

const toMark = (v: any): MapMark | null => {
    if (!v || !isString(v.id) || !isLat(v.lat) || !isLon(v.lon)) {
        return null;
    }
    return {
        id: v.id,
        name: typeof v.name === 'string' && v.name.trim() ? v.name : 'Mark',
        kind: MARK_KINDS.includes(v.kind) ? v.kind : 'spot',
        lat: v.lat,
        lon: v.lon,
        note: typeof v.note === 'string' ? v.note : '',
        createdAt: isNumber(v.createdAt) ? v.createdAt : 0,
    };
};

const toRoute = (v: any): MapRoute | null => {
    if (!v || !isString(v.id) || !Array.isArray(v.points)) {
        return null;
    }
    const points = v.points.map(toLngLat).filter((p: LngLat | null): p is LngLat => p !== null);
    if (points.length < 2) {
        return null;
    }
    return {
        id: v.id,
        name: typeof v.name === 'string' && v.name.trim() ? v.name : 'Route',
        points,
        createdAt: isNumber(v.createdAt) ? v.createdAt : 0,
    };
};

export const getMarks = (): Promise<MapMark[]> => readList(KEYS.mapMarks, toMark);

export const saveMark = (mark: MapMark): Promise<boolean> => updateList(KEYS.mapMarks, toMark, list => upsertById(list, mark));

/** Adds many at once, e.g. from an imported GPX file. */
export const addMarks = (marks: MapMark[]): Promise<boolean> =>
    updateList(KEYS.mapMarks, toMark, list => [...list, ...marks]);

export const deleteMark = (id: string): Promise<boolean> => updateList(KEYS.mapMarks, toMark, list => withoutId(list, id));

export const getRoutes = (): Promise<MapRoute[]> => readList(KEYS.mapRoutes, toRoute);

export const saveRoute = (route: MapRoute): Promise<boolean> =>
    updateList(KEYS.mapRoutes, toRoute, list => upsertById(list, route));

export const addRoutes = (routes: MapRoute[]): Promise<boolean> =>
    updateList(KEYS.mapRoutes, toRoute, list => [...list, ...routes]);

export const deleteRoute = (id: string): Promise<boolean> =>
    updateList(KEYS.mapRoutes, toRoute, list => withoutId(list, id));

export const DEFAULT_MAP_PREFS: MapPrefs = {
    base: 'online:osm',
    seamarks: false,
    showMarks: true,
    showTracks: false,
    units: 'metric',
    coords: 'dm',
    keepAwake: false,
    custom: [],
};

const toOnlineMap = (v: any): OnlineMap | null =>
    v && isString(v.id) && isString(v.name) && isString(v.url) && (v.type === 'raster' || v.type === 'style')
        ? {
              id: v.id,
              name: v.name,
              url: v.url,
              type: v.type,
              ...(isNumber(v.maxZoom) ? { maxZoom: v.maxZoom } : {}),
              ...(isString(v.attribution) ? { attribution: v.attribution } : {}),
          }
        : null;

const toMapPrefs = (v: any): MapPrefs => {
    const center = toLngLat(v.camera?.center);
    return {
        base: isString(v.base) ? v.base : DEFAULT_MAP_PREFS.base,
        seamarks: v.seamarks === true,
        showMarks: v.showMarks !== false,
        showTracks: v.showTracks === true,
        units: UNITS.includes(v.units) ? v.units : DEFAULT_MAP_PREFS.units,
        coords: COORDS.includes(v.coords) ? v.coords : DEFAULT_MAP_PREFS.coords,
        keepAwake: v.keepAwake === true,
        custom: Array.isArray(v.custom)
            ? v.custom.map(toOnlineMap).filter((m: OnlineMap | null): m is OnlineMap => m !== null)
            : [],
        ...(center && isNumber(v.camera?.zoom) ? { camera: { center, zoom: v.camera.zoom } } : {}),
        ...(isString(v.previousBase) ? { previousBase: v.previousBase } : {}),
    };
};

export const getMapPrefs = (): Promise<MapPrefs> => readObject(KEYS.mapPrefs, toMapPrefs);

export const setMapPrefs = (prefs: MapPrefs): Promise<boolean> => writeJson(KEYS.mapPrefs, prefs);
