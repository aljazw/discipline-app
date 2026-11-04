/**
 * Distances, bearings and the numbers the map shows. Positions are
 * [longitude, latitude] (GeoJSON order); distances are meters, speeds m/s,
 * bearings degrees clockwise from true north.
 */
import { CoordFormat, LngLat, MapUnits } from '../types/types';

const R = 6_371_008.8;
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

/** Angle in 0..360. */
export const normalize = (d: number) => ((d % 360) + 360) % 360;

/** Signed difference b - a in -180..180: positive = b is clockwise (to the right) of a. */
export const angleDelta = (a: number, b: number) => ((b - a + 540) % 360) - 180;

/** Great-circle distance. */
export const distance = (a: LngLat, b: LngLat): number => {
    const dLat = rad(b[1] - a[1]);
    const dLon = rad(b[0] - a[0]);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
};

/** Initial bearing from a to b. */
export const bearing = (a: LngLat, b: LngLat): number => {
    const φ1 = rad(a[1]);
    const φ2 = rad(b[1]);
    const Δλ = rad(b[0] - a[0]);
    const y = Math.sin(Δλ) * Math.cos(φ2);
    const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
    return normalize(deg(Math.atan2(y, x)));
};

/** Distance from p to the course from → to; positive when p is right of it. */
export const crossTrack = (from: LngLat, to: LngLat, p: LngLat): number => {
    const d13 = distance(from, p) / R;
    const θ13 = rad(bearing(from, p));
    const θ12 = rad(bearing(from, to));
    return Math.asin(Math.sin(d13) * Math.sin(θ13 - θ12)) * R;
};

/** How far along the course from → to the point closest to p lies (negative = behind the start). */
export const alongTrack = (from: LngLat, to: LngLat, p: LngLat): number => {
    const d13 = distance(from, p) / R;
    const dxt = crossTrack(from, to, p) / R;
    const along = Math.acos(Math.max(-1, Math.min(1, Math.cos(d13) / Math.cos(dxt)))) * R;
    return Math.cos(rad(bearing(from, p)) - rad(bearing(from, to))) < 0 ? -along : along;
};

export const pathLength = (points: LngLat[]): number =>
    points.reduce((sum, p, i) => (i === 0 ? 0 : sum + distance(points[i - 1], p)), 0);

/** The smallest box around the points, as the map camera wants it. */
export const boundsOf = (points: LngLat[]): { ne: LngLat; sw: LngLat } | null => {
    if (!points.length) {
        return null;
    }
    let [w, s] = points[0];
    let [e, n] = points[0];
    for (const [lon, lat] of points) {
        w = Math.min(w, lon);
        e = Math.max(e, lon);
        s = Math.min(s, lat);
        n = Math.max(n, lat);
    }
    return { ne: [e, n], sw: [w, s] };
};

// ---- Route following ----------------------------------------------------------

/** Within this distance of a route point it counts as reached. */
export const ARRIVE_METERS = 25;

export interface RouteProgress {
    /** The leg being sailed / ridden: from points[leg] to points[leg + 1]. */
    leg: number;
    /** Distance and bearing straight to the next point. */
    toNext: number;
    bearingToNext: number;
    /** Off the leg's line; positive = right of it. */
    offCourse: number;
    /** To the end, along the remaining legs. */
    remaining: number;
    /** Turn at the next point (positive = right), null at the last one. */
    turn: number | null;
    finished: boolean;
}

/**
 * Where you are on a route. The leg only moves forward: once the next point is
 * reached, or passed along the line, the following leg starts.
 */
export const routeProgress = (points: LngLat[], pos: LngLat, leg: number): RouteProgress => {
    const last = points.length - 1;
    let current = Math.max(0, Math.min(leg, last - 1));
    while (current < last) {
        const from = points[current];
        const to = points[current + 1];
        const reached = distance(pos, to) <= ARRIVE_METERS;
        const passed = current + 1 < last && alongTrack(from, to, pos) > distance(from, to);
        if (!reached && !passed) {
            break;
        }
        current++;
    }
    if (last < 1 || current >= last) {
        return { leg: Math.max(0, last - 1), toNext: 0, bearingToNext: 0, offCourse: 0, remaining: 0, turn: null, finished: true };
    }
    const next = points[current + 1];
    const toNext = distance(pos, next);
    const after = pathLength(points.slice(current + 1));
    const turn =
        current + 2 <= last
            ? angleDelta(bearing(points[current], next), bearing(next, points[current + 2]))
            : null;
    return {
        leg: current,
        toNext,
        bearingToNext: bearing(pos, next),
        offCourse: crossTrack(points[current], next, pos),
        remaining: toNext + after,
        turn,
        finished: false,
    };
};

/** "Turn right", "Slight left", "Continue" for a turn angle. */
export const turnText = (angle: number | null): string => {
    if (angle === null) {
        return 'Arrive';
    }
    const a = Math.abs(angle);
    const side = angle > 0 ? 'right' : 'left';
    if (a < 20) {
        return 'Continue';
    }
    if (a < 50) {
        return `Slight ${side}`;
    }
    if (a < 135) {
        return `Turn ${side}`;
    }
    return `Sharp ${side}`;
};

// ---- Formatting ---------------------------------------------------------------

const CARDINALS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

export const cardinal = (d: number) => CARDINALS[Math.round(normalize(d) / 22.5) % 16];

/** "245° SW". */
export const formatBearing = (d: number) => `${Math.round(normalize(d)) % 360}° ${cardinal(d)}`;

export interface Measure {
    value: string;
    unit: string;
}

const fixed = (n: number, digits: number) => n.toFixed(digits);

export const distanceParts = (m: number, units: MapUnits): Measure => {
    if (units === 'nautical') {
        const nm = m / 1852;
        return nm < 0.2 ? { value: fixed(m, 0), unit: 'm' } : { value: fixed(nm, nm < 10 ? 2 : 1), unit: 'nm' };
    }
    if (units === 'imperial') {
        const mi = m / 1609.344;
        return mi < 0.1 ? { value: fixed(m * 3.28084, 0), unit: 'ft' } : { value: fixed(mi, mi < 10 ? 2 : 1), unit: 'mi' };
    }
    return m < 1000 ? { value: fixed(m, 0), unit: 'm' } : { value: fixed(m / 1000, m < 10_000 ? 2 : 1), unit: 'km' };
};

export const speedParts = (mps: number, units: MapUnits): Measure => {
    const v = Math.max(0, mps);
    if (units === 'nautical') {
        return { value: fixed(v * 1.943844, 1), unit: 'kn' };
    }
    if (units === 'imperial') {
        return { value: fixed(v * 2.236936, 1), unit: 'mph' };
    }
    return { value: fixed(v * 3.6, 1), unit: 'km/h' };
};

const join = ({ value, unit }: Measure) => `${value} ${unit}`;
export const formatDistance = (m: number, units: MapUnits) => join(distanceParts(m, units));
export const formatSpeed = (mps: number, units: MapUnits) => join(speedParts(mps, units));

/** "1:05:09" or "5:09". */
export const formatDuration = (ms: number) => {
    const s = Math.max(0, Math.floor(ms / 1000));
    const pad = (n: number) => `${n}`.padStart(2, '0');
    return s >= 3600 ? `${Math.floor(s / 3600)}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}` : `${Math.floor(s / 60)}:${pad(s % 60)}`;
};

/** Time to cover a distance at a speed, e.g. "12 min" or "1 h 05 min"; null when not moving. */
export const formatEta = (meters: number, mps: number): string | null => {
    if (!(mps > 0.3)) {
        return null;
    }
    const min = Math.round(meters / mps / 60);
    if (min < 1) {
        return '< 1 min';
    }
    return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${`${min % 60}`.padStart(2, '0')} min`;
};

const coord = (v: number, pos: string, neg: string, format: CoordFormat, degWidth: number) => {
    const hemi = v >= 0 ? pos : neg;
    const a = Math.abs(v);
    if (format === 'dd') {
        return `${a.toFixed(5)}° ${hemi}`;
    }
    let d = Math.floor(a);
    const minutes = (a - d) * 60;
    if (format === 'dm') {
        let m = Number(minutes.toFixed(3));
        if (m >= 60) {
            m = 0;
            d += 1;
        }
        return `${`${d}`.padStart(degWidth, '0')}° ${m.toFixed(3).padStart(6, '0')}′ ${hemi}`;
    }
    let m = Math.floor(minutes);
    let sec = Number(((minutes - m) * 60).toFixed(1));
    if (sec >= 60) {
        sec = 0;
        m += 1;
    }
    if (m >= 60) {
        m = 0;
        d += 1;
    }
    return `${`${d}`.padStart(degWidth, '0')}° ${`${m}`.padStart(2, '0')}′ ${sec.toFixed(1).padStart(4, '0')}″ ${hemi}`;
};

/** "45° 12.345′ N  013° 40.120′ E" and friends. */
export const formatCoords = (lat: number, lon: number, format: CoordFormat) =>
    `${coord(lat, 'N', 'S', format, 2)}  ${coord(lon, 'E', 'W', format, 3)}`;

/** Drops points closer than `minMeters` to the last kept one (the ends are always kept). */
export const thin = (points: LngLat[], minMeters: number): LngLat[] => {
    if (points.length <= 2) {
        return points;
    }
    const out: LngLat[] = [points[0]];
    for (let i = 1; i < points.length - 1; i++) {
        if (distance(out[out.length - 1], points[i]) >= minMeters) {
            out.push(points[i]);
        }
    }
    out.push(points[points.length - 1]);
    return out;
};
