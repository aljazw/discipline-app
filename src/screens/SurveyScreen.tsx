import React, { useCallback, useRef, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import notifee from '@notifee/react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import BackButton from '../components/BackButton';
import BaseScreen from '../components/BaseScreen';
import Button from '../components/Button';
import Chip from '../components/Chip';
import Dialog, { confirmActions } from '../components/Dialog';
import Icon, { IconName } from '../components/Icon';
import IconButton from '../components/IconButton';
import TextField from '../components/TextField';
import { ThemedText } from '../components/ThemedText';
import { useTheme } from '../context/ThemeContext';
import { useAppForeground } from '../hooks/useAppForeground';
import { gutter, shapes, spacing } from '../theme';
import { MapUnits, RootStackNavigation } from '../types/types';
import { getMapPrefs } from '../storage';
import { formatDistance } from '../utils/geo';
import { haptics } from '../utils/haptics';
import { requestLocation } from '../utils/mapNative';
import { IDLE_SURVEY, LiveSurvey, formatClock, surveyButtons, surveyNative } from '../utils/survey';

const MARKER_IDEAS = ['Rock', 'Interesting structure', 'Fish', 'Seabed change'];

const STATUS: Record<LiveSurvey['state'], { label: string; caption: string }> = {
    IDLE: { label: 'Ready', caption: 'Start the Water Wolf camera, then tap Recording started' },
    CAMERA_RECORDING_STARTED: { label: 'Camera recording', caption: 'since the camera started · tap Start moving when you set off' },
    MOVING: { label: 'Moving · recording GPS', caption: 'since you started moving' },
    PAUSED: { label: 'Paused · GPS not recorded', caption: 'since you started moving' },
    COMPLETED: { label: 'Saved', caption: '' },
    DISCARDED: { label: 'Discarded', caption: '' },
};

interface BigButtonProps {
    icon: IconName;
    label: string;
    enabled: boolean;
    onPress: () => void;
    tone?: 'primary' | 'normal' | 'danger';
}

/** A large, glove-friendly control; dimmed when it can't be used right now. */
const BigButton: React.FC<BigButtonProps> = ({ icon, label, enabled, onPress, tone = 'normal' }) => {
    const { colors } = useTheme().theme;
    const style = {
        primary: { bg: colors.accent, fg: colors.onAccent, border: colors.accent },
        normal: { bg: colors.card, fg: colors.text, border: colors.border },
        danger: { bg: colors.redSoft, fg: colors.primaryRed, border: colors.redSoft },
    }[enabled ? tone : 'normal'];
    return (
        <Pressable
            onPress={enabled ? onPress : undefined}
            disabled={!enabled}
            accessibilityRole="button"
            accessibilityLabel={label}
            accessibilityState={{ disabled: !enabled }}
            style={({ pressed }) => [
                styles.big,
                { backgroundColor: style.bg, borderColor: style.border, opacity: enabled ? (pressed ? 0.8 : 1) : 0.4 },
            ]}>
            <Icon name={icon} size={28} tint={style.fg} strokeWidth={2.2} />
            <ThemedText weight="bold" size="large" style={[styles.bigLabel, { color: style.fg }]} numberOfLines={2}>
                {label}
            </ThemedText>
        </Pressable>
    );
};

/** Water Wolf survey recorder: ties the camera's video to the boat's GPS track. */
const SurveyScreen: React.FC = () => {
    const { colors } = useTheme().theme;
    const navigation = useNavigation<RootStackNavigation>();
    const [survey, setSurvey] = useState<LiveSurvey>(IDLE_SURVEY);
    const [gpsOn, setGpsOn] = useState(true);
    const [batteryOk, setBatteryOk] = useState(true);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<{ title: string; message: string; settings?: boolean } | null>(null);
    const [confirm, setConfirm] = useState<'stop' | 'discard' | null>(null);
    const [marker, setMarker] = useState<{ number: number; text: string } | null>(null);
    const [saved, setSaved] = useState<{ id: string; name: string; original: string; detail: string } | null>(null);
    const [units, setUnits] = useState<MapUnits>('metric');
    const last = useRef<LiveSurvey>(IDLE_SURVEY);

    const refresh = useCallback(async () => {
        const s = await surveyNative.state();
        last.current = s;
        setSurvey(s);
    }, []);

    const checkPhone = useCallback(() => {
        surveyNative.gpsEnabled().then(setGpsOn).catch(() => undefined);
        surveyNative.batteryUnrestricted().then(setBatteryOk).catch(() => undefined);
    }, []);

    useFocusEffect(
        useCallback(() => {
            refresh();
            checkPhone();
            getMapPrefs()
                .then(p => setUnits(p.units))
                .catch(() => undefined);
            // The recording itself runs natively; this only keeps the display live.
            const timer = setInterval(refresh, 1000);
            return () => clearInterval(timer);
        }, [refresh, checkPhone]),
    );

    useAppForeground(() => {
        refresh();
        checkPhone();
    });

    const run = async (task: () => Promise<LiveSurvey>, failTitle: string) => {
        if (busy) {
            return null;
        }
        setBusy(true);
        try {
            const s = await task();
            last.current = s;
            setSurvey(s);
            return s;
        } catch (e: any) {
            haptics.warning();
            setError({ title: failTitle, message: e?.message ?? 'Something went wrong.' });
            refresh();
            return null;
        } finally {
            setBusy(false);
        }
    };

    // ---- controls -------------------------------------------------------------------

    const startCamera = async () => {
        if (!(await requestLocation())) {
            setError({
                title: 'Location is off for this app',
                message: 'A survey needs precise location to record the GPS track. Allow it in the app settings.',
                settings: true,
            });
            return;
        }
        // The survey's live notification (time, GPS, Pause, Add marker).
        await notifee.requestPermission().catch(() => undefined);
        if ((await run(surveyNative.startCamera, 'Could not start the survey')) !== null) {
            haptics.success();
        }
        checkPhone();
    };

    const startMoving = async () => {
        if ((await run(surveyNative.startMoving, 'Could not start moving')) !== null) {
            haptics.success();
        }
    };

    const pauseResume = async () => {
        const s = await run(
            survey.state === 'PAUSED' ? surveyNative.resume : surveyNative.pause,
            survey.state === 'PAUSED' ? 'Could not resume' : 'Could not pause',
        );
        if (s) {
            haptics.toggle();
        }
    };

    const addMarker = async () => {
        const s = await run(() => surveyNative.addMarker(), 'Could not add the marker');
        if (s) {
            haptics.success();
            setMarker({ number: s.markerCount, text: '' });
        }
    };

    const saveMarkerText = async (text: string) => {
        const m = marker;
        setMarker(null);
        if (m && text.trim()) {
            await surveyNative.labelMarker(m.number, text.trim()).catch(() => undefined);
        }
    };

    const stop = async () => {
        setConfirm(null);
        const before = last.current;
        const s = await run(surveyNative.stop, 'The survey was not saved');
        if (s && before.id) {
            haptics.success();
            const name = before.name ?? 'Survey';
            setSaved({
                id: before.id,
                name,
                original: name,
                detail: `${before.pointCount} GPS points · ${formatClock(before.activeMovementMs)} moving · ${
                    before.markerCount
                } marker${before.markerCount === 1 ? '' : 's'}`,
            });
        }
    };

    const discard = async () => {
        setConfirm(null);
        await run(surveyNative.discard, 'Could not discard');
    };

    const closeSaved = async () => {
        const s = saved;
        setSaved(null);
        if (s && s.name.trim() && s.name.trim() !== s.original) {
            await surveyNative.rename(s.id, s.name.trim()).catch(() => undefined);
        }
    };

    // ---- display --------------------------------------------------------------------

    const buttons = surveyButtons(survey.state);
    const moving = survey.state === 'MOVING' || survey.state === 'PAUSED';
    const status = STATUS[survey.state];
    const dot =
        survey.state === 'MOVING'
            ? colors.primaryGreen
            : survey.state === 'PAUSED'
            ? colors.warning
            : survey.state === 'CAMERA_RECORDING_STARTED'
            ? colors.primaryRed
            : colors.muted;
    const timer = moving ? survey.surveyElapsedMs : survey.cameraElapsedMs;

    const gpsLine = (() => {
        if (survey.state === 'IDLE') {
            return null;
        }
        switch (survey.gps) {
            case 'off':
                return { text: 'GPS is turned off', warn: true };
            case 'lost':
                return { text: 'No GPS signal · recording continues when it returns', warn: true };
            case 'waiting':
                return { text: 'Waiting for GPS…', warn: survey.state === 'MOVING' };
            case 'weak':
                return { text: `Weak GPS · ±${Math.round(survey.accuracy ?? 0)} m`, warn: true };
            default:
                return { text: `GPS ±${Math.round(survey.accuracy ?? 0)} m`, warn: false };
        }
    })();

    const details = moving
        ? [
              `Camera ${formatClock(survey.cameraElapsedMs)}`,
              survey.pausedMs > 0 ? `paused ${formatClock(survey.pausedMs)}` : null,
              `${survey.pointCount} points`,
              formatDistance(survey.distance, units),
          ]
              .filter(Boolean)
              .join(' · ')
        : null;

    const warnings: { icon: IconName; text: string; action: string; onPress: () => void }[] = [];
    if (!gpsOn) {
        warnings.push({
            icon: 'LocateOff',
            text: 'GPS is turned off on this phone.',
            action: 'Turn on',
            onPress: () => surveyNative.openLocationSettings().catch(() => undefined),
        });
    }
    if (!batteryOk) {
        warnings.push({
            icon: 'Alert',
            text: 'Battery saving may stop GPS while the screen is off.',
            action: 'Allow',
            onPress: () => surveyNative.requestBatteryUnrestricted().catch(() => undefined),
        });
    }

    return (
        <BaseScreen
            title="Water Wolf"
            subtitle="Camera survey with GPS track"
            headerLeft={<BackButton />}
            headerRight={
                <IconButton
                    icon="Folder"
                    variant="outline"
                    accessibilityLabel="Saved surveys"
                    onPress={() => navigation.navigate('MapLibrary', { tab: 'surveys' })}
                />
            }>
            <ScrollView contentContainerStyle={styles.scroll}>
                {warnings.map(w => (
                    <View key={w.text} style={[styles.warning, { backgroundColor: colors.card, borderColor: colors.border }]}>
                        <Icon name={w.icon} size={18} tint={colors.warning} />
                        <ThemedText size="small" style={styles.warningText}>
                            {w.text}
                        </ThemedText>
                        <Button label={w.action} compact variant="secondary" onPress={w.onPress} />
                    </View>
                ))}

                <View style={styles.status}>
                    <View style={styles.statusRow}>
                        <View style={[styles.dot, { backgroundColor: dot }]} />
                        <ThemedText weight="strong" size="large">
                            {status.label}
                        </ThemedText>
                    </View>
                    <ThemedText size="hero" weight="bold" tabular style={styles.timer} accessibilityRole="timer">
                        {formatClock(timer)}
                    </ThemedText>
                    {!!status.caption && (
                        <ThemedText size="small" color="muted" style={styles.center}>
                            {status.caption}
                        </ThemedText>
                    )}
                    {!!details && (
                        <ThemedText color="muted" tabular style={[styles.center, styles.details]}>
                            {details}
                        </ThemedText>
                    )}
                    {gpsLine && (
                        <View style={styles.gps}>
                            <Icon name="Satellite" size={16} tint={gpsLine.warn ? colors.warning : colors.muted} />
                            <ThemedText
                                size="small"
                                weight={gpsLine.warn ? 'strong' : 'regular'}
                                style={[styles.gpsText, { color: gpsLine.warn ? colors.warning : colors.muted }]}>
                                {gpsLine.text}
                            </ThemedText>
                        </View>
                    )}
                </View>

                <View style={styles.grid}>
                    <View style={styles.gridRow}>
                        <BigButton
                            icon="Video"
                            label="Recording started"
                            enabled={buttons.camera && !busy}
                            tone="primary"
                            onPress={startCamera}
                        />
                        <View style={styles.gap} />
                        <BigButton
                            icon="Ship"
                            label="Start moving"
                            enabled={buttons.move && !busy}
                            tone="primary"
                            onPress={startMoving}
                        />
                    </View>
                    <View style={styles.gridRow}>
                        <BigButton
                            icon={survey.state === 'PAUSED' ? 'Play' : 'Pause'}
                            label={survey.state === 'PAUSED' ? 'Resume' : 'Pause'}
                            enabled={(buttons.pause || buttons.resume) && !busy}
                            tone={survey.state === 'PAUSED' ? 'primary' : 'normal'}
                            onPress={pauseResume}
                        />
                        <View style={styles.gap} />
                        <BigButton
                            icon="Stop"
                            label="Stop"
                            enabled={buttons.stop && !busy}
                            tone="danger"
                            onPress={() => setConfirm('stop')}
                        />
                    </View>
                </View>

                {buttons.marker && (
                    <Button
                        label="Add marker"
                        icon="PinAdd"
                        iconLeading
                        variant="secondary"
                        onPress={addMarker}
                        disabled={busy}
                        style={styles.marker}
                    />
                )}
                {buttons.discard && (
                    <Button label="Discard" variant="ghost" onPress={() => setConfirm('discard')} style={styles.discard} />
                )}
                {survey.state === 'IDLE' && (
                    <ThemedText size="small" color="muted" style={[styles.center, styles.hint]}>
                        Recording keeps going with the screen locked or another app open. Pause, resume and markers are
                        also in the notification.
                    </ThemedText>
                )}
            </ScrollView>

            <Dialog
                visible={confirm === 'stop'}
                onClose={() => setConfirm(null)}
                title="Stop the survey?"
                message="GPS recording ends and the survey is saved. Stop the camera recording too."
                icon="Stop"
                tone="danger"
                actions={confirmActions(() => setConfirm(null), 'Stop and save', stop, true)}
            />
            <Dialog
                visible={confirm === 'discard'}
                onClose={() => setConfirm(null)}
                title="Discard this survey?"
                message="Nothing is saved, since you haven't started moving."
                icon="Trash"
                tone="danger"
                actions={confirmActions(() => setConfirm(null), 'Discard', discard, true)}
            />
            <Dialog
                visible={!!marker}
                onClose={() => saveMarkerText(marker?.text ?? '')}
                title={`Marker ${marker?.number ?? ''} saved`}
                message="Its position and time are recorded. Add a note if you like."
                icon="Pin"
                tone="success"
                actions={[
                    { label: 'Skip', onPress: () => saveMarkerText(''), variant: 'secondary' },
                    { label: 'Save note', onPress: () => saveMarkerText(marker?.text ?? '') },
                ]}>
                <View style={styles.chips}>
                    {MARKER_IDEAS.map(idea => (
                        <Chip
                            key={idea}
                            label={idea}
                            selected={marker?.text === idea}
                            onPress={() => setMarker(m => (m ? { ...m, text: idea } : m))}
                            style={styles.chip}
                        />
                    ))}
                </View>
                <TextField
                    value={marker?.text ?? ''}
                    onChangeText={text => setMarker(m => (m ? { ...m, text } : m))}
                    placeholder="Note (optional)"
                    returnKeyType="done"
                    onSubmitEditing={() => saveMarkerText(marker?.text ?? '')}
                />
            </Dialog>
            <Dialog
                visible={!!saved}
                onClose={closeSaved}
                title="Survey saved"
                message={saved?.detail}
                icon="Check"
                tone="success"
                actions={[
                    {
                        label: 'Saved surveys',
                        variant: 'secondary',
                        onPress: async () => {
                            await closeSaved();
                            navigation.navigate('MapLibrary', { tab: 'surveys' });
                        },
                    },
                    { label: 'Done', onPress: closeSaved },
                ]}>
                <TextField
                    value={saved?.name ?? ''}
                    onChangeText={name => setSaved(s => (s ? { ...s, name } : s))}
                    placeholder="Name"
                    returnKeyType="done"
                />
            </Dialog>
            <Dialog
                visible={!!error}
                onClose={() => setError(null)}
                title={error?.title ?? ''}
                message={error?.message}
                icon="Alert"
                tone="danger"
                actions={
                    error?.settings
                        ? confirmActions(() => setError(null), 'Open settings', () => {
                              setError(null);
                              Linking.openSettings().catch(() => undefined);
                          })
                        : undefined
                }
            />
        </BaseScreen>
    );
};

const styles = StyleSheet.create({
    scroll: {
        paddingHorizontal: gutter,
        paddingBottom: spacing.xl,
    },
    warning: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: spacing.sm + 2,
        marginTop: spacing.sm,
        borderWidth: shapes.borderWidth.thin,
        borderRadius: shapes.borderRadius.large,
    },
    warningText: {
        flex: 1,
        marginHorizontal: spacing.sm,
    },
    status: {
        alignItems: 'center',
        paddingVertical: spacing.lg,
    },
    statusRow: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    dot: {
        width: 12,
        height: 12,
        borderRadius: 6,
        marginRight: spacing.sm,
    },
    timer: {
        marginTop: spacing.sm,
        fontSize: 72,
        lineHeight: 84,
    },
    center: {
        textAlign: 'center',
    },
    details: {
        marginTop: spacing.sm,
    },
    gps: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: spacing.sm,
    },
    gpsText: {
        marginLeft: spacing.xs,
    },
    grid: {
        marginTop: spacing.sm,
    },
    gridRow: {
        flexDirection: 'row',
        marginBottom: spacing.sm + 2,
    },
    gap: {
        width: spacing.sm + 2,
    },
    big: {
        flex: 1,
        minHeight: 108,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: spacing.sm,
        paddingVertical: spacing.md,
        borderWidth: shapes.borderWidth.thin,
        borderRadius: shapes.borderRadius.large,
    },
    bigLabel: {
        marginTop: spacing.sm,
        textAlign: 'center',
    },
    marker: {
        marginTop: spacing.xs,
    },
    discard: {
        marginTop: spacing.sm,
    },
    hint: {
        marginTop: spacing.lg,
    },
    chips: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        marginTop: spacing.md,
        marginBottom: spacing.sm,
    },
    chip: {
        marginRight: spacing.xs,
        marginBottom: spacing.xs,
    },
});

export default SurveyScreen;
