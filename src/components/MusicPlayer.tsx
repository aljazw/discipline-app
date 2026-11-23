import { APP_NAME } from '../constants/brand';
import { useState } from 'react';
import { LayoutChangeEvent, Pressable, StyleSheet, View } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { shapes, spacing } from '../theme';
import { ThemedText } from './ThemedText';
import Icon from './Icon';
import IconTile from './IconTile';
import IconButton from './IconButton';
import Card from './Card';
import Button from './Button';
import ModalPanel from './ModalPanel';
import { haptics } from '../utils/haptics';
import { MusicState, formatTime, music, nextRepeat, useMusicPosition, useSleepLeft } from '../utils/music';

/** Round play/pause button; the one control that stands out. */
const PlayButton: React.FC<{ state: MusicState; size: number }> = ({ state, size }) => {
    const { colors } = useTheme().theme;
    return (
        <Pressable
            onPress={() => {
                haptics.tap();
                music.toggle();
            }}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel={state.playWhenReady ? 'Pause' : 'Play'}
            style={({ pressed }) => [
                styles.play,
                { width: size, height: size, backgroundColor: colors.accent },
                pressed && styles.pressed,
            ]}>
            <Icon
                name={state.playWhenReady ? 'Pause' : 'Play'}
                size={Math.round(size * 0.42)}
                tint={colors.onAccent}
                strokeWidth={2.2}
            />
        </Pressable>
    );
};

/** Tap or drag along it to jump within the song. */
const SeekBar: React.FC<{ state: MusicState }> = ({ state }) => {
    const { colors } = useTheme().theme;
    const position = useMusicPosition(state);
    const [width, setWidth] = useState(1);
    const [dragging, setDragging] = useState<number | null>(null);
    const duration = state.durationMs;
    const fractionAt = (x: number) => Math.min(1, Math.max(0, x / width));
    const fraction = dragging ?? (duration ? position / duration : 0);

    return (
        <View>
            <View
                style={styles.seekArea}
                onLayout={(e: LayoutChangeEvent) => setWidth(Math.max(1, e.nativeEvent.layout.width))}
                onStartShouldSetResponder={() => duration > 0}
                onMoveShouldSetResponder={() => duration > 0}
                onResponderGrant={e => setDragging(fractionAt(e.nativeEvent.locationX))}
                onResponderMove={e => setDragging(fractionAt(e.nativeEvent.locationX))}
                onResponderRelease={e => {
                    music.seekTo(fractionAt(e.nativeEvent.locationX) * duration);
                    setDragging(null);
                }}
                onResponderTerminate={() => setDragging(null)}
                accessibilityRole="adjustable"
                accessibilityLabel="Song position"
                accessibilityValue={{ text: `${formatTime(position)} of ${formatTime(duration)}` }}
                accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
                onAccessibilityAction={e =>
                    music.seekTo(position + (e.nativeEvent.actionName === 'increment' ? 10000 : -10000))
                }>
                <View style={[styles.track, { backgroundColor: colors.elevated }]}>
                    <View style={[styles.fill, { width: `${fraction * 100}%`, backgroundColor: colors.accent }]} />
                </View>
                <View
                    pointerEvents="none"
                    style={[
                        styles.thumb,
                        { left: fraction * width - THUMB / 2, backgroundColor: colors.accent },
                        dragging !== null && styles.thumbActive,
                    ]}
                />
            </View>
            <View style={styles.times}>
                <ThemedText size="tiny" color="muted" tabular>
                    {formatTime(dragging !== null ? dragging * duration : position)}
                </ThemedText>
                <ThemedText size="tiny" color="muted" tabular>
                    {formatTime(duration)}
                </ThemedText>
            </View>
        </View>
    );
};

export const SLEEP_MINUTES = [15, 30, 45, 60, 90];

export const minutesLabel = (m: number) => (m < 60 ? `${m} minutes` : m === 60 ? '1 hour' : `${m / 60} hours`);

/** Stops the music after a while or at the end of this song, fading out first. Works with the app closed. */
const SleepTimer: React.FC<{ state: MusicState }> = ({ state }) => {
    const { colors } = useTheme().theme;
    const [open, setOpen] = useState(false);
    const left = useSleepLeft(state);
    const active = left !== null || state.sleepEndOfSong;
    const status = state.sleepEndOfSong
        ? 'Stops after this song'
        : left !== null
        ? `Stops in ${formatTime(left)}`
        : 'Sleep timer';

    const pick = (minutes: number, endOfSong = false) => {
        haptics.tap();
        setOpen(false);
        music.sleepTimer(minutes, endOfSong);
    };

    const option = (label: string, onPress: () => void, selected = false) => (
        <Pressable
            key={label}
            onPress={onPress}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            style={({ pressed }) => [styles.option, pressed && { backgroundColor: colors.elevated }]}>
            <ThemedText weight="medium" color={selected ? 'accent' : 'text'} style={styles.optionText}>
                {label}
            </ThemedText>
            {selected && <Icon name="Check" size={18} tint={colors.accent} />}
        </Pressable>
    );

    return (
        <>
            <View style={styles.sleep}>
                <Pressable
                    onPress={() => setOpen(true)}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel={active ? `${status}. Change sleep timer` : 'Sleep timer'}
                    style={({ pressed }) => [styles.sleepButton, pressed && styles.pressed]}>
                    <Icon name="Moon" size={15} tint={active ? colors.accent : colors.muted} />
                    <ThemedText size="small" weight="medium" color={active ? 'accent' : 'muted'} tabular>
                        {status}
                    </ThemedText>
                </Pressable>
            </View>
            <ModalPanel visible={open} onClose={() => setOpen(false)}>
                <ThemedText size="large" weight="bold">
                    Sleep timer
                </ThemedText>
                <ThemedText size="small" color="muted" style={styles.sleepHint}>
                    The music fades out and stops, even with {APP_NAME} closed.
                </ThemedText>
                <View style={styles.options}>
                    {SLEEP_MINUTES.map(m => option(minutesLabel(m), () => pick(m)))}
                    {option('End of this song', () => pick(0, true), state.sleepEndOfSong)}
                </View>
                <View style={styles.sleepActions}>
                    {active && (
                        <View style={styles.sleepAction}>
                            <Button label="Turn off" variant="secondary" onPress={() => pick(0)} />
                        </View>
                    )}
                    <View style={styles.sleepAction}>
                        <Button label="Close" variant={active ? 'ghost' : 'secondary'} onPress={() => setOpen(false)} />
                    </View>
                </View>
            </ModalPanel>
        </>
    );
};

/** The full player: song, position and every control. */
export const NowPlaying: React.FC<{ state: MusicState }> = ({ state }) => {
    const { colors } = useTheme().theme;
    const on = (active: boolean) => (active ? colors.accent : colors.muted);

    return (
        <Card>
            <View style={styles.song}>
                <IconTile icon="Music" tone="accent" size={48} />
                <View style={styles.songText}>
                    <ThemedText weight="strong" numberOfLines={1}>
                        {state.title || 'Unknown song'}
                    </ThemedText>
                    <ThemedText size="small" color="muted" numberOfLines={1}>
                        {state.artist || 'Unknown artist'}
                    </ThemedText>
                </View>
            </View>
            <SeekBar state={state} />
            <View style={styles.controls}>
                <IconButton
                    icon="Shuffle"
                    tint={on(state.shuffle)}
                    accessibilityLabel={state.shuffle ? 'Shuffle on' : 'Shuffle off'}
                    onPress={() => music.setShuffle(!state.shuffle)}
                />
                <IconButton
                    icon="Previous"
                    tint={colors.text}
                    size={44}
                    accessibilityLabel="Previous song"
                    onPress={music.previous}
                />
                <PlayButton state={state} size={60} />
                <IconButton
                    icon="Skip"
                    tint={colors.text}
                    size={44}
                    accessibilityLabel="Next song"
                    onPress={music.next}
                />
                <IconButton
                    icon={state.repeat === 'one' ? 'RepeatOne' : 'Repeat'}
                    tint={on(state.repeat !== 'off')}
                    accessibilityLabel={`Repeat ${state.repeat === 'one' ? 'this song' : state.repeat}`}
                    onPress={() => music.setRepeat(nextRepeat(state.repeat))}
                />
            </View>
            <SleepTimer state={state} />
        </Card>
    );
};

/** Slim bar above the tabs while music is loaded: song, play/pause, next. Tap to open the player. */
export const MiniPlayer: React.FC<{ state: MusicState; onOpen: () => void }> = ({ state, onOpen }) => {
    const { colors } = useTheme().theme;
    const position = useMusicPosition(state);
    const fraction = state.durationMs ? position / state.durationMs : 0;

    return (
        <Pressable
            onPress={onOpen}
            accessibilityRole="button"
            accessibilityLabel={`Now playing: ${state.title}. Open music`}
            style={({ pressed }) => [
                styles.mini,
                { backgroundColor: pressed ? colors.elevated : colors.card, borderTopColor: colors.border },
            ]}>
            <View style={[styles.miniProgress, { width: `${fraction * 100}%`, backgroundColor: colors.accent }]} />
            <IconTile icon="Music" tone="accent" size={34} />
            <View style={styles.songText}>
                <ThemedText size="small" weight="strong" numberOfLines={1}>
                    {state.title || 'Unknown song'}
                </ThemedText>
                {!!state.artist && (
                    <ThemedText size="tiny" color="muted" numberOfLines={1}>
                        {state.artist}
                    </ThemedText>
                )}
            </View>
            <PlayButton state={state} size={36} />
            <IconButton icon="Skip" tint={colors.text} size={36} accessibilityLabel="Next song" onPress={music.next} />
        </Pressable>
    );
};

const THUMB = 14;

const styles = StyleSheet.create({
    sleep: {
        alignItems: 'center',
        marginTop: spacing.sm,
    },
    sleepButton: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.xs + 2,
        paddingVertical: spacing.xs,
        paddingHorizontal: spacing.sm,
    },
    sleepHint: {
        marginTop: spacing.xs,
    },
    options: {
        marginVertical: spacing.md,
        marginHorizontal: -spacing.sm,
    },
    option: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: spacing.sm + 2,
        paddingHorizontal: spacing.sm,
        borderRadius: shapes.borderRadius.medium,
    },
    optionText: {
        flex: 1,
    },
    sleepActions: {
        flexDirection: 'row',
        gap: spacing.sm,
    },
    sleepAction: {
        flex: 1,
    },
    song: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: spacing.md,
    },
    songText: {
        flex: 1,
        marginLeft: spacing.sm + 2,
    },
    seekArea: {
        height: 28,
        justifyContent: 'center',
    },
    track: {
        height: 4,
        borderRadius: 2,
        overflow: 'hidden',
    },
    fill: {
        height: 4,
    },
    thumb: {
        position: 'absolute',
        width: THUMB,
        height: THUMB,
        borderRadius: THUMB / 2,
    },
    thumbActive: {
        transform: [{ scale: 1.3 }],
    },
    times: {
        flexDirection: 'row',
        justifyContent: 'space-between',
    },
    controls: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginTop: spacing.sm,
    },
    play: {
        borderRadius: shapes.borderRadius.pill,
        alignItems: 'center',
        justifyContent: 'center',
    },
    pressed: {
        opacity: 0.85,
        transform: [{ scale: 0.96 }],
    },
    mini: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.sm - 2,
        borderTopWidth: StyleSheet.hairlineWidth,
        gap: spacing.xs + 2,
    },
    miniProgress: {
        position: 'absolute',
        top: 0,
        left: 0,
        height: 2,
    },
});
