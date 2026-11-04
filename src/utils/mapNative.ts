/**
 * Bridge to MapModule.kt: offline map files and their tile server, GPX / KML /
 * GeoJSON import, file export, the compass and track recording (TrackService).
 */
import { NativeEventEmitter, NativeModules, PermissionsAndroid, Platform } from 'react-native';
import { MapUnits, Track, TrackPoint, TrackSummary } from '../types/types';
import { logger } from './logger';

const { MapNative } = NativeModules;
const events = MapNative ? new NativeEventEmitter(MapNative) : null;

/** An offline map file in the app's maps folder. */
export interface MapFile {
    /** The file name; unique in the folder. */
    id: string;
    name: string;
    path: string;
    size: number;
    kind: 'mbtiles' | 'pmtiles';
    type: 'raster' | 'vector';
    format: string;
    minZoom: number;
    maxZoom: number;
    /** West, south, east, north. */
    bounds?: [number, number, number, number];
    /** Vector layer names, for the generic style. */
    layers?: string[];
    attribution?: string;
}

/** Places read from a GPX, KML or GeoJSON file. */
export interface ImportedPlaces {
    fileName: string;
    marks: { name: string; lat: number; lon: number; note: string }[];
    routes: { name: string; points: [number, number][] }[];
    /** Points are [lat, lon, alt, time]. */
    tracks: { name: string; points: [number, number, number, number][] }[];
}

export type RecordingStatus = 'idle' | 'recording' | 'paused';

export interface RecordingState {
    status: RecordingStatus;
    id?: string;
    name?: string;
    startedAt?: number;
    distance: number;
    movingMs: number;
    maxSpeed: number;
    elapsedMs: number;
    pointCount: number;
}

const IDLE: RecordingState = { status: 'idle', distance: 0, movingMs: 0, maxSpeed: 0, elapsedMs: 0, pointCount: 0 };

const json = <T>(raw: unknown, fallback: T): T => {
    if (typeof raw !== 'string') {
        return fallback;
    }
    try {
        return JSON.parse(raw) as T;
    } catch {
        return fallback;
    }
};

const toState = (raw: unknown): RecordingState => {
    const v = json<any>(raw, null);
    if (!v || (v.status !== 'recording' && v.status !== 'paused')) {
        return IDLE;
    }
    return {
        status: v.status,
        id: v.id,
        name: v.name,
        startedAt: v.startedAt,
        distance: Number(v.distance) || 0,
        movingMs: Number(v.movingMs) || 0,
        maxSpeed: Number(v.maxSpeed) || 0,
        elapsedMs: Number(v.elapsedMs) || 0,
        pointCount: Number(v.pointCount) || 0,
    };
};

export const mapNative = {
    available: !!MapNative,

    /** Base URL of the on-phone tile server for MBTiles, e.g. "http://127.0.0.1:41234". */
    serverUrl: (): Promise<string> => MapNative.serverUrl(),

    listMaps: async (): Promise<MapFile[]> => json<MapFile[]>(await MapNative.listMaps(), []),

    mapsFolder: (): Promise<string> => MapNative.mapsFolder(),

    /** Picks and copies a map file; null when cancelled. Rejects with a readable message. */
    importMap: async (): Promise<MapFile | null> => json<MapFile | null>(await MapNative.importMap(), null),

    cancelImport: () => MapNative.cancelImport(),

    onImportProgress: (listener: (copied: number, total: number) => void) => {
        const sub = events?.addListener('MapImportProgress', (e: { copied: number; total: number }) =>
            listener(e.copied, e.total),
        );
        return () => sub?.remove();
    },

    removeMap: (id: string): Promise<boolean> => MapNative.removeMap(id),

    renameMap: (id: string, name: string): Promise<boolean> => MapNative.renameMap(id, name),

    /** Picks a GPX / KML / GeoJSON file; null when cancelled. */
    pickPlaces: async (): Promise<ImportedPlaces | null> => json<ImportedPlaces | null>(await MapNative.pickPlaces(), null),

    /** Lets the user save a file; false when cancelled. */
    saveFile: (fileName: string, mimeType: string, content: string): Promise<boolean> =>
        MapNative.saveFile(fileName, mimeType, content),

    setKeepAwake: (enabled: boolean) => MapNative?.setKeepAwake(enabled),

    /** Compass heading (true north) a few times a second, while subscribed. */
    watchCompass: (listener: (heading: number) => void) => {
        if (!MapNative || !events) {
            return () => {};
        }
        const sub = events.addListener('MapCompass', (e: { heading: number }) => listener(e.heading));
        MapNative.startCompass();
        return () => {
            sub.remove();
            MapNative.stopCompass();
        };
    },

    // ---- tracks ---------------------------------------------------------------

    startTrack: async (name: string, units: MapUnits) => toState(await MapNative.startTrack(name, units)),
    pauseTrack: async () => toState(await MapNative.pauseTrack()),
    resumeTrack: async () => toState(await MapNative.resumeTrack()),
    /** Stops and saves; the saved track's summary, or null when it had no points. */
    stopTrack: async (): Promise<TrackSummary | null> => json<TrackSummary | null>(await MapNative.stopTrack(), null),

    trackState: async (): Promise<RecordingState> => {
        try {
            return toState(await MapNative.trackState());
        } catch (error) {
            logger.warn('trackState failed', error);
            return IDLE;
        }
    },

    /** Points recorded so far, from index `from`. */
    trackPoints: async (from: number): Promise<TrackPoint[]> => json<TrackPoint[]>(await MapNative.trackPoints(from), []),

    listTracks: async (): Promise<TrackSummary[]> =>
        json<TrackSummary[]>(await MapNative.listTracks(), []).sort((a, b) => b.startedAt - a.startedAt),

    getTrack: async (id: string): Promise<Track | null> => json<Track | null>(await MapNative.getTrack(id), null),

    saveTrack: (track: Track): Promise<boolean> => MapNative.saveTrack(JSON.stringify(track)),

    deleteTrack: (id: string): Promise<boolean> => MapNative.deleteTrack(id),

    renameTrack: (id: string, name: string): Promise<boolean> => MapNative.renameTrack(id, name),
};

/** Asks for precise location; true when granted. */
export const requestLocation = async (): Promise<boolean> => {
    if (Platform.OS !== 'android') {
        return true;
    }
    const fine = PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION;
    if (await PermissionsAndroid.check(fine)) {
        return true;
    }
    const result = await PermissionsAndroid.requestMultiple([fine, PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION]);
    return result[fine] === PermissionsAndroid.RESULTS.GRANTED;
};

export const hasLocation = (): Promise<boolean> =>
    Platform.OS === 'android'
        ? PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION)
        : Promise.resolve(true);

/** "1.4 GB", "820 MB". */
export const formatBytes = (bytes: number) =>
    bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : `${Math.max(1, Math.round(bytes / 1024 ** 2))} MB`;
