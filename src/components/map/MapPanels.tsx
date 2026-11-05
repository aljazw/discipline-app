/** The cards that float over the map: navigation banner, info panel, selection and drawing panels. */
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { useTheme } from '../../context/ThemeContext';
import { shapes, spacing } from '../../theme';
import { MapUnits } from '../../types/types';
import IconButton from '../IconButton';
import Icon, { IconName } from '../Icon';
import Button from '../Button';
import { ThemedText } from '../ThemedText';
import { PanelAction } from './mapUi';
import {
    distanceParts,
    formatBearing,
    formatDistance,
    formatDuration,
    normalize,
    speedParts,
} from '../../utils/geo';
import { RecordingState } from '../../utils/mapNative';

export const Panel: React.FC<{ children: React.ReactNode; style?: StyleProp<ViewStyle> }> = ({ children, style }) => {
    const { colors } = useTheme().theme;
    return (
        <View style={[styles.panel, { backgroundColor: colors.card, borderColor: colors.border }, style]}>{children}</View>
    );
};

// ---- Navigation ---------------------------------------------------------------

export interface NavInfo {
    title: string;
    /** To the next point (a mark, or the route's next point). */
    toNext: number;
    bearing: number;
    /** To the end of a route; same as toNext for a mark. */
    remaining: number;
    eta: string | null;
    /** For routes: what to do at the next point. */
    turn?: string;
    /** For routes: meters off the leg's line; positive = right of it. */
    offCourse?: number;
    arrived: boolean;
}

/** Where you're going: distance and bearing, the next turn, and a warning when off course. */
export const NavBanner: React.FC<{ nav: NavInfo; units: MapUnits; onStop: () => void; style?: StyleProp<ViewStyle> }> = ({
    nav,
    units,
    onStop,
    style,
}) => {
    const { colors } = useTheme().theme;
    const big = distanceParts(nav.toNext, units);
    const off = nav.offCourse !== undefined && Math.abs(nav.offCourse) > 50 ? nav.offCourse : null;
    return (
        <Panel style={style}>
            <View style={styles.navTop}>
                <View
                    style={[styles.arrow, { backgroundColor: colors.accentSoft }]}
                    accessibilityLabel={`Bearing ${formatBearing(nav.bearing)}`}>
                    <Icon
                        name={nav.arrived ? 'Check' : 'Navigate'}
                        size={22}
                        tint={colors.accent}
                        style={nav.arrived ? undefined : { transform: [{ rotate: `${normalize(nav.bearing)}deg` }] }}
                    />
                </View>
                <View style={styles.flex}>
                    {nav.arrived ? (
                        <ThemedText size="large" weight="bold">
                            Arrived
                        </ThemedText>
                    ) : (
                        <View style={styles.baseline}>
                            <ThemedText size="xlarge" weight="bold" tabular>
                                {big.value}
                            </ThemedText>
                            <ThemedText size="small" color="muted" style={styles.unit}>
                                {big.unit}
                            </ThemedText>
                            <ThemedText size="small" weight="medium" style={styles.bearing} tabular>
                                {formatBearing(nav.bearing)}
                            </ThemedText>
                        </View>
                    )}
                    <ThemedText size="small" color="muted" numberOfLines={1}>
                        {nav.turn && !nav.arrived ? `${nav.turn} · ` : ''}
                        {nav.title}
                        {!nav.arrived && nav.remaining > nav.toNext + 1 ? ` · ${formatDistance(nav.remaining, units)} left` : ''}
                        {!nav.arrived && nav.eta ? ` · ${nav.eta}` : ''}
                    </ThemedText>
                </View>
                <IconButton icon="Close" accessibilityLabel="Stop navigation" onPress={onStop} />
            </View>
            {off !== null && !nav.arrived && (
                <View style={[styles.offCourse, { backgroundColor: colors.redSoft }]}>
                    <Icon name="Alert" size={14} tint={colors.primaryRed} />
                    <ThemedText size="small" weight="medium" color="primaryRed" style={styles.offText}>
                        {formatDistance(Math.abs(off), units)} {off > 0 ? 'right' : 'left'} of the route · steer{' '}
                        {off > 0 ? 'left' : 'right'}
                    </ThemedText>
                </View>
            )}
        </Panel>
    );
};

// ---- Info panel ---------------------------------------------------------------

export interface Fix {
    pos: [number, number];
    /** m/s; 0 when unknown. */
    speed: number;
    /** GPS course over ground, when moving. */
    course: number | null;
    accuracy: number | null;
}

/** A slim bar along the bottom: the map's tools, and the recording controls while recording. */
export const InfoPanel: React.FC<{
    fix: Fix | null;
    units: MapUnits;
    recording: RecordingState;
    onRecord: () => void;
    onPauseResume: () => void;
    onStopRecording: () => void;
    onRoute: () => void;
    onMeasure: () => void;
    onSaved: () => void;
    style?: StyleProp<ViewStyle>;
}> = ({ fix, units, recording, onRecord, onPauseResume, onStopRecording, onRoute, onMeasure, onSaved, style }) => {
    const { colors } = useTheme().theme;
    const live = recording.status !== 'idle';
    const speed = speedParts(fix?.speed ?? 0, units);
    return (
        <Panel style={[styles.bar, style]}>
            {live && (
                <View style={[styles.recording, { borderBottomColor: colors.border }]}>
                    <View style={[styles.dot, { backgroundColor: recording.status === 'paused' ? colors.muted : colors.primaryRed }]} />
                    <ThemedText size="small" weight="medium" style={styles.flex} tabular numberOfLines={1}>
                        {formatDuration(recording.elapsedMs)} · {formatDistance(recording.distance, units)}
                        {fix ? ` · ${speed.value} ${speed.unit}` : ''}
                    </ThemedText>
                    <Button
                        label={recording.status === 'paused' ? 'Resume' : 'Pause'}
                        variant="secondary"
                        compact
                        onPress={onPauseResume}
                    />
                    <Button label="Stop" variant="danger" compact onPress={onStopRecording} style={styles.stopButton} />
                </View>
            )}
            <View style={styles.barActions}>
                {!live && <PanelAction icon="Record" label="Record" tint={colors.primaryRed} onPress={onRecord} />}
                <PanelAction icon="Route" label="Plan route" onPress={onRoute} />
                <PanelAction icon="Ruler" label="Measure" onPress={onMeasure} />
                <PanelAction icon="Pin" label="Saved" onPress={onSaved} />
            </View>
        </Panel>
    );
};

// ---- Selection ----------------------------------------------------------------

export interface SheetAction {
    icon: IconName;
    label: string;
    onPress: () => void;
    tint?: string;
}

/** What's selected on the map (a dropped pin, a place, a route or a track) and what you can do with it. */
export const SelectionPanel: React.FC<{
    title: string;
    lines: string[];
    actions: SheetAction[];
    onClose: () => void;
    style?: StyleProp<ViewStyle>;
}> = ({ title, lines, actions, onClose, style }) => (
    <Panel style={style}>
        <View style={styles.selTop}>
            <View style={styles.flex}>
                <ThemedText size="large" weight="bold" numberOfLines={1}>
                    {title}
                </ThemedText>
                {lines.map(line => (
                    <ThemedText key={line} size="small" color="muted" tabular numberOfLines={2} style={styles.line}>
                        {line}
                    </ThemedText>
                ))}
            </View>
            <IconButton icon="Close" accessibilityLabel="Close" onPress={onClose} />
        </View>
        <View style={styles.actionsFlat}>
            {actions.map(a => (
                <PanelAction key={a.label} icon={a.icon} label={a.label} onPress={a.onPress} tint={a.tint} />
            ))}
        </View>
    </Panel>
);

// ---- Drawing (plan a route / measure) ------------------------------------------

export const DrawPanel: React.FC<{
    title: string;
    detail: string;
    canUndo: boolean;
    doneLabel: string;
    canDone: boolean;
    onUndo: () => void;
    onCancel: () => void;
    onDone: () => void;
    style?: StyleProp<ViewStyle>;
}> = ({ title, detail, canUndo, doneLabel, canDone, onUndo, onCancel, onDone, style }) => (
    <Panel style={style}>
        <View style={styles.selTop}>
            <View style={styles.flex}>
                <ThemedText size="large" weight="bold">
                    {title}
                </ThemedText>
                <ThemedText size="small" color="muted" tabular style={styles.line}>
                    {detail}
                </ThemedText>
            </View>
            <IconButton icon="Undo" accessibilityLabel="Undo last point" onPress={onUndo} tint={canUndo ? undefined : 'transparent'} />
        </View>
        <View style={styles.drawButtons}>
            <Button label="Cancel" variant="secondary" compact onPress={onCancel} style={styles.flex} />
            <Button label={doneLabel} compact disabled={!canDone} onPress={onDone} style={[styles.flex, styles.gap]} />
        </View>
    </Panel>
);

const styles = StyleSheet.create({
    panel: {
        borderRadius: shapes.borderRadius.large,
        borderWidth: shapes.borderWidth.thin,
        padding: spacing.md,
        elevation: shapes.elevation.high,
    },
    flex: {
        flex: 1,
    },
    navTop: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    arrow: {
        width: 44,
        height: 44,
        borderRadius: 22,
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: spacing.sm + 2,
    },
    baseline: {
        flexDirection: 'row',
        alignItems: 'baseline',
    },
    unit: {
        marginLeft: 4,
    },
    bearing: {
        marginLeft: spacing.sm,
    },
    offCourse: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: spacing.sm,
        paddingHorizontal: spacing.sm,
        paddingVertical: spacing.xs + 2,
        borderRadius: shapes.borderRadius.medium,
    },
    offText: {
        marginLeft: spacing.xs + 2,
        flex: 1,
    },
    stats: {
        flexDirection: 'row',
    },
    coords: {
        marginTop: spacing.xs + 2,
    },
    barActions: {
        flexDirection: 'row',
    },
    bar: {
        paddingVertical: spacing.xs,
        paddingHorizontal: spacing.sm,
    },
    recording: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: spacing.xs,
        paddingBottom: spacing.xs + 2,
        marginBottom: spacing.xs,
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    dot: {
        width: 8,
        height: 8,
        borderRadius: 4,
        marginRight: spacing.sm - 2,
    },
    stopButton: {
        marginLeft: spacing.sm,
    },
    actionsFlat: {
        flexDirection: 'row',
        marginTop: spacing.sm,
        marginHorizontal: -spacing.sm,
    },
    selTop: {
        flexDirection: 'row',
        alignItems: 'flex-start',
    },
    line: {
        marginTop: 2,
    },
    drawButtons: {
        flexDirection: 'row',
        marginTop: spacing.md,
    },
    gap: {
        marginLeft: spacing.sm,
    },
});
