import {
    IDLE_SURVEY,
    Survey,
    SurveyEvent,
    SurveyPoint,
    appendPoints,
    buildSurveyGpx,
    buildSurveyJson,
    formatClock,
    isSurveyActive,
    surveyButtons,
    surveyFileName,
    toLiveSurvey,
} from '../src/utils/survey';

const T0 = Date.UTC(2026, 10, 7, 10, 0, 0);

const point = (i: number, segment: number): SurveyPoint => ({
    utc: T0 + 10_000 + i * 1000,
    mono: 60_000 + i * 1000,
    lat: 45 + i * 0.0001,
    lon: 14.2,
    accuracy: 4,
    speed: 1.2,
    altitude: i === 0 ? null : 1.5,
    bearing: null,
    gpsTime: T0 + 10_000 + i * 1000,
    segment,
});

const event = (type: SurveyEvent['type'], at: number, extra: Partial<SurveyEvent> = {}): SurveyEvent => ({
    type,
    utc: T0 + at,
    mono: 50_000 + at,
    lat: 45,
    lon: 14.2,
    accuracy: 5,
    fixAgeMs: 300,
    ...extra,
});

const survey = (): Survey => ({
    format: 'water-wolf-survey',
    version: 1,
    id: 's1',
    name: 'Kvarner <reef> & rocks',
    status: 'COMPLETED',
    startedAt: T0,
    completedAt: T0 + 20_000,
    totalElapsedMs: 20_000,
    surveyElapsedMs: 10_000,
    activeMovementMs: 8_000,
    pausedMs: 2_000,
    distance: 44,
    pointCount: 4,
    markerCount: 1,
    cameraRecordingStart: { utc: T0, mono: 50_000 },
    movementStart: { utc: T0 + 10_000, mono: 60_000 },
    stop: { utc: T0 + 20_000, mono: 70_000 },
    clock: { bootCount: 3, monoOffsetMs: 0, timeZone: 'Europe/Ljubljana' },
    pauses: [],
    markers: [],
    events: [
        event('CAMERA_RECORDING_STARTED', 0, { lat: null, lon: null }),
        event('MOVEMENT_STARTED', 10_000),
        event('MARKER_ADDED', 11_000, { number: 1, text: 'Rock' }),
        event('PAUSED', 12_000),
        event('RESUMED', 14_000),
        event('SURVEY_STOPPED', 20_000),
    ],
    points: [point(0, 0), point(1, 0), point(4, 1), point(5, 1)],
});

describe('survey state', () => {
    it('reads the native state and falls back to idle on junk', () => {
        expect(toLiveSurvey('not json')).toEqual(IDLE_SURVEY);
        expect(toLiveSurvey(undefined)).toEqual(IDLE_SURVEY);
        expect(toLiveSurvey(JSON.stringify({ state: 'FLYING' }))).toEqual(IDLE_SURVEY);
        const s = toLiveSurvey(
            JSON.stringify({ state: 'MOVING', id: 's1', pointCount: 12, gps: 'lost', accuracy: null, surveyElapsedMs: 9000 }),
        );
        expect(s.state).toBe('MOVING');
        expect(s.pointCount).toBe(12);
        expect(s.gps).toBe('lost');
        expect(s.accuracy).toBeNull();
        expect(s.surveyElapsedMs).toBe(9000);
        expect(s.markerCount).toBe(0);
    });

    it('reads markers, the provider and the rough-position status', () => {
        const s = toLiveSurvey(
            JSON.stringify({
                state: 'MOVING',
                gps: 'rough',
                provider: 'fused',
                markers: [{ number: 1, text: 'Rock', lat: 45, lon: 14 }, { number: 2, text: null, lat: null, lon: null }, { bad: 1 }],
            }),
        );
        expect(s.gps).toBe('rough');
        expect(s.provider).toBe('fused');
        expect(s.markers).toEqual([
            { number: 1, text: 'Rock', lat: 45, lon: 14 },
            { number: 2, text: null, lat: null, lon: null },
        ]);
    });

    it('splits the live line at pauses without changing earlier lines', () => {
        const last = { current: null as number | null };
        const a = appendPoints([], last, [[14, 45, 0], [14.1, 45, 0]]);
        expect(a).toEqual([[[14, 45], [14.1, 45]]]);
        const b = appendPoints(a, last, [[14.2, 45, 0], [14.3, 45, 1], [14.4, 45, 1]]);
        expect(b).toEqual([[[14, 45], [14.1, 45], [14.2, 45]], [[14.3, 45], [14.4, 45]]]);
        // The first call's result is untouched (React compares by reference).
        expect(a[0]).toHaveLength(2);
        expect(b[0]).not.toBe(a[0]);
        const c = appendPoints(b, last, []);
        expect(c).toEqual(b);
    });

    it('enables only the buttons the state machine allows', () => {
        expect(surveyButtons('IDLE')).toEqual({
            camera: true, move: false, pause: false, resume: false, stop: false, discard: false, marker: false,
        });
        expect(surveyButtons('CAMERA_RECORDING_STARTED')).toMatchObject({ camera: false, move: true, pause: false, stop: false, discard: true, marker: true });
        expect(surveyButtons('MOVING')).toMatchObject({ move: false, pause: true, resume: false, stop: true, discard: false, marker: true });
        expect(surveyButtons('PAUSED')).toMatchObject({ pause: false, resume: true, stop: true, marker: true });
        expect(Object.values(surveyButtons('COMPLETED')).some(Boolean)).toBe(false);
        expect(isSurveyActive('PAUSED')).toBe(true);
        expect(isSurveyActive('IDLE')).toBe(false);
    });

    it('formats the elapsed time', () => {
        expect(formatClock(0)).toBe('00:00');
        expect(formatClock(65_999)).toBe('01:05');
        expect(formatClock(3_723_000)).toBe('1:02:03');
        expect(formatClock(-5)).toBe('00:00');
    });
});

describe('survey export', () => {
    it('writes one GPX segment per moving stretch, with markers as waypoints', () => {
        const gpx = buildSurveyGpx(survey());
        expect(gpx.match(/<trkseg>/g)).toHaveLength(2);
        expect(gpx.match(/<trkpt /g)).toHaveLength(4);
        expect(gpx).toContain('<name>Kvarner &lt;reef&gt; &amp; rocks</name>');
        expect(gpx).toContain('<name>Marker 1 · Rock</name>');
        expect(gpx).toContain('<name>Start moving</name>');
        expect(gpx).toContain('<name>Stop</name>');
        // The camera start had no position, so it isn't a waypoint.
        expect(gpx).not.toContain('CAMERA_RECORDING_STARTED');
        expect(gpx).toContain(`<time>${new Date(T0 + 11_000).toISOString()}</time>`);
        expect(gpx).toContain('<trkpt lat="45.0001" lon="14.2"><ele>1.5</ele>');
        expect(gpx).toContain('<trkpt lat="45" lon="14.2"><time>');
    });

    it('handles a survey with no points', () => {
        const gpx = buildSurveyGpx({ ...survey(), points: [] });
        expect(gpx).not.toContain('<trkseg>');
        expect(gpx).toContain('</gpx>');
    });

    it('exports JSON that round-trips with both clocks on every event', () => {
        const back = JSON.parse(buildSurveyJson(survey()));
        expect(back).toEqual(survey());
        for (const e of back.events) {
            expect(typeof e.utc).toBe('number');
            expect(typeof e.mono).toBe('number');
        }
        expect(back.movementStart.mono - back.cameraRecordingStart.mono).toBe(10_000);
    });

    it('makes safe file names', () => {
        expect(surveyFileName('Survey 7 Nov 2026 14:05', 'json')).toBe('Survey 7 Nov 2026 14_05.json');
        expect(surveyFileName('  ', 'gpx')).toBe('survey.gpx');
    });
});
