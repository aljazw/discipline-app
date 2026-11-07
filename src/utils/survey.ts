/**
 * Water Wolf survey recording: the bridge to SurveyModule.kt, plus the pure
 * helpers (state parsing, which buttons are live, GPX / JSON export).
 *
 * Recording runs natively in the map's GPS service, so it keeps going with
 * the screen off or another tab open. File format: see SurveyJson.kt. Times
 * come in pairs: `utc` (Unix ms, UTC wall clock) and `mono` (Android
 * elapsedRealtime ms, the clock all durations are measured on).
 */
import { NativeModules } from 'react-native';
import { APP_NAME } from '../constants/brand';
import { escapeXml, gpxNumber } from './gpx';
import { logger } from './logger';

const { SurveyNative } = NativeModules;

export type SurveyState = 'IDLE' | 'CAMERA_RECORDING_STARTED' | 'MOVING' | 'PAUSED' | 'COMPLETED' | 'DISCARDED';

export type SurveyEventType =
    | 'CAMERA_RECORDING_STARTED'
    | 'MOVEMENT_STARTED'
    | 'PAUSED'
    | 'RESUMED'
    | 'MARKER_ADDED'
    | 'SURVEY_STOPPED'
    | 'SURVEY_DISCARDED'
    | 'GPS_LOST'
    | 'GPS_RESTORED'
    | 'DEVICE_RESTARTED';

/**
 * ok; weak (poor accuracy); rough (only a quick network / fused position, no
 * satellites yet); waiting (no fix yet, a cold start can take minutes);
 * lost (no fix for a while after having one); off (GPS disabled).
 */
export type GpsStatus = 'ok' | 'weak' | 'rough' | 'waiting' | 'lost' | 'off';

/** A marker of the running survey, for drawing on the map. */
export interface LiveMarker {
    number: number;
    text: string | null;
    lat: number | null;
    lon: number | null;
}

export interface LiveSurvey {
    state: SurveyState;
    id?: string;
    name?: string;
    startedAt?: number;
    /** Since Recording started. */
    cameraElapsedMs: number;
    /** Since Start moving, pauses included. */
    surveyElapsedMs: number;
    activeMovementMs: number;
    pausedMs: number;
    pointCount: number;
    markerCount: number;
    distance: number;
    gps: GpsStatus;
    accuracy: number | null;
    fixAgeMs: number | null;
    lat: number | null;
    lon: number | null;
    speed: number | null;
    provider: string | null;
    markers: LiveMarker[];
}

export interface Moment {
    utc: number;
    mono: number;
}

export interface SurveyEvent extends Moment {
    type: SurveyEventType;
    lat: number | null;
    lon: number | null;
    accuracy: number | null;
    /** >0: fix taken that long before the event; <0: first fix after it. */
    fixAgeMs: number | null;
    text?: string;
    number?: number;
}

export interface SurveyPoint extends Moment {
    lat: number;
    lon: number;
    accuracy: number | null;
    speed: number | null;
    altitude: number | null;
    bearing: number | null;
    gpsTime: number;
    /** Counts up after every pause. */
    segment: number;
    /** "gps" = satellites; "fused" / "network" = rough fix while GPS had none. */
    provider?: string | null;
}

export interface SurveySummary {
    id: string;
    name: string;
    status: SurveyState;
    startedAt: number;
    completedAt: number;
    totalElapsedMs: number;
    surveyElapsedMs: number;
    activeMovementMs: number;
    pausedMs: number;
    distance: number;
    pointCount: number;
    markerCount: number;
}

export interface Survey extends SurveySummary {
    format: 'water-wolf-survey';
    version: number;
    cameraRecordingStart: Moment;
    movementStart: Moment;
    stop: Moment;
    clock: { bootCount: number; monoOffsetMs: number; timeZone: string };
    pauses: { start: Moment; end: Moment; durationMs: number }[];
    markers: SurveyEvent[];
    events: SurveyEvent[];
    points: SurveyPoint[];
}

export const IDLE_SURVEY: LiveSurvey = {
    state: 'IDLE',
    cameraElapsedMs: 0,
    surveyElapsedMs: 0,
    activeMovementMs: 0,
    pausedMs: 0,
    pointCount: 0,
    markerCount: 0,
    distance: 0,
    gps: 'waiting',
    accuracy: null,
    fixAgeMs: null,
    lat: null,
    lon: null,
    speed: null,
    provider: null,
    markers: [],
};

const parse = <T>(raw: unknown, fallback: T): T => {
    if (typeof raw !== 'string') {
        return fallback;
    }
    try {
        return JSON.parse(raw) as T;
    } catch {
        return fallback;
    }
};

const num = (v: unknown, fallback = 0) => (typeof v === 'number' && isFinite(v) ? v : fallback);
const numOrNull = (v: unknown) => (typeof v === 'number' && isFinite(v) ? v : null);

const STATES: SurveyState[] = ['IDLE', 'CAMERA_RECORDING_STARTED', 'MOVING', 'PAUSED', 'COMPLETED', 'DISCARDED'];
const GPS: GpsStatus[] = ['ok', 'weak', 'rough', 'waiting', 'lost', 'off'];

const toMarkers = (v: unknown): LiveMarker[] =>
    Array.isArray(v)
        ? v
              .filter(m => m && typeof m.number === 'number')
              .map(m => ({
                  number: m.number,
                  text: typeof m.text === 'string' ? m.text : null,
                  lat: numOrNull(m.lat),
                  lon: numOrNull(m.lon),
              }))
        : [];

/** The native state JSON, checked. Anything unreadable counts as idle. */
export const toLiveSurvey = (raw: unknown): LiveSurvey => {
    const v = parse<any>(raw, null);
    if (!v || !STATES.includes(v.state)) {
        return IDLE_SURVEY;
    }
    return {
        state: v.state,
        id: typeof v.id === 'string' ? v.id : undefined,
        name: typeof v.name === 'string' ? v.name : undefined,
        startedAt: numOrNull(v.startedAt) ?? undefined,
        cameraElapsedMs: num(v.cameraElapsedMs),
        surveyElapsedMs: num(v.surveyElapsedMs),
        activeMovementMs: num(v.activeMovementMs),
        pausedMs: num(v.pausedMs),
        pointCount: num(v.pointCount),
        markerCount: num(v.markerCount),
        distance: num(v.distance),
        gps: GPS.includes(v.gps) ? v.gps : 'waiting',
        accuracy: numOrNull(v.accuracy),
        fixAgeMs: numOrNull(v.fixAgeMs),
        lat: numOrNull(v.lat),
        lon: numOrNull(v.lon),
        speed: numOrNull(v.speed),
        provider: typeof v.provider === 'string' ? v.provider : null,
        markers: toMarkers(v.markers),
    };
};

export type SurveyButton = 'camera' | 'move' | 'pause' | 'resume' | 'stop' | 'discard' | 'marker';

/** Which controls work in a state; mirrors SurveyMachine.kt (the native side enforces it too). */
export const surveyButtons = (state: SurveyState): Record<SurveyButton, boolean> => ({
    camera: state === 'IDLE',
    move: state === 'CAMERA_RECORDING_STARTED',
    pause: state === 'MOVING',
    resume: state === 'PAUSED',
    stop: state === 'MOVING' || state === 'PAUSED',
    discard: state === 'CAMERA_RECORDING_STARTED',
    marker: state === 'CAMERA_RECORDING_STARTED' || state === 'MOVING' || state === 'PAUSED',
});

export const isSurveyActive = (state: SurveyState) => surveyButtons(state).marker;

/** "1:02:03" or "02:03": hours only when needed, always two-digit minutes. */
export const formatClock = (ms: number) => {
    const s = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(s / 3600);
    const mm = String(Math.floor(s / 60) % 60).padStart(2, '0');
    const ss = String(s % 60).padStart(2, '0');
    return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
};

/**
 * Adds [lon, lat, segment] points to the lines, starting a new line when the
 * segment changes (after a pause). `last` holds the last line's segment.
 */
export const appendPoints = (
    lines: [number, number][][],
    last: { current: number | null },
    points: [number, number, number][],
): [number, number][][] => {
    const next = [...lines];
    for (const [lon, lat, segment] of points) {
        if (next.length === 0 || segment !== last.current) {
            next.push([]);
            last.current = segment;
        } else if (next[next.length - 1] === lines[next.length - 1]) {
            // Copy the line before changing it, so React sees new data.
            next[next.length - 1] = [...next[next.length - 1]];
        }
        next[next.length - 1].push([lon, lat]);
    }
    return next;
};

// ---- export -------------------------------------------------------------------

const MARKER_LABEL = (e: SurveyEvent) => `Marker ${e.number ?? ''}${e.text ? ` · ${e.text}` : ''}`.trim();

const WAYPOINTS: Partial<Record<SurveyEventType, (e: SurveyEvent) => string>> = {
    MOVEMENT_STARTED: () => 'Start moving',
    SURVEY_STOPPED: () => 'Stop',
    MARKER_ADDED: MARKER_LABEL,
};

/**
 * GPX 1.1: the track with one segment per moving stretch (pauses are the gaps
 * between segments), plus waypoints for the start, stop and markers.
 */
export const buildSurveyGpx = (survey: Survey): string => {
    const out: string[] = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        `<gpx version="1.1" creator="${escapeXml(APP_NAME)}" xmlns="http://www.topografix.com/GPX/1/1">`,
        '  <metadata>',
        `    <name>${escapeXml(survey.name)}</name>`,
        `    <time>${new Date(survey.startedAt).toISOString()}</time>`,
        '  </metadata>',
    ];
    for (const e of survey.events) {
        const label = WAYPOINTS[e.type];
        if (!label || e.lat == null || e.lon == null) {
            continue;
        }
        out.push(`  <wpt lat="${gpxNumber(e.lat)}" lon="${gpxNumber(e.lon)}">`);
        out.push(`    <time>${new Date(e.utc).toISOString()}</time>`);
        out.push(`    <name>${escapeXml(label(e))}</name>`);
        out.push(`    <type>${e.type}</type>`);
        out.push('  </wpt>');
    }
    out.push('  <trk>', `    <name>${escapeXml(survey.name)}</name>`);
    let segment: number | null = null;
    for (const p of survey.points) {
        if (p.segment !== segment) {
            if (segment !== null) {
                out.push('    </trkseg>');
            }
            out.push('    <trkseg>');
            segment = p.segment;
        }
        const ele = p.altitude != null ? `<ele>${gpxNumber(p.altitude, 1)}</ele>` : '';
        out.push(
            `      <trkpt lat="${gpxNumber(p.lat)}" lon="${gpxNumber(p.lon)}">${ele}<time>${new Date(p.utc).toISOString()}</time></trkpt>`,
        );
    }
    if (segment !== null) {
        out.push('    </trkseg>');
    }
    out.push('  </trk>', '</gpx>', '');
    return out.join('\n');
};

export const buildSurveyJson = (survey: Survey) => JSON.stringify(survey, null, 1);

/** A safe file name, e.g. "Survey 7 Nov 2026 14_05.json". */
export const surveyFileName = (name: string, ext: 'gpx' | 'json') =>
    `${name.replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, ' ').trim() || 'survey'}.${ext}`;

// ---- native -------------------------------------------------------------------

const live = async (p: Promise<unknown>) => toLiveSurvey(await p);

export const surveyNative = {
    available: !!SurveyNative,

    state: async (): Promise<LiveSurvey> => {
        if (!SurveyNative) {
            return IDLE_SURVEY;
        }
        try {
            return toLiveSurvey(await SurveyNative.state());
        } catch (error) {
            logger.warn('survey state failed', error);
            return IDLE_SURVEY;
        }
    },

    /** Live points from index `from`: [lon, lat, segment]. */
    points: async (from: number): Promise<[number, number, number][]> =>
        SurveyNative ? parse<[number, number, number][]>(await SurveyNative.points(from), []) : [],

    startCamera: () => live(SurveyNative.startCamera()),
    startMoving: () => live(SurveyNative.startMoving()),
    pause: () => live(SurveyNative.pause()),
    resume: () => live(SurveyNative.resume()),
    /** Saves the survey; resolves only once it is on disk (then the state is IDLE). */
    stop: () => live(SurveyNative.stop()),
    discard: () => live(SurveyNative.discard()),
    addMarker: (text?: string) => live(SurveyNative.addMarker(text ?? null)),
    labelMarker: (markerNumber: number, text: string): Promise<boolean> => SurveyNative.labelMarker(markerNumber, text),

    list: async (): Promise<SurveySummary[]> =>
        parse<SurveySummary[]>(await SurveyNative.list(), []).sort((a, b) => b.startedAt - a.startedAt),
    get: async (id: string): Promise<Survey | null> => parse<Survey | null>(await SurveyNative.get(id), null),
    remove: (id: string): Promise<boolean> => SurveyNative.remove(id),
    rename: (id: string, name: string): Promise<boolean> => SurveyNative.rename(id, name),

    gpsEnabled: (): Promise<boolean> => (SurveyNative ? SurveyNative.gpsEnabled() : Promise.resolve(true)),
    batteryUnrestricted: (): Promise<boolean> =>
        SurveyNative ? SurveyNative.batteryUnrestricted() : Promise.resolve(true),
    requestBatteryUnrestricted: (): Promise<boolean> => SurveyNative.requestBatteryUnrestricted(),
    openLocationSettings: (): Promise<boolean> => SurveyNative.openLocationSettings(),
};
