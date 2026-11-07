import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Share, StyleSheet, View } from 'react-native';
import { RouteProp, useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
    Camera,
    CameraRef,
    CircleLayer,
    LineLayer,
    Location,
    MapView,
    MarkerView,
    ShapeSource,
    UserLocation,
    UserTrackingMode,
} from '@maplibre/maplibre-react-native';
import notifee from '@notifee/react-native';
import Dialog, { confirmActions } from '../components/Dialog';
import TextField from '../components/TextField';
import { ThemedText } from '../components/ThemedText';
import Icon from '../components/Icon';
import LayersDialog, { ImportProgress } from '../components/map/LayersDialog';
import MarkEditor, { MarkDraft } from '../components/map/MarkEditor';
import { DrawPanel, Fix, InfoPanel, NavInfo, SelectionPanel, SheetAction } from '../components/map/MapPanels';
import { MapButton, MarkPin, NumberPin } from '../components/map/mapUi';
import { SurveyPanel, surveySummary } from '../components/map/SurveyPanel';
import { useSurvey } from '../hooks/useSurvey';
import { isSurveyActive } from '../utils/survey';
import { useTheme } from '../context/ThemeContext';
import { gutter, spacing } from '../theme';
import {
    LngLat,
    MapMark,
    MapPrefs,
    MapRoute,
    OnlineMap,
    RootStackNavigation,
    RootStackParamList,
    Track,
    TrackSummary,
} from '../types/types';
import {
    DEFAULT_MAP_PREFS,
    deleteMark,
    getMapPrefs,
    getMarks,
    getRoutes,
    saveMark,
    saveRoute,
    setMapPrefs,
} from '../storage';
import {
    ARRIVE_METERS,
    bearing,
    boundsOf,
    distance,
    formatBearing,
    formatCoords,
    formatDistance,
    formatDuration,
    formatEta,
    formatSpeed,
    pathLength,
    routeProgress,
    thin,
    turnText,
} from '../utils/geo';
import { MapFile, RecordingState, mapNative, requestLocation } from '../utils/mapNative';
import {
    SATELLITE_BASE,
    buildStyle,
    fileBaseId,
    isWebUrl,
    onlineMapType,
    resolveBase,
    toggleSatellite,
} from '../utils/mapStyle';
import { haptics } from '../utils/haptics';
import { logger } from '../utils/logger';
import { newId, shortDate } from '../utils/dates';

const IDLE: RecordingState = { status: 'idle', distance: 0, movingMs: 0, maxSpeed: 0, elapsedMs: 0, pointCount: 0 };
/** Where the map opens the very first time: Europe. */
const START = { center: [14.5, 45.5] as LngLat, zoom: 5 };
/** At most this many place pins at once; the rest show when zoomed in. */
const MAX_PINS = 150;
/** Faster than this (m/s) the GPS course is the heading; slower, the compass. */
const MOVING = 1.2;
/** Recorded tracks are drawn in violet, apart from routes (accent) and the live track (red). */
const TRACK_COLOR = '#8A6FD1';
/** The Water Wolf survey line and markers: teal, apart from everything else. */
const SURVEY_COLOR = '#119DA4';

type Follow = 'off' | 'north' | 'heading';
type Mode = 'browse' | 'route' | 'measure';
type Selection =
    | { kind: 'point'; pos: LngLat }
    | { kind: 'mark'; mark: MapMark }
    | { kind: 'route'; route: MapRoute }
    | { kind: 'track'; track: TrackSummary };
type Nav = { kind: 'mark'; mark: MapMark } | { kind: 'route'; route: MapRoute; leg: number };

const line = (coords: LngLat[], props: Record<string, unknown> = {}): GeoJSON.Feature => ({
    type: 'Feature',
    properties: props,
    geometry: { type: 'LineString', coordinates: coords },
});
const collection = (features: GeoJSON.Feature[]): GeoJSON.FeatureCollection => ({ type: 'FeatureCollection', features });
const points = (coords: LngLat[]) =>
    collection(coords.map(c => ({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: c } })));

const pad = (n: number) => `${n}`.padStart(2, '0');
const trackName = (d = new Date()) => `Track ${shortDate(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** The live track being recorded: state from the service, points fetched as they come. */
const useRecording = () => {
    const [state, setState] = useState<RecordingState>(IDLE);
    const [path, setPath] = useState<LngLat[]>([]);
    const count = useRef(0);
    const id = useRef<string | undefined>(undefined);
    const busy = useRef(false);

    const refresh = useCallback(async () => {
        if (busy.current) {
            return;
        }
        busy.current = true;
        try {
            const s = await mapNative.trackState();
            if (s.id !== id.current) {
                id.current = s.id;
                count.current = 0;
                setPath([]);
            }
            if (s.status !== 'idle' && s.pointCount > count.current) {
                const more = await mapNative.trackPoints(count.current);
                count.current += more.length;
                setPath(prev => [...prev, ...more.map(p => [p[1], p[0]] as LngLat)]);
            }
            setState(s);
        } catch (error) {
            logger.warn('Track refresh failed', error);
        } finally {
            busy.current = false;
        }
    }, []);

    useFocusEffect(
        useCallback(() => {
            refresh();
            const timer = setInterval(refresh, 2000);
            return () => clearInterval(timer);
        }, [refresh]),
    );
    return { state, path, refresh, setState };
};

const MapScreen: React.FC = () => {
    const { theme, isDarkMode } = useTheme();
    const { colors } = theme;
    const navigation = useNavigation<RootStackNavigation>();
    const route = useRoute<RouteProp<RootStackParamList, 'Map'>>();
    const insets = useSafeAreaInsets();
    const camera = useRef<CameraRef>(null);

    const [prefs, setPrefsState] = useState<MapPrefs | null>(null);
    const [files, setFiles] = useState<MapFile[]>([]);
    const [serverUrl, setServerUrl] = useState<string | null>(null);
    const [marks, setMarks] = useState<MapMark[]>([]);
    const [routes, setRoutes] = useState<MapRoute[]>([]);
    const [tracks, setTracks] = useState<TrackSummary[]>([]);
    const [shownTrack, setShownTrack] = useState<Track | null>(null);

    const [fix, setFix] = useState<Fix | null>(null);
    const [follow, setFollow] = useState<Follow>('off');
    const [mapHeading, setMapHeading] = useState(0);
    const [visible, setVisible] = useState<{ ne: LngLat; sw: LngLat } | null>(null);

    const [mode, setMode] = useState<Mode>('browse');
    const [draft, setDraft] = useState<LngLat[]>([]);
    const [selection, setSelection] = useState<Selection | null>(null);
    const [nav, setNav] = useState<Nav | null>(null);

    const [layersOpen, setLayersOpen] = useState(false);
    const [importing, setImporting] = useState<ImportProgress | null>(null);
    const [markEditor, setMarkEditor] = useState<{ pos: LngLat; mark?: MapMark } | null>(null);
    const [deleting, setDeleting] = useState<MapMark | null>(null);
    const [naming, setNaming] = useState<{ kind: 'route' | 'track'; id?: string; name: string } | null>(null);
    const [addingOnline, setAddingOnline] = useState<{ name: string; url: string } | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [panelHeight, setPanelHeight] = useState(180);
    const [located, setLocated] = useState(false);
    const [mapReady, setMapReady] = useState(false);

    const recording = useRecording();
    const survey = useSurvey();
    const surveyActive = isSurveyActive(survey.state.state);
    const [surveyOpen, setSurveyOpen] = useState(false);
    /** Opens the survey panel by itself once, when the map opens on a running survey. */
    const surveyShown = useRef(false);
    useEffect(() => {
        if (surveyActive && !surveyShown.current) {
            surveyShown.current = true;
            setSurveyOpen(true);
            setLocated(true);
        }
    }, [surveyActive]);
    /** A feature (route, track) was just tapped, so the same tap doesn't also clear the selection. */
    const featurePressAt = useRef(0);
    const lastAlert = useRef('');

    // ---- loading --------------------------------------------------------------

    const loadPlaces = useCallback(async () => {
        const [m, r] = await Promise.all([getMarks(), getRoutes()]);
        setMarks(m);
        setRoutes(r);
        return { marks: m, routes: r };
    }, []);

    const loadFiles = useCallback(async () => {
        try {
            const list = await mapNative.listMaps();
            setFiles(list);
            return list;
        } catch (e) {
            logger.warn('Could not list maps', e);
            return [];
        }
    }, []);

    useEffect(() => {
        getMapPrefs().then(setPrefsState);
        loadFiles();
        mapNative.serverUrl().then(setServerUrl).catch(e => logger.warn('Tile server failed', e));
        requestLocation()
            .then(setLocated)
            .catch(() => setLocated(false));
    }, [loadFiles]);

    useFocusEffect(
        useCallback(() => {
            loadPlaces();
            loadFiles();
        }, [loadPlaces, loadFiles]),
    );

    useEffect(() => {
        if (prefs?.showTracks) {
            mapNative.listTracks().then(setTracks).catch(() => setTracks([]));
        }
    }, [prefs?.showTracks, recording.state.status]);

    const keepAwake = !!prefs?.keepAwake || !!nav;
    useFocusEffect(
        useCallback(() => {
            mapNative.setKeepAwake(keepAwake);
            return () => mapNative.setKeepAwake(false);
        }, [keepAwake]),
    );

    /** The latest prefs and camera, so neither write overwrites the other with an old copy. */
    const prefsRef = useRef<MapPrefs | null>(null);
    const cameraRef = useRef<MapPrefs['camera']>(undefined);
    useEffect(() => {
        prefsRef.current = prefs;
    }, [prefs]);

    const savePrefs = useCallback((next: MapPrefs) => {
        setPrefsState(next);
        setMapPrefs({ ...next, camera: cameraRef.current ?? next.camera }).catch(e =>
            logger.warn('Could not save map prefs', e),
        );
    }, []);

    // ---- camera -----------------------------------------------------------------

    const fit = useCallback((coords: LngLat[]) => {
        const b = boundsOf(coords);
        if (!b) {
            return;
        }
        setFollow('off');
        if (distance(b.ne, b.sw) < 50) {
            camera.current?.setCamera({ centerCoordinate: b.ne, zoomLevel: 16, animationDuration: 600 });
        } else {
            camera.current?.fitBounds(b.ne, b.sw, [100, 60, panelHeight + 40, 60], 600);
        }
    }, [panelHeight]);

    /** Opened from the saved list: show or navigate to a place, route or track. */
    useEffect(() => {
        const target = route.params?.navigate ?? route.params?.show;
        if (!target || !prefs || !mapReady) {
            return;
        }
        const go = !!route.params?.navigate;
        navigation.setParams({ show: undefined, navigate: undefined });
        (async () => {
            const loaded = await loadPlaces();
            if (target.kind === 'mark') {
                const mark = loaded.marks.find(m => m.id === target.id);
                if (mark) {
                    setSelection({ kind: 'mark', mark });
                    fit([[mark.lon, mark.lat]]);
                    if (go) {
                        startNav({ kind: 'mark', mark });
                    }
                }
            } else if (target.kind === 'route') {
                const r = loaded.routes.find(x => x.id === target.id);
                if (r) {
                    setSelection({ kind: 'route', route: r });
                    fit(r.points);
                    if (go) {
                        startNav({ kind: 'route', route: r, leg: 0 });
                    }
                }
            } else {
                const t = await mapNative.getTrack(target.id);
                if (t) {
                    setShownTrack(t);
                    const summary = (await mapNative.listTracks()).find(s => s.id === t.id);
                    if (summary) {
                        setSelection({ kind: 'track', track: summary });
                    }
                    fit(t.points.map(p => [p[1], p[0]] as LngLat));
                }
            }
        })();
        // startNav is stable enough; re-running on it would replay the target.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [route.params, prefs, mapReady, loadPlaces, fit, navigation]);

    const saveCamera = useRef<ReturnType<typeof setTimeout> | null>(null);
    const onRegionDidChange = useCallback(
        (feature: GeoJSON.Feature<GeoJSON.Point, any>) => {
            const p = feature.properties ?? {};
            setMapHeading(p.heading ?? 0);
            if (Array.isArray(p.visibleBounds) && p.visibleBounds.length === 2) {
                setVisible({ ne: p.visibleBounds[0], sw: p.visibleBounds[1] });
            }
            const center = feature.geometry?.coordinates as LngLat | undefined;
            if (!center || typeof p.zoomLevel !== 'number') {
                return;
            }
            if (saveCamera.current) {
                clearTimeout(saveCamera.current);
            }
            cameraRef.current = { center, zoom: p.zoomLevel };
            saveCamera.current = setTimeout(() => {
                if (prefsRef.current) {
                    setMapPrefs({ ...prefsRef.current, camera: cameraRef.current }).catch(() => undefined);
                }
            }, 1500);
        },
        [],
    );

    // ---- location ----------------------------------------------------------------

    const onLocation = useCallback((loc: Location) => {
        const c = loc.coords;
        if (typeof c?.latitude !== 'number') {
            return;
        }
        const speed = c.speed && c.speed > 0 ? c.speed : 0;
        setFix({
            pos: [c.longitude, c.latitude],
            speed,
            course: speed > MOVING && typeof c.course === 'number' ? c.course : null,
            accuracy: typeof c.accuracy === 'number' ? c.accuracy : null,
        });
    }, []);

    const moving = !!fix && fix.course !== null;

    const cycleFollow = async () => {
        if (!(await requestLocation())) {
            setError('Allow location access to see where you are on the map.');
            return;
        }
        setLocated(true);
        setFollow(f => (f === 'off' ? 'north' : f === 'north' ? 'heading' : 'north'));
    };

    const resetNorth = () => {
        if (follow === 'heading') {
            setFollow('north');
        }
        camera.current?.setCamera({ heading: 0, animationDuration: 400 });
    };

    // ---- navigation ------------------------------------------------------------------

    const startNav = useCallback((next: Nav) => {
        lastAlert.current = '';
        setNav(next);
        setSelection(null);
        setMode('browse');
        setFollow('north');
        haptics.success();
    }, []);

    const navInfo: NavInfo | null = useMemo(() => {
        if (!nav || !fix) {
            return nav
                ? {
                      title: nav.kind === 'mark' ? nav.mark.name : nav.route.name,
                      toNext: 0,
                      bearing: 0,
                      remaining: 0,
                      eta: null,
                      arrived: false,
                  }
                : null;
        }
        if (nav.kind === 'mark') {
            const target: LngLat = [nav.mark.lon, nav.mark.lat];
            const d = distance(fix.pos, target);
            return {
                title: nav.mark.name,
                toNext: d,
                bearing: bearing(fix.pos, target),
                remaining: d,
                eta: formatEta(d, fix.speed),
                arrived: d <= ARRIVE_METERS,
            };
        }
        const p = routeProgress(nav.route.points, fix.pos, nav.leg);
        return {
            title: nav.route.name,
            toNext: p.toNext,
            bearing: p.bearingToNext,
            remaining: p.remaining,
            eta: formatEta(p.remaining, fix.speed),
            turn: `${turnText(p.turn)} in ${formatDistance(p.toNext, prefs?.units ?? 'metric')}`,
            offCourse: p.offCourse,
            arrived: p.finished,
        };
    }, [nav, fix, prefs?.units]);

    // Move to the next leg as points are reached, and buzz on approach and arrival.
    useEffect(() => {
        if (!nav || !fix) {
            return;
        }
        if (nav.kind === 'route') {
            const p = routeProgress(nav.route.points, fix.pos, nav.leg);
            if (p.leg !== nav.leg) {
                setNav({ ...nav, leg: p.leg });
                haptics.success();
            }
        }
        if (!navInfo) {
            return;
        }
        const key = nav.kind === 'route' ? `${nav.route.id}:${nav.leg}` : nav.mark.id;
        if (navInfo.arrived && lastAlert.current !== `${key}:arrived`) {
            lastAlert.current = `${key}:arrived`;
            haptics.success();
        } else if (!navInfo.arrived && navInfo.toNext < 100 && lastAlert.current !== `${key}:near`) {
            lastAlert.current = `${key}:near`;
            haptics.warning();
        }
    }, [fix, nav, navInfo]);

    /** Where the dotted "go here" line points. */
    const navTarget = useMemo((): LngLat | null => {
        if (nav?.kind === 'mark') {
            return [nav.mark.lon, nav.mark.lat];
        }
        return nav?.kind === 'route' ? nav.route.points[Math.min(nav.leg + 1, nav.route.points.length - 1)] : null;
    }, [nav]);

    // ---- recording ------------------------------------------------------------------

    const startRecording = async () => {
        if (!(await requestLocation())) {
            setError('Allow location access to record a track.');
            return;
        }
        setLocated(true);
        await notifee.requestPermission().catch(() => undefined);
        try {
            recording.setState(await mapNative.startTrack(trackName(), prefs?.units ?? 'metric'));
            haptics.success();
            if (follow === 'off') {
                setFollow('north');
            }
        } catch (e: any) {
            setError(e?.message ?? 'Could not start recording.');
        }
        recording.refresh();
    };

    const pauseResume = async () => {
        recording.setState(
            recording.state.status === 'paused' ? await mapNative.resumeTrack() : await mapNative.pauseTrack(),
        );
    };

    const stopRecording = async () => {
        try {
            const saved = await mapNative.stopTrack();
            recording.setState(IDLE);
            recording.refresh();
            if (saved) {
                haptics.success();
                setNaming({ kind: 'track', id: saved.id, name: saved.name });
            } else {
                setError('No GPS points were recorded, so there was nothing to save.');
            }
        } catch (e: any) {
            setError(e?.message ?? 'Could not save the track.');
        }
    };

    // ---- taps on the map ---------------------------------------------------------------

    const onMapPress = (feature: GeoJSON.Feature) => {
        const coords = (feature.geometry as GeoJSON.Point | undefined)?.coordinates as LngLat | undefined;
        if (mode !== 'browse') {
            if (coords) {
                haptics.tap();
                setDraft(d => [...d, coords]);
            }
            return;
        }
        if (Date.now() - featurePressAt.current < 400) {
            return;
        }
        setSelection(null);
    };

    const onMapLongPress = (feature: GeoJSON.Feature) => {
        const coords = (feature.geometry as GeoJSON.Point | undefined)?.coordinates as LngLat | undefined;
        if (mode === 'browse' && coords) {
            quickSave(coords);
        }
    };

    const onRoutePress = (e: { features: GeoJSON.Feature[] }) => {
        const id = e.features[0]?.properties?.id;
        const r = routes.find(x => x.id === id);
        if (r && mode === 'browse') {
            featurePressAt.current = Date.now();
            setSelection({ kind: 'route', route: r });
        }
    };

    const onTrackPress = (e: { features: GeoJSON.Feature[] }) => {
        const id = e.features[0]?.properties?.id;
        const t = tracks.find(x => x.id === id) ?? null;
        if (t && mode === 'browse') {
            featurePressAt.current = Date.now();
            setSelection({ kind: 'track', track: t });
        }
    };

    // ---- places ----------------------------------------------------------------------

    /** Saves a place at once with a numbered name; rename it later with Edit. */
    const quickSave = async (pos: LngLat) => {
        haptics.toggle();
        const spots = marks.filter(m => /^Spot \d+$/.test(m.name)).map(m => Number(m.name.slice(5)));
        const mark: MapMark = {
            id: newId('mark'),
            name: `Spot ${spots.length ? Math.max(...spots) + 1 : 1}`,
            kind: 'spot',
            lat: pos[1],
            lon: pos[0],
            note: '',
            createdAt: Date.now(),
        };
        if (await saveMark(mark)) {
            haptics.success();
            await loadPlaces();
            setSelection({ kind: 'mark', mark });
        } else {
            setError('Could not save the place.');
        }
    };

    const saveHere = () => {
        if (fix) {
            quickSave(fix.pos);
        } else {
            setError(located ? 'Still waiting for a GPS fix.' : 'Allow location access to save where you are.');
        }
    };

    const saveMarkDraft = async (d: MarkDraft) => {
        const editing = markEditor;
        setMarkEditor(null);
        if (!editing) {
            return;
        }
        const mark: MapMark = editing.mark
            ? { ...editing.mark, ...d }
            : {
                  id: newId('mark'),
                  ...d,
                  lat: editing.pos[1],
                  lon: editing.pos[0],
                  createdAt: Date.now(),
              };
        if (await saveMark(mark)) {
            haptics.success();
            await loadPlaces();
            setSelection({ kind: 'mark', mark });
        } else {
            setError('Could not save the place.');
        }
    };

    const share = (name: string, pos: LngLat) => {
        const [lon, lat] = pos;
        Share.share({
            message: `${name}\n${formatCoords(lat, lon, prefs?.coords ?? 'dm')}\nhttps://www.openstreetmap.org/?mlat=${lat.toFixed(6)}&mlon=${lon.toFixed(6)}#map=16/${lat.toFixed(6)}/${lon.toFixed(6)}`,
        }).catch(() => undefined);
    };

    const finishDraft = () => {
        if (mode === 'route' && draft.length >= 2) {
            setNaming({ kind: 'route', name: `Route ${shortDate(new Date())}` });
            return;
        }
        setMode('browse');
        setDraft([]);
    };

    const saveName = async () => {
        const n = naming;
        setNaming(null);
        if (!n) {
            return;
        }
        const name = n.name.trim() || (n.kind === 'route' ? 'Route' : trackName());
        if (n.kind === 'route') {
            const r: MapRoute = { id: newId('route'), name, points: draft, createdAt: Date.now() };
            if (await saveRoute(r)) {
                await loadPlaces();
                setSelection({ kind: 'route', route: r });
            } else {
                setError('Could not save the route.');
            }
            setMode('browse');
            setDraft([]);
        } else if (n.id) {
            await mapNative.renameTrack(n.id, name).catch(() => false);
            if (prefs?.showTracks) {
                mapNative.listTracks().then(setTracks).catch(() => undefined);
            }
        }
    };

    /** Follow a track back (or again) as a route, e.g. back to the harbor. */
    const followTrack = async (summary: TrackSummary, reverse: boolean) => {
        const t = shownTrack?.id === summary.id ? shownTrack : await mapNative.getTrack(summary.id);
        if (!t || t.points.length < 2) {
            return;
        }
        const pts = thin(t.points.map(p => [p[1], p[0]] as LngLat), 30);
        const ordered = reverse ? [...pts].reverse() : pts;
        startNav({
            kind: 'route',
            route: { id: `track:${t.id}`, name: reverse ? `Back along ${t.name}` : t.name, points: ordered, createdAt: 0 },
            leg: 0,
        });
    };

    // ---- map files ----------------------------------------------------------------------

    const importMapFile = async () => {
        const unsubscribe = mapNative.onImportProgress((copied, total) => setImporting({ copied, total }));
        setImporting({ copied: 0, total: 0 });
        try {
            const file = await mapNative.importMap();
            if (file) {
                await loadFiles();
                if (prefs) {
                    savePrefs({ ...prefs, base: fileBaseId(file) });
                }
                if (file.bounds) {
                    const [w, s, e, n] = file.bounds;
                    camera.current?.fitBounds([e, n], [w, s], 40, 800);
                }
                setLayersOpen(false);
            }
        } catch (e: any) {
            setError(e?.message ?? 'Could not import that map.');
        } finally {
            unsubscribe();
            setImporting(null);
        }
    };

    const addOnlineMap = () => {
        const draftMap = addingOnline;
        if (!draftMap || !prefs) {
            return;
        }
        const url = draftMap.url.trim();
        if (!isWebUrl(url)) {
            setError('Enter a web address starting with https://');
            return;
        }
        const map: OnlineMap = { id: newId('online'), name: draftMap.name.trim() || 'My map', url, type: onlineMapType(url) };
        setAddingOnline(null);
        savePrefs({ ...prefs, custom: [...prefs.custom, map], base: `online:${map.id}` });
    };

    const removeOnlineMap = (map: OnlineMap) => {
        if (prefs) {
            savePrefs({
                ...prefs,
                custom: prefs.custom.filter(m => m.id !== map.id),
                base: prefs.base === `online:${map.id}` ? DEFAULT_MAP_PREFS.base : prefs.base,
            });
        }
    };

    // ---- what's drawn --------------------------------------------------------------------

    // Only what the style uses: changing units or toggles mustn't reload the map.
    const baseKey = prefs?.base;
    const custom = prefs?.custom;
    const seamarks = !!prefs?.seamarks;
    const base = useMemo(
        () => (baseKey && custom ? resolveBase({ ...DEFAULT_MAP_PREFS, base: baseKey, custom }, files) : null),
        [baseKey, custom, files],
    );
    const mapStyle = useMemo(
        () => (base ? buildStyle(base, { serverUrl, seamarks, dark: isDarkMode }) : undefined),
        [base, serverUrl, seamarks, isDarkMode],
    );

    /** A map file has no tiles below its lowest zoom, so don't let the camera go there. */
    const fileMap = base?.kind === 'file' ? base.file : null;
    const minZoom = fileMap ? fileMap.minZoom : undefined;

    /** Opening a map file while looking elsewhere (or too far out) shows only black: jump to the file. */
    useEffect(() => {
        if (!fileMap || !mapReady) {
            return;
        }
        const cam = cameraRef.current ?? prefsRef.current?.camera ?? START;
        const [lon, lat] = cam.center;
        const b = fileMap.bounds;
        const inside = !b || (lon >= b[0] && lon <= b[2] && lat >= b[1] && lat <= b[3]);
        if (inside && cam.zoom >= fileMap.minZoom) {
            return;
        }
        setFollow('off');
        if (b) {
            const [w, s, e, n] = b;
            camera.current?.fitBounds([e, n], [w, s], 40, 600);
        } else {
            camera.current?.setCamera({ centerCoordinate: cam.center, zoomLevel: fileMap.minZoom, animationDuration: 600 });
        }
        // Only when the chosen file or map readiness changes, not on every camera move.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [fileMap?.id, mapReady]);

    const shownMarks = useMemo(() => {
        if (!prefs?.showMarks) {
            return [];
        }
        const inView = visible
            ? marks.filter(
                  m =>
                      m.lat <= visible.ne[1] &&
                      m.lat >= visible.sw[1] &&
                      m.lon <= visible.ne[0] &&
                      m.lon >= visible.sw[0],
              )
            : marks;
        return inView.slice(0, MAX_PINS);
    }, [marks, visible, prefs?.showMarks]);

    const routesShape = useMemo(() => collection(routes.map(r => line(r.points, { id: r.id }))), [routes]);
    const tracksShape = useMemo(
        () =>
            collection(
                prefs?.showTracks
                    ? tracks.filter(t => t.preview?.length > 1).map(t => line(t.preview.map(([la, lo]) => [lo, la]), { id: t.id }))
                    : [],
            ),
        [tracks, prefs?.showTracks],
    );
    const shownTrackShape = useMemo(
        () => collection(shownTrack ? [line(shownTrack.points.map(p => [p[1], p[0]]))] : []),
        [shownTrack],
    );
    const liveShape = useMemo(() => collection(recording.path.length > 1 ? [line(recording.path)] : []), [recording.path]);
    const surveyShape = useMemo(
        () => collection(survey.segments.filter(seg => seg.length > 1).map(seg => line(seg))),
        [survey.segments],
    );
    const surveyMarkers = survey.state.markers.filter(m => m.lat !== null && m.lon !== null);
    const navRoute = nav?.kind === 'route' ? nav.route : null;
    const navRouteShape = useMemo(() => collection(navRoute ? [line(navRoute.points)] : []), [navRoute]);
    const navLineShape = useMemo(
        () => collection(fix && navTarget ? [line([fix.pos, navTarget])] : []),
        [fix, navTarget],
    );
    const draftShape = useMemo(() => collection(draft.length > 1 ? [line(draft)] : []), [draft]);
    const draftPoints = useMemo(() => points(draft), [draft]);
    const selectedRoute = selection?.kind === 'route' ? selection.route : null;
    const selectedRouteShape = useMemo(
        () => collection(selectedRoute ? [line(selectedRoute.points)] : []),
        [selectedRoute],
    );

    const drawColor = mode === 'measure' ? colors.warning : colors.accent;
    const layers = useMemo(
        () => ({
            tracks: { lineColor: TRACK_COLOR, lineWidth: 3, lineOpacity: 0.7, lineCap: 'round', lineJoin: 'round' } as const,
            shownTrack: { lineColor: TRACK_COLOR, lineWidth: 4.5, lineCap: 'round', lineJoin: 'round' } as const,
            routes: { lineColor: colors.accent, lineWidth: 3, lineOpacity: 0.55, lineDasharray: [2, 1.5] },
            selectedRoute: { lineColor: colors.accent, lineWidth: 5, lineCap: 'round' } as const,
            navRoute: { lineColor: colors.accent, lineWidth: 5, lineCap: 'round', lineJoin: 'round' } as const,
            navLine: { lineColor: colors.accent, lineWidth: 2.5, lineDasharray: [1, 1.5] },
            live: { lineColor: colors.primaryRed, lineWidth: 4, lineCap: 'round', lineJoin: 'round' } as const,
            survey: { lineColor: SURVEY_COLOR, lineWidth: 4.5, lineCap: 'round', lineJoin: 'round' } as const,
            draft: { lineColor: drawColor, lineWidth: 3, lineDasharray: [2, 1] },
            draftPoints: { circleRadius: 5, circleColor: '#FFFFFF', circleStrokeWidth: 2.5, circleStrokeColor: drawColor },
        }),
        [colors, drawColor],
    );

    // ---- panels --------------------------------------------------------------------------

    const units = prefs?.units ?? 'metric';
    const coordFormat = prefs?.coords ?? 'dm';
    const fromYou = (pos: LngLat) =>
        fix ? `${formatDistance(distance(fix.pos, pos), units)} · ${formatBearing(bearing(fix.pos, pos))} from you` : null;

    const selectionPanel = (() => {
        if (!selection) {
            return null;
        }
        const close = () => {
            if (selection.kind === 'track') {
                setShownTrack(null);
            }
            setSelection(null);
        };
        let title = '';
        let lines: (string | null)[] = [];
        let actions: SheetAction[] = [];
        if (selection.kind === 'point' || selection.kind === 'mark') {
            const mark = selection.kind === 'mark' ? selection.mark : null;
            const pos: LngLat = mark ? [mark.lon, mark.lat] : selection.kind === 'point' ? selection.pos : [0, 0];
            title = mark ? mark.name : 'Dropped pin';
            lines = [formatCoords(pos[1], pos[0], coordFormat), fromYou(pos), mark?.note || null];
            const goMark: MapMark = mark ?? {
                id: 'pin',
                name: 'Dropped pin',
                kind: 'spot',
                lat: pos[1],
                lon: pos[0],
                note: '',
                createdAt: 0,
            };
            actions = [
                { icon: 'Navigate', label: 'Go', onPress: () => startNav({ kind: 'mark', mark: goMark }), tint: colors.accent },
                mark
                    ? { icon: 'Edit', label: 'Edit', onPress: () => setMarkEditor({ pos, mark }) }
                    : { icon: 'Pin', label: 'Save', onPress: () => setMarkEditor({ pos }) },
                { icon: 'Share', label: 'Share', onPress: () => share(title, pos) },
                ...(mark ? [{ icon: 'Trash' as const, label: 'Delete', onPress: () => setDeleting(mark) }] : []),
            ];
        } else if (selection.kind === 'route') {
            const r = selection.route;
            title = r.name;
            lines = [`${formatDistance(pathLength(r.points), units)} · ${r.points.length} points`, fromYou(r.points[0])];
            actions = [
                { icon: 'Navigate', label: 'Follow', onPress: () => startNav({ kind: 'route', route: r, leg: 0 }), tint: colors.accent },
                {
                    icon: 'Restart',
                    label: 'Reverse',
                    onPress: () =>
                        startNav({ kind: 'route', route: { ...r, points: [...r.points].reverse(), name: `${r.name} (back)` }, leg: 0 }),
                },
                { icon: 'Pin', label: 'Saved', onPress: () => navigation.navigate('MapLibrary', { tab: 'routes' }) },
            ];
        } else {
            const t = selection.track;
            title = t.name;
            lines = [
                `${formatDistance(t.distance, units)} · ${formatDuration(t.endedAt - t.startedAt)}`,
                `${shortDate(new Date(t.startedAt))} · top speed ${formatSpeed(t.maxSpeed, units)}`,
            ];
            actions = [
                { icon: 'Restart', label: 'Go back', onPress: () => followTrack(t, true), tint: colors.accent },
                { icon: 'Navigate', label: 'Follow', onPress: () => followTrack(t, false) },
                { icon: 'Pin', label: 'Saved', onPress: () => navigation.navigate('MapLibrary', { tab: 'tracks' }) },
            ];
        }
        return (
            <SelectionPanel
                title={title}
                lines={lines.filter((l): l is string => !!l)}
                actions={actions}
                onClose={close}
            />
        );
    })();

    const drawPanel =
        mode === 'browse' ? null : (
            <DrawPanel
                title={mode === 'route' ? 'Plan a route' : 'Measure'}
                detail={
                    draft.length === 0
                        ? 'Tap the map to add points'
                        : draft.length === 1
                        ? 'Tap the next point'
                        : `${formatDistance(pathLength(draft), units)} · ${formatBearing(bearing(draft[draft.length - 2], draft[draft.length - 1]))} last leg`
                }
                canUndo={draft.length > 0}
                // Measuring saves nothing, so its second button clears the points instead.
                cancelLabel={mode === 'measure' ? 'Clear' : 'Cancel'}
                canCancel={mode !== 'measure' || draft.length > 0}
                doneLabel={mode === 'route' ? 'Save route' : 'Done'}
                canDone={mode === 'measure' || draft.length >= 2}
                onUndo={() => setDraft(d => d.slice(0, -1))}
                onCancel={() => {
                    setDraft([]);
                    if (mode !== 'measure') {
                        setMode('browse');
                    }
                }}
                onDone={finishDraft}
            />
        );

    const startDrawing = (next: Mode) => {
        setSelection(null);
        setDraft([]);
        setMode(next);
    };

    if (!prefs || !mapStyle) {
        return <View style={[styles.flex, { backgroundColor: colors.background }]} />;
    }

    const initial = prefs.camera ?? START;
    const followMode =
        follow === 'heading' ? (moving ? UserTrackingMode.FollowWithCourse : UserTrackingMode.FollowWithHeading) : UserTrackingMode.Follow;

    return (
        <View style={[styles.flex, { backgroundColor: colors.background }]}>
            <MapView
                style={styles.flex}
                mapStyle={mapStyle}
                logoEnabled={false}
                compassEnabled={false}
                attributionEnabled
                attributionPosition={{ bottom: panelHeight + insets.bottom + spacing.lg, left: spacing.sm }}
                onPress={onMapPress}
                onLongPress={onMapLongPress}
                onRegionDidChange={onRegionDidChange}
                onDidFinishLoadingMap={() => setMapReady(true)}
                regionDidChangeDebounceTime={300}>
                <Camera
                    ref={camera}
                    defaultSettings={{
                        centerCoordinate: initial.center,
                        zoomLevel: minZoom !== undefined ? Math.max(initial.zoom, minZoom) : initial.zoom,
                    }}
                    minZoomLevel={minZoom}
                    followUserLocation={follow !== 'off'}
                    followUserMode={followMode}
                    onUserTrackingModeChange={e => {
                        if (!e.nativeEvent.payload.followUserLocation) {
                            setFollow('off');
                        }
                    }}
                />
                {located ? (
                    <UserLocation
                        visible
                        renderMode="native"
                        androidRenderMode={moving ? 'gps' : 'compass'}
                        onUpdate={onLocation}
                    />
                ) : null}

                <ShapeSource id="tracks" shape={tracksShape} onPress={onTrackPress} hitbox={{ width: 16, height: 16 }}>
                    <LineLayer
                        id="tracks-line"
                        style={layers.tracks}
                    />
                </ShapeSource>
                <ShapeSource id="shown-track" shape={shownTrackShape}>
                    <LineLayer
                        id="shown-track-line"
                        style={layers.shownTrack}
                    />
                </ShapeSource>
                <ShapeSource id="routes" shape={routesShape} onPress={onRoutePress} hitbox={{ width: 16, height: 16 }}>
                    <LineLayer
                        id="routes-line"
                        style={layers.routes}
                    />
                </ShapeSource>
                <ShapeSource id="selected-route" shape={selectedRouteShape}>
                    <LineLayer id="selected-route-line" style={layers.selectedRoute} />
                </ShapeSource>
                <ShapeSource id="nav-route" shape={navRouteShape}>
                    <LineLayer
                        id="nav-route-line"
                        style={layers.navRoute}
                    />
                </ShapeSource>
                <ShapeSource id="nav-line" shape={navLineShape}>
                    <LineLayer id="nav-line-layer" style={layers.navLine} />
                </ShapeSource>
                <ShapeSource id="live-track" shape={liveShape}>
                    <LineLayer
                        id="live-track-line"
                        style={layers.live}
                    />
                </ShapeSource>
                <ShapeSource id="survey-track" shape={surveyShape}>
                    <LineLayer id="survey-track-line" style={layers.survey} />
                </ShapeSource>
                <ShapeSource id="draft" shape={draftShape}>
                    <LineLayer
                        id="draft-line"
                        style={layers.draft}
                    />
                </ShapeSource>
                <ShapeSource id="draft-points" shape={draftPoints}>
                    <CircleLayer
                        id="draft-points-circle"
                        style={layers.draftPoints}
                    />
                </ShapeSource>

                {shownMarks.map(m => (
                    <MarkerView key={m.id} coordinate={[m.lon, m.lat]} anchor={{ x: 0.5, y: 0.25 }} allowOverlap>
                        <MarkPin
                            kind={m.kind}
                            name={m.name}
                            selected={selection?.kind === 'mark' && selection.mark.id === m.id}
                            onPress={() => {
                                if (mode === 'browse') {
                                    featurePressAt.current = Date.now();
                                    setSelection({ kind: 'mark', mark: m });
                                }
                            }}
                        />
                    </MarkerView>
                ))}
                {surveyMarkers.map(m => (
                    <MarkerView key={`survey-${m.number}`} coordinate={[m.lon!, m.lat!]} anchor={{ x: 0.5, y: 0.25 }} allowOverlap>
                        <NumberPin number={m.number} color={SURVEY_COLOR} text={m.text} />
                    </MarkerView>
                ))}
                {selection?.kind === 'point' ? (
                    <MarkerView coordinate={selection.pos} anchor={{ x: 0.5, y: 1 }} allowOverlap>
                        <View style={styles.droppedPin}>
                            <Icon name="Pin" size={34} tint={colors.primaryRed} strokeWidth={2.2} />
                        </View>
                    </MarkerView>
                ) : null}
            </MapView>

            {/* Top: back; right: layers and compass. */}
            <View style={[styles.top, { top: insets.top + spacing.sm }]} pointerEvents="box-none">
                <MapButton icon="Back" label="Back" onPress={() => navigation.goBack()} />
                <View style={styles.flex} pointerEvents="none" />
                <View>
                    <MapButton icon="Layers" label="Map layers" onPress={() => setLayersOpen(true)} />
                    <MapButton
                        icon={prefs.base === SATELLITE_BASE ? 'Map' : 'Satellite'}
                        label={prefs.base === SATELLITE_BASE ? 'Back to your map' : 'Satellite view'}
                        onPress={() => savePrefs(toggleSatellite(prefs))}
                        style={styles.stacked}
                    />
                    {Math.abs(mapHeading) > 1 && (
                        <MapButton icon="Compass" label="Point north up" onPress={resetNorth} style={styles.stacked}>
                            <View style={{ transform: [{ rotate: `${-mapHeading}deg` }] }}>
                                <Icon name="Navigate" size={20} tint={colors.primaryRed} />
                            </View>
                        </MapButton>
                    )}
                </View>
            </View>

            {/* Bottom: locate button over the panel. */}
            <View style={[styles.bottom, { paddingBottom: insets.bottom + spacing.sm }]} pointerEvents="box-none">
                <View style={styles.locateRow} pointerEvents="box-none">
                    <MapButton icon="PinAdd" label="Save my location" onPress={saveHere} style={styles.stackedBottom} />
                    <MapButton
                        icon={follow === 'off' ? 'LocateOff' : 'Locate'}
                        label={follow === 'off' ? 'Show my location' : follow === 'north' ? 'Turn map with heading' : 'North up'}
                        active={follow !== 'off'}
                        onPress={cycleFollow}>
                        {follow === 'heading' ? <Icon name="Navigate" size={20} tint={colors.accent} /> : undefined}
                    </MapButton>
                </View>
                <View onLayout={e => setPanelHeight(e.nativeEvent.layout.height)}>
                    {drawPanel ??
                        selectionPanel ??
                        (surveyOpen ? (
                            <SurveyPanel
                                survey={survey}
                                units={units}
                                onClose={() => setSurveyOpen(false)}
                                onStarted={() => {
                                    setLocated(true);
                                    if (follow === 'off') {
                                        setFollow('north');
                                    }
                                }}
                                onSaved={() => navigation.navigate('MapLibrary', { tab: 'surveys' })}
                            />
                        ) : (
                            <InfoPanel
                                fix={fix}
                                units={units}
                                recording={recording.state}
                                onRecord={startRecording}
                                onPauseResume={pauseResume}
                                onStopRecording={stopRecording}
                                onRoute={() => startDrawing('route')}
                                onMeasure={() => startDrawing('measure')}
                                onSaved={() => navigation.navigate('MapLibrary')}
                                onSurvey={() => setSurveyOpen(true)}
                                surveyLine={surveyActive ? surveySummary(survey.state) : null}
                                onStopNav={nav ? () => setNav(null) : undefined}
                            />
                        ))}
                </View>
            </View>

            <LayersDialog
                visible={layersOpen}
                onClose={() => setLayersOpen(false)}
                prefs={prefs}
                files={files}
                onChange={savePrefs}
                onAddFile={importMapFile}
                onAddOnline={() => {
                    setLayersOpen(false);
                    setAddingOnline({ name: '', url: '' });
                }}
                onRemoveOnline={removeOnlineMap}
                importing={importing}
                onCancelImport={() => mapNative.cancelImport()}
            />

            <MarkEditor
                visible={!!markEditor}
                title={markEditor?.mark ? 'Edit place' : 'Save place'}
                initial={
                    markEditor?.mark
                        ? { name: markEditor.mark.name, kind: markEditor.mark.kind, note: markEditor.mark.note }
                        : { name: '', kind: 'spot', note: '' }
                }
                onCancel={() => setMarkEditor(null)}
                onSave={saveMarkDraft}
            />

            <Dialog
                visible={!!deleting}
                onClose={() => setDeleting(null)}
                title="Delete this place?"
                message={deleting ? `“${deleting.name}” will be removed from the map.` : undefined}
                icon="Trash"
                tone="danger"
                actions={confirmActions(
                    () => setDeleting(null),
                    'Delete',
                    async () => {
                        const mark = deleting;
                        setDeleting(null);
                        if (mark) {
                            await deleteMark(mark.id);
                            setSelection(null);
                            loadPlaces();
                        }
                    },
                    true,
                )}
            />

            <Dialog
                visible={!!naming}
                onClose={() => setNaming(null)}
                title={naming?.kind === 'track' ? 'Track saved' : 'Name the route'}
                message={
                    naming?.kind === 'track'
                        ? `${formatDistance(recording.state.distance || 0, units)} recorded. Give it a name, or keep this one.`
                        : undefined
                }
                actions={confirmActions(() => setNaming(null), 'Save', saveName)}>
                <TextField
                    value={naming?.name ?? ''}
                    onChangeText={name => setNaming(n => (n ? { ...n, name } : n))}
                    maxLength={60}
                    style={styles.field}
                />
            </Dialog>

            <Dialog
                visible={!!addingOnline}
                onClose={() => setAddingOnline(null)}
                title="Add online map"
                message="Paste a tile address with {z}, {x} and {y} in it, or a link to a map style (style.json)."
                actions={confirmActions(() => setAddingOnline(null), 'Add', addOnlineMap)}>
                <TextField
                    value={addingOnline?.name ?? ''}
                    onChangeText={name => setAddingOnline(a => (a ? { ...a, name } : a))}
                    placeholder="Name"
                    maxLength={40}
                    style={styles.field}
                />
                <TextField
                    value={addingOnline?.url ?? ''}
                    onChangeText={url => setAddingOnline(a => (a ? { ...a, url } : a))}
                    placeholder="https://…/{z}/{x}/{y}.png"
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="url"
                    style={styles.field}
                />
            </Dialog>

            <Dialog visible={!!error} onClose={() => setError(null)} title="Map" message={error ?? undefined} icon="Alert" />
            {mode !== 'browse' && (
                <View style={[styles.hint, { top: insets.top + 64 }]} pointerEvents="none">
                    <ThemedText size="small" weight="medium" style={styles.hintText}>
                        {mode === 'route' ? 'Tap to add route points' : 'Tap to measure'}
                    </ThemedText>
                </View>
            )}
        </View>
    );
};

const styles = StyleSheet.create({
    flex: {
        flex: 1,
    },
    top: {
        position: 'absolute',
        left: gutter,
        right: gutter,
        flexDirection: 'row',
        alignItems: 'flex-start',
    },
    stackedBottom: {
        marginBottom: spacing.sm,
    },
    stacked: {
        marginTop: spacing.sm,
    },
    bottom: {
        position: 'absolute',
        left: gutter,
        right: gutter,
        bottom: 0,
    },
    locateRow: {
        alignItems: 'flex-end',
        marginBottom: spacing.sm,
    },
    droppedPin: {
        alignItems: 'center',
    },
    field: {
        marginTop: spacing.md,
    },
    hint: {
        position: 'absolute',
        alignSelf: 'center',
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.xs + 2,
        borderRadius: 999,
        backgroundColor: 'rgba(20,22,26,0.78)',
    },
    hintText: {
        color: '#FFFFFF',
    },
});

export default MapScreen;
