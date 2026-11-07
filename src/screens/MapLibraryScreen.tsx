import React, { useCallback, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { RouteProp, useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import BackButton from '../components/BackButton';
import BaseScreen from '../components/BaseScreen';
import Button from '../components/Button';
import Dialog, { confirmActions } from '../components/Dialog';
import EmptyState from '../components/EmptyState';
import IconButton from '../components/IconButton';
import IconTile from '../components/IconTile';
import Segmented from '../components/Segmented';
import { ThemedText } from '../components/ThemedText';
import Icon, { IconName } from '../components/Icon';
import { MARK_STYLE } from '../components/map/mapUi';
import { useTheme } from '../context/ThemeContext';
import { gutter, shapes, spacing } from '../theme';
import {
    LngLat,
    MapLibraryTab,
    MapMark,
    MapPrefs,
    MapRoute,
    RootStackNavigation,
    RootStackParamList,
    Track,
    TrackSummary,
} from '../types/types';
import {
    DEFAULT_MAP_PREFS,
    addMarks,
    addRoutes,
    deleteMark,
    deleteRoute,
    getMapPrefs,
    getMarks,
    getRoutes,
    setMapPrefs,
} from '../storage';
import { MapFile, formatBytes, mapNative } from '../utils/mapNative';
import { formatCoords, formatDistance, formatDuration, pathLength } from '../utils/geo';
import { buildGpx, gpxFileName } from '../utils/gpx';
import { fileBaseId } from '../utils/mapStyle';
import { newId, shortDate } from '../utils/dates';
import { SurveySummary, buildSurveyGpx, buildSurveyJson, formatClock, surveyFileName, surveyNative } from '../utils/survey';
import { logger } from '../utils/logger';

interface Row {
    key: string;
    icon: IconName;
    /** A place's color; its icon then shows white on it. */
    color?: string;
    title: string;
    detail: string;
    onPress: () => void;
    onLongPress: () => void;
    trailing?: { icon: IconName; label: string; onPress: () => void };
}

const TABS: { value: MapLibraryTab; label: string }[] = [
    { value: 'marks', label: 'Places' },
    { value: 'routes', label: 'Routes' },
    { value: 'tracks', label: 'Tracks' },
    { value: 'surveys', label: 'Surveys' },
    { value: 'maps', label: 'Maps' },
];

/** Turns an imported line into a saved track, with distance and times worked out. */
const toTrack = (name: string, pts: [number, number, number, number][]): Track => {
    const times = pts.map(p => p[3]).filter(t => t > 0);
    const startedAt = times[0] ?? Date.now();
    return {
        id: newId('t').replace(/[^A-Za-z0-9_-]/g, ''),
        name,
        startedAt,
        endedAt: times[times.length - 1] ?? startedAt,
        distance: pathLength(pts.map(p => [p[1], p[0]] as LngLat)),
        movingMs: 0,
        maxSpeed: 0,
        points: pts.map(([lat, lon, alt, t]) => [lat, lon, alt, t, 0]),
    };
};

/** Everything saved for the map: places, routes, recorded tracks and offline map files. */
const MapLibraryScreen: React.FC = () => {
    const { colors } = useTheme().theme;
    const navigation = useNavigation<RootStackNavigation>();
    const route = useRoute<RouteProp<RootStackParamList, 'MapLibrary'>>();
    const [tab, setTab] = useState<MapLibraryTab>(route.params?.tab ?? 'marks');
    const [marks, setMarks] = useState<MapMark[]>([]);
    const [routes, setRoutes] = useState<MapRoute[]>([]);
    const [tracks, setTracks] = useState<TrackSummary[]>([]);
    const [surveys, setSurveys] = useState<SurveySummary[]>([]);
    const [surveyMenu, setSurveyMenu] = useState<SurveySummary | null>(null);
    const [files, setFiles] = useState<MapFile[]>([]);
    const [prefs, setPrefs] = useState<MapPrefs>(DEFAULT_MAP_PREFS);
    const [folder, setFolder] = useState('');
    const [loaded, setLoaded] = useState(false);
    const [confirm, setConfirm] = useState<{ title: string; message: string; run: () => Promise<unknown> } | null>(null);
    const [notice, setNotice] = useState<{ title: string; message: string } | null>(null);
    const [busy, setBusy] = useState(false);

    const load = useCallback(async () => {
        try {
            const [m, r, t, f, p] = await Promise.all([
                getMarks(),
                getRoutes(),
                mapNative.listTracks(),
                mapNative.listMaps(),
                getMapPrefs(),
            ]);
            setMarks([...m].sort((a, b) => b.createdAt - a.createdAt));
            setRoutes([...r].sort((a, b) => b.createdAt - a.createdAt));
            setTracks(t);
            setFiles(f);
            setPrefs(p);
            mapNative.mapsFolder().then(setFolder).catch(() => undefined);
            if (surveyNative.available) {
                surveyNative.list().then(setSurveys).catch(e => logger.warn('Could not load surveys', e));
            }
        } catch (error) {
            logger.warn('Could not load map library', error);
        } finally {
            setLoaded(true);
        }
    }, []);

    useFocusEffect(
        useCallback(() => {
            load();
        }, [load]),
    );

    const units = prefs.units;
    const show = (kind: 'mark' | 'route' | 'track', id: string) => navigation.navigate('Map', { show: { kind, id } });
    const go = (kind: 'mark' | 'route', id: string) => navigation.navigate('Map', { navigate: { kind, id } });

    // ---- import / export ----------------------------------------------------------

    const importPlaces = async () => {
        setBusy(true);
        try {
            const data = await mapNative.pickPlaces();
            if (!data) {
                return;
            }
            const now = Date.now();
            const newMarks: MapMark[] = data.marks.map((m, i) => ({
                id: newId('mark'),
                name: m.name || 'Mark',
                kind: 'spot',
                lat: m.lat,
                lon: m.lon,
                note: m.note ?? '',
                createdAt: now + i,
            }));
            const newRoutes: MapRoute[] = data.routes.map((r, i) => ({
                id: newId('route'),
                name: r.name || 'Route',
                points: r.points.map(([lat, lon]) => [lon, lat] as LngLat),
                createdAt: now + i,
            }));
            if (newMarks.length) {
                await addMarks(newMarks);
            }
            if (newRoutes.length) {
                await addRoutes(newRoutes);
            }
            for (const t of data.tracks) {
                await mapNative.saveTrack(toTrack(t.name || data.fileName, t.points));
            }
            const parts = [
                newMarks.length && `${newMarks.length} place${newMarks.length === 1 ? '' : 's'}`,
                newRoutes.length && `${newRoutes.length} route${newRoutes.length === 1 ? '' : 's'}`,
                data.tracks.length && `${data.tracks.length} track${data.tracks.length === 1 ? '' : 's'}`,
            ].filter(Boolean);
            setNotice({ title: 'Imported', message: `${parts.join(', ')} from ${data.fileName}.` });
            setTab(newMarks.length ? 'marks' : newRoutes.length ? 'routes' : 'tracks');
            load();
        } catch (e: any) {
            setNotice({ title: 'Could not import', message: e?.message ?? 'That file could not be read.' });
        } finally {
            setBusy(false);
        }
    };

    const exportGpx = async (name: string, data: Parameters<typeof buildGpx>[0]) => {
        try {
            await mapNative.saveFile(gpxFileName(name), 'application/gpx+xml', buildGpx(data));
        } catch (e: any) {
            setNotice({ title: 'Could not export', message: e?.message ?? 'The file could not be saved.' });
        }
    };

    const exportTrack = async (summary: TrackSummary) => {
        const track = await mapNative.getTrack(summary.id);
        if (track) {
            exportGpx(track.name, { tracks: [track] });
        }
    };

    const exportSurvey = async (summary: SurveySummary, kind: 'gpx' | 'json') => {
        setSurveyMenu(null);
        try {
            const survey = await surveyNative.get(summary.id);
            if (!survey) {
                throw new Error('The survey file could not be read.');
            }
            await mapNative.saveFile(
                surveyFileName(survey.name, kind),
                kind === 'gpx' ? 'application/gpx+xml' : 'application/json',
                kind === 'gpx' ? buildSurveyGpx(survey) : buildSurveyJson(survey),
            );
        } catch (e: any) {
            setNotice({ title: 'Could not export', message: e?.message ?? 'The file could not be saved.' });
        }
    };

    const importMap = async () => {
        setBusy(true);
        try {
            const file = await mapNative.importMap();
            if (file) {
                await setMapPrefs({ ...prefs, base: fileBaseId(file) });
                load();
                setNotice({ title: 'Map added', message: `${file.name} is now the map. It works without internet.` });
            }
        } catch (e: any) {
            setNotice({ title: 'Could not add map', message: e?.message ?? 'That file could not be used.' });
        } finally {
            setBusy(false);
        }
    };

    // ---- rows -------------------------------------------------------------------

    const ask = (title: string, message: string, run: () => Promise<unknown>) => setConfirm({ title, message, run });

    const rows: Row[] =
        tab === 'marks'
            ? marks.map(m => ({
                  key: m.id,
                  icon: MARK_STYLE[m.kind].icon,
                  color: MARK_STYLE[m.kind].color,
                  title: m.name,
                  detail: m.note || formatCoords(m.lat, m.lon, prefs.coords),
                  onPress: () => show('mark', m.id),
                  onLongPress: () => ask('Delete this place?', `“${m.name}” will be removed.`, () => deleteMark(m.id)),
                  trailing: { icon: 'Navigate', label: `Go to ${m.name}`, onPress: () => go('mark', m.id) },
              }))
            : tab === 'routes'
            ? routes.map(r => ({
                  key: r.id,
                  icon: 'Route',
                  title: r.name,
                  detail: `${formatDistance(pathLength(r.points), units)} · ${r.points.length} points`,
                  onPress: () => show('route', r.id),
                  onLongPress: () => ask('Delete this route?', `“${r.name}” will be removed.`, () => deleteRoute(r.id)),
                  trailing: { icon: 'Navigate', label: `Follow ${r.name}`, onPress: () => go('route', r.id) },
              }))
            : tab === 'tracks'
            ? tracks.map(t => ({
                  key: t.id,
                  icon: 'Activity',
                  title: t.name,
                  detail: `${shortDate(new Date(t.startedAt))} · ${formatDistance(t.distance, units)}${
                      t.endedAt > t.startedAt ? ` · ${formatDuration(t.endedAt - t.startedAt)}` : ''
                  }`,
                  onPress: () => show('track', t.id),
                  onLongPress: () =>
                      ask('Delete this track?', `“${t.name}” will be removed from this phone.`, () => mapNative.deleteTrack(t.id)),
                  trailing: { icon: 'Download', label: `Export ${t.name}`, onPress: () => exportTrack(t) },
              }))
            : tab === 'surveys'
            ? surveys.map(sv => ({
                  key: sv.id,
                  icon: 'Video',
                  title: sv.name,
                  detail: `${shortDate(new Date(sv.startedAt))} · ${formatClock(sv.activeMovementMs)} · ${sv.pointCount} points${
                      sv.markerCount ? ` · ${sv.markerCount} marker${sv.markerCount === 1 ? '' : 's'}` : ''
                  }`,
                  onPress: () => setSurveyMenu(sv),
                  onLongPress: () =>
                      ask('Delete this survey?', `“${sv.name}” and its GPS track will be removed from this phone.`, () =>
                          surveyNative.remove(sv.id),
                      ),
                  trailing: { icon: 'Download', label: `Export ${sv.name}`, onPress: () => setSurveyMenu(sv) },
              }))
            : files.map(f => ({
                  key: f.id,
                  icon: 'Layers',
                  title: f.name,
                  detail: `${f.type === 'vector' ? 'Vector' : 'Raster'} · ${formatBytes(f.size)} · zoom ${f.minZoom}–${f.maxZoom}${
                      prefs.base === fileBaseId(f) ? ' · in use' : ''
                  }`,
                  onPress: () => {
                      setMapPrefs({ ...prefs, base: fileBaseId(f) }).then(() => navigation.navigate('Map'));
                  },
                  onLongPress: () =>
                      ask('Delete this map?', `${f.name} (${formatBytes(f.size)}) will be deleted from this phone.`, () =>
                          mapNative.removeMap(f.id),
                      ),
              }));

    const empty = {
        marks: { icon: 'Pin' as IconName, title: 'No places yet', text: 'Hold your finger on the map to drop a pin, then save it. Or import a GPX, KML or GeoJSON file.' },
        routes: { icon: 'Route' as IconName, title: 'No routes yet', text: 'Tap Plan route on the map and tap the points to pass, in order.' },
        tracks: { icon: 'Activity' as IconName, title: 'No tracks yet', text: 'Tap Record on the map. It keeps recording with the screen off.' },
        surveys: { icon: 'Video' as IconName, title: 'No surveys yet', text: 'Tap Survey on the map to record a Water Wolf camera survey with its GPS track.' },
        maps: { icon: 'Layers' as IconName, title: 'No offline maps', text: 'Add an MBTiles or PMTiles file, such as a sea chart, to use the map without internet.' },
    }[tab];

    const renderRow = ({ item, index }: { item: Row; index: number }) => (
        <Pressable
            onPress={item.onPress}
            onLongPress={item.onLongPress}
            accessibilityRole="button"
            accessibilityLabel={item.title}
            style={({ pressed }) => [
                styles.row,
                { backgroundColor: pressed ? colors.elevated : colors.card, borderColor: colors.border },
                index === 0 && styles.first,
                index === rows.length - 1 && styles.last,
                index > 0 && { borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth },
            ]}>
            {item.color ? (
                <View style={[styles.disc, { backgroundColor: item.color }]}>
                    <Icon name={item.icon} size={16} tint="#FFFFFF" strokeWidth={2.2} />
                </View>
            ) : (
                <IconTile icon={item.icon} size={32} tone="neutral" />
            )}
            <View style={styles.rowText}>
                <ThemedText weight="medium" numberOfLines={1}>
                    {item.title}
                </ThemedText>
                <ThemedText size="small" color="muted" numberOfLines={1} tabular>
                    {item.detail}
                </ThemedText>
            </View>
            {item.trailing && (
                <IconButton icon={item.trailing.icon} accessibilityLabel={item.trailing.label} onPress={item.trailing.onPress} />
            )}
        </Pressable>
    );

    const footer =
        tab === 'maps' ? (
            <View style={styles.footer}>
                <Button label="Add map file" icon="Plus" iconLeading onPress={importMap} loading={busy} />
                {!!folder && (
                    <ThemedText size="small" color="muted" style={styles.hint}>
                        Big maps can also be copied over USB into {folder}
                    </ThemedText>
                )}
                {rows.length > 0 && (
                    <ThemedText size="small" color="muted" style={styles.hint}>
                        Tap a map to use it. Hold to delete.
                    </ThemedText>
                )}
            </View>
        ) : rows.length > 0 ? (
            <ThemedText size="small" color="muted" style={[styles.hint, styles.footer]}>
                {tab === 'surveys' ? 'Tap to export. Hold to delete.' : 'Tap to show on the map. Hold to delete.'}
            </ThemedText>
        ) : null;

    return (
        <BaseScreen
            title="Saved"
            subtitle="Places, routes, tracks, surveys and maps"
            headerLeft={<BackButton />}
            headerRight={
                <View style={styles.headerButtons}>
                    <IconButton icon="Upload" variant="outline" accessibilityLabel="Import GPX, KML or GeoJSON" onPress={importPlaces} />
                    {(marks.length > 0 || routes.length > 0) && (
                        <IconButton
                            icon="Download"
                            variant="outline"
                            accessibilityLabel="Export places and routes as GPX"
                            onPress={() => exportGpx('Places and routes', { marks, routes })}
                            style={styles.headerGap}
                        />
                    )}
                </View>
            }>
            <Segmented options={TABS} value={tab} onChange={setTab} style={styles.tabs} />
            {loaded && rows.length === 0 ? (
                <View>
                    <EmptyState icon={empty.icon} title={empty.title} text={empty.text}>
                        {tab === 'marks' || tab === 'tracks' ? (
                            <Button
                                label="Import a file"
                                icon="Upload"
                                iconLeading
                                variant="secondary"
                                onPress={importPlaces}
                                loading={busy}
                                style={styles.emptyButton}
                            />
                        ) : null}
                    </EmptyState>
                    {tab === 'maps' && footer}
                </View>
            ) : (
                <FlatList
                    data={rows}
                    keyExtractor={r => r.key}
                    renderItem={renderRow}
                    contentContainerStyle={styles.list}
                    ListFooterComponent={footer}
                />
            )}

            <Dialog
                visible={!!confirm}
                onClose={() => setConfirm(null)}
                title={confirm?.title ?? ''}
                message={confirm?.message}
                icon="Trash"
                tone="danger"
                actions={confirmActions(
                    () => setConfirm(null),
                    'Delete',
                    async () => {
                        const c = confirm;
                        setConfirm(null);
                        await c?.run().catch(() => undefined);
                        load();
                    },
                    true,
                )}
            />
            <Dialog
                visible={!!surveyMenu}
                onClose={() => setSurveyMenu(null)}
                title={surveyMenu?.name ?? ''}
                message={
                    surveyMenu
                        ? `Moving ${formatClock(surveyMenu.activeMovementMs)} of ${formatClock(surveyMenu.totalElapsedMs)} since the camera started · ${formatDistance(surveyMenu.distance, units)}. Export the GPS track as GPX, or everything (times, events, markers, points) as JSON.`
                        : undefined
                }
                icon="Download"
                actions={
                    surveyMenu
                        ? [
                              { label: 'GPX', variant: 'secondary', onPress: () => exportSurvey(surveyMenu, 'gpx') },
                              { label: 'JSON', onPress: () => exportSurvey(surveyMenu, 'json') },
                          ]
                        : undefined
                }
            />
            <Dialog visible={!!notice} onClose={() => setNotice(null)} title={notice?.title ?? ''} message={notice?.message} />
        </BaseScreen>
    );
};

const styles = StyleSheet.create({
    headerButtons: {
        flexDirection: 'row',
    },
    headerGap: {
        marginLeft: spacing.sm,
    },
    tabs: {
        marginHorizontal: gutter,
        marginTop: spacing.xs,
        marginBottom: spacing.md,
    },
    list: {
        paddingBottom: spacing.xl,
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        marginHorizontal: gutter,
        paddingLeft: spacing.md,
        paddingRight: spacing.sm,
        paddingVertical: spacing.sm + 2,
        borderLeftWidth: shapes.borderWidth.thin,
        borderRightWidth: shapes.borderWidth.thin,
    },
    first: {
        borderTopWidth: shapes.borderWidth.thin,
        borderTopLeftRadius: shapes.borderRadius.large,
        borderTopRightRadius: shapes.borderRadius.large,
    },
    last: {
        borderBottomWidth: shapes.borderWidth.thin,
        borderBottomLeftRadius: shapes.borderRadius.large,
        borderBottomRightRadius: shapes.borderRadius.large,
    },
    disc: {
        width: 32,
        height: 32,
        borderRadius: 16,
        alignItems: 'center',
        justifyContent: 'center',
    },
    rowText: {
        flex: 1,
        marginLeft: spacing.sm + 2,
    },
    footer: {
        marginHorizontal: gutter,
        marginTop: spacing.md,
    },
    hint: {
        marginTop: spacing.sm,
    },
    emptyButton: {
        marginTop: spacing.md,
    },
});

export default MapLibraryScreen;
