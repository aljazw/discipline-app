/** The Water Wolf survey controls, as a panel over the map, so your position and the track stay in view. */
import React, { useState } from 'react';
import { Linking, Pressable, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import notifee from '@notifee/react-native';
import { useTheme } from '../../context/ThemeContext';
import { shapes, spacing } from '../../theme';
import { MapUnits } from '../../types/types';
import Button from '../Button';
import Chip from '../Chip';
import Dialog, { confirmActions } from '../Dialog';
import Icon, { IconName } from '../Icon';
import IconButton from '../IconButton';
import TextField from '../TextField';
import { ThemedText } from '../ThemedText';
import { Panel } from './MapPanels';
import { SurveyHandle } from '../../hooks/useSurvey';
import { formatDistance } from '../../utils/geo';
import { haptics } from '../../utils/haptics';
import { requestLocation } from '../../utils/mapNative';
import { LiveSurvey, formatClock, surveyButtons, surveyNative } from '../../utils/survey';

const MARKER_IDEAS = ['Rock', 'Interesting structure', 'Fish', 'Seabed change'];

const STATUS: Record<LiveSurvey['state'], string> = {
    IDLE: 'Start the camera, then tap Recording started',
    CAMERA_RECORDING_STARTED: 'Camera recording · not moving yet',
    MOVING: 'Moving · recording GPS',
    PAUSED: 'Paused · GPS not recorded',
    COMPLETED: 'Saving…',
    DISCARDED: 'Discarded',
};

/** A large, glove-friendly control; dimmed when it can't be used right now. */
const BigButton: React.FC<{
    icon: IconName;
    label: string;
    enabled: boolean;
    onPress: () => void;
    tone?: 'primary' | 'normal' | 'danger';
}> = ({ icon, label, enabled, onPress, tone = 'normal' }) => {
    const { colors } = useTheme().theme;
    const style = {
        primary: { bg: colors.accent, fg: colors.onAccent, border: colors.accent },
        normal: { bg: colors.elevated, fg: colors.text, border: colors.border },
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
                { backgroundColor: style.bg, borderColor: style.border, opacity: enabled ? (pressed ? 0.75 : 1) : 0.35 },
            ]}>
            <Icon name={icon} size={24} tint={style.fg} strokeWidth={2.2} />
            <ThemedText size="small" weight="bold" style={[styles.bigLabel, { color: style.fg }]} numberOfLines={2}>
                {label}
            </ThemedText>
        </Pressable>
    );
};

export const SurveyPanel: React.FC<{
    survey: SurveyHandle;
    units: MapUnits;
    /** Hides the panel; a running survey keeps recording and shows in the map's bottom bar. */
    onClose: () => void;
    /** Recording started: the map shows and follows your position. */
    onStarted: () => void;
    onSaved: () => void;
    style?: StyleProp<ViewStyle>;
}> = ({ survey, units, onClose, onStarted, onSaved, style }) => {
    const { colors } = useTheme().theme;
    const s = survey.state;
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<{ title: string; message: string; settings?: boolean } | null>(null);
    const [confirm, setConfirm] = useState<'stop' | 'discard' | null>(null);
    const [marker, setMarker] = useState<{ number: number; text: string } | null>(null);
    const [saved, setSaved] = useState<{ id: string; name: string; original: string; detail: string } | null>(null);

    const run = async (task: () => Promise<LiveSurvey>, failTitle: string) => {
        if (busy) {
            return null;
        }
        setBusy(true);
        try {
            const next = await task();
            survey.setState(next);
            return next;
        } catch (e: any) {
            haptics.warning();
            setError({ title: failTitle, message: e?.message ?? 'Something went wrong.' });
            survey.refresh();
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
        if ((await run(surveyNative.startCamera, 'Could not start the survey')) !== null) {
            haptics.success();
            onStarted();
        }
        survey.checkPhone();
        // For the live notification (time, GPS, Pause, Add marker). Asked after starting,
        // so a slow or hidden permission prompt can never hold up the camera time.
        notifee.requestPermission().catch(() => undefined);
    };

    const startMoving = async () => {
        if ((await run(surveyNative.startMoving, 'Could not start moving')) !== null) {
            haptics.success();
        }
    };

    const pauseResume = async () => {
        const paused = s.state === 'PAUSED';
        if (await run(paused ? surveyNative.resume : surveyNative.pause, paused ? 'Could not resume' : 'Could not pause')) {
            haptics.toggle();
        }
    };

    const addMarker = async () => {
        const next = await run(() => surveyNative.addMarker(), 'Could not add the marker');
        if (next) {
            haptics.success();
            setMarker({ number: next.markerCount, text: '' });
        }
    };

    const saveMarkerText = async (text: string) => {
        const m = marker;
        setMarker(null);
        if (m && text.trim()) {
            await surveyNative.labelMarker(m.number, text.trim()).catch(() => undefined);
            survey.refresh();
        }
    };

    const stop = async () => {
        setConfirm(null);
        const before = survey.latest.current;
        const next = await run(surveyNative.stop, 'The survey was not saved');
        if (next && before.id) {
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
        const v = saved;
        setSaved(null);
        if (v && v.name.trim() && v.name.trim() !== v.original) {
            await surveyNative.rename(v.id, v.name.trim()).catch(() => undefined);
        }
    };

    // ---- display --------------------------------------------------------------------

    const buttons = surveyButtons(s.state);
    const moving = s.state === 'MOVING' || s.state === 'PAUSED';
    const dot =
        s.state === 'MOVING'
            ? colors.primaryGreen
            : s.state === 'PAUSED'
            ? colors.warning
            : s.state === 'CAMERA_RECORDING_STARTED'
            ? colors.primaryRed
            : colors.muted;

    const gps = (() => {
        if (s.state === 'IDLE') {
            return null;
        }
        const acc = `±${Math.round(s.accuracy ?? 0)} m`;
        switch (s.gps) {
            case 'off':
                return { text: 'GPS is turned off', warn: true };
            case 'lost':
                return { text: 'No GPS signal · recording continues when it returns', warn: true };
            case 'waiting':
                return { text: 'Getting a GPS fix… outdoors this can take a minute or two', warn: true };
            case 'rough':
                return { text: `Rough position ${acc} · waiting for satellites`, warn: true };
            case 'weak':
                return { text: `Weak GPS ${acc}`, warn: true };
            default:
                return { text: `GPS ${acc}`, warn: false };
        }
    })();

    const details = moving
        ? [
              `Camera ${formatClock(s.cameraElapsedMs)}`,
              s.pausedMs > 0 ? `paused ${formatClock(s.pausedMs)}` : null,
              `${s.pointCount} points`,
              formatDistance(s.distance, units),
          ]
              .filter(Boolean)
              .join(' · ')
        : null;

    const warnings: { icon: IconName; text: string; action: string; onPress: () => void }[] = [];
    if (!survey.gpsOn) {
        warnings.push({
            icon: 'LocateOff',
            text: 'GPS is turned off on this phone.',
            action: 'Turn on',
            onPress: () => surveyNative.openLocationSettings().catch(() => undefined),
        });
    }
    if (!survey.batteryOk) {
        warnings.push({
            icon: 'Alert',
            text: 'Battery saving may stop GPS with the screen off.',
            action: 'Allow',
            onPress: () => surveyNative.requestBatteryUnrestricted().catch(() => undefined),
        });
    }

    return (
        <Panel style={style}>
            <View style={styles.head}>
                <View style={[styles.dot, { backgroundColor: dot }]} />
                <View style={styles.flex}>
                    <ThemedText size="tiny" color="muted" caps>
                        Water Wolf survey
                    </ThemedText>
                    <ThemedText size="small" weight="strong" numberOfLines={2}>
                        {STATUS[s.state]}
                    </ThemedText>
                </View>
                {s.state !== 'IDLE' && (
                    <ThemedText size="display" weight="bold" tabular accessibilityRole="timer" style={styles.timer}>
                        {formatClock(moving ? s.surveyElapsedMs : s.cameraElapsedMs)}
                    </ThemedText>
                )}
                <IconButton icon="Close" accessibilityLabel="Hide survey controls" onPress={onClose} />
            </View>

            {!!details && (
                <ThemedText size="small" color="muted" tabular numberOfLines={1} style={styles.line}>
                    {details}
                </ThemedText>
            )}
            {gps && (
                <View style={styles.gps}>
                    <Icon name="Satellite" size={14} tint={gps.warn ? colors.warning : colors.muted} />
                    <ThemedText
                        size="small"
                        weight={gps.warn ? 'strong' : 'regular'}
                        numberOfLines={2}
                        style={[styles.gpsText, { color: gps.warn ? colors.warning : colors.muted }]}>
                        {gps.text}
                    </ThemedText>
                </View>
            )}
            {warnings.map(w => (
                <View key={w.text} style={[styles.warning, { borderColor: colors.border }]}>
                    <Icon name={w.icon} size={16} tint={colors.warning} />
                    <ThemedText size="small" style={styles.warningText}>
                        {w.text}
                    </ThemedText>
                    <Button label={w.action} compact variant="secondary" onPress={w.onPress} />
                </View>
            ))}

            <View style={styles.row}>
                <BigButton icon="Video" label="Recording started" enabled={buttons.camera && !busy} tone="primary" onPress={startCamera} />
                <BigButton icon="Ship" label="Start moving" enabled={buttons.move && !busy} tone="primary" onPress={startMoving} />
                <BigButton
                    icon={s.state === 'PAUSED' ? 'Play' : 'Pause'}
                    label={s.state === 'PAUSED' ? 'Resume' : 'Pause'}
                    enabled={(buttons.pause || buttons.resume) && !busy}
                    tone={s.state === 'PAUSED' ? 'primary' : 'normal'}
                    onPress={pauseResume}
                />
                <BigButton icon="Stop" label="Stop" enabled={buttons.stop && !busy} tone="danger" onPress={() => setConfirm('stop')} />
            </View>

            <View style={styles.footer}>
                {buttons.marker ? (
                    <Button
                        label="Add marker"
                        icon="PinAdd"
                        iconLeading
                        variant="secondary"
                        compact
                        onPress={addMarker}
                        disabled={busy}
                        style={styles.flex}
                    />
                ) : (
                    <Button label="Saved surveys" icon="Folder" iconLeading variant="secondary" compact onPress={onSaved} style={styles.flex} />
                )}
                {buttons.discard && (
                    <Button label="Discard" variant="ghost" compact onPress={() => setConfirm('discard')} style={styles.gap} />
                )}
            </View>

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
                            onSaved();
                        },
                    },
                    { label: 'Done', onPress: closeSaved },
                ]}>
                <TextField
                    value={saved?.name ?? ''}
                    onChangeText={name => setSaved(v => (v ? { ...v, name } : v))}
                    placeholder="Name"
                    returnKeyType="done"
                    style={styles.field}
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
        </Panel>
    );
};

/** The bottom-bar line for a running survey while its panel is hidden. */
export const surveySummary = (s: LiveSurvey) => {
    const moving = s.state === 'MOVING' || s.state === 'PAUSED';
    const time = formatClock(moving ? s.surveyElapsedMs : s.cameraElapsedMs);
    const what = s.state === 'MOVING' ? 'Survey' : s.state === 'PAUSED' ? 'Survey paused' : 'Camera recording';
    return `${what} · ${time}${moving ? ` · ${s.pointCount} points` : ''}`;
};

const styles = StyleSheet.create({
    flex: {
        flex: 1,
    },
    head: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    dot: {
        width: 10,
        height: 10,
        borderRadius: 5,
        marginRight: spacing.sm,
    },
    timer: {
        marginHorizontal: spacing.sm,
    },
    line: {
        marginTop: spacing.xs,
    },
    gps: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: spacing.xs,
    },
    gpsText: {
        flex: 1,
        marginLeft: spacing.xs,
    },
    warning: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: spacing.sm,
        paddingTop: spacing.sm,
        borderTopWidth: StyleSheet.hairlineWidth,
    },
    warningText: {
        flex: 1,
        marginHorizontal: spacing.sm,
    },
    row: {
        flexDirection: 'row',
        marginTop: spacing.sm + 2,
        marginHorizontal: -3,
    },
    big: {
        flex: 1,
        minHeight: 76,
        marginHorizontal: 3,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 4,
        paddingVertical: spacing.sm,
        borderWidth: shapes.borderWidth.thin,
        borderRadius: shapes.borderRadius.medium,
    },
    bigLabel: {
        marginTop: 6,
        textAlign: 'center',
    },
    footer: {
        flexDirection: 'row',
        marginTop: spacing.sm,
    },
    gap: {
        marginLeft: spacing.sm,
    },
    chips: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        marginTop: spacing.md,
        marginBottom: spacing.xs,
    },
    field: {
        marginTop: spacing.md,
    },
});
