import { APP_NAME } from '../constants/brand';
import React, { useCallback, useMemo, useState } from 'react';
import { FlatList, Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import BackButton from '../components/BackButton';
import BaseScreen from '../components/BaseScreen';
import Button from '../components/Button';
import EmptyState from '../components/EmptyState';
import Icon from '../components/Icon';
import IconTile from '../components/IconTile';
import ModalPanel from '../components/ModalPanel';
import { NowPlaying, SLEEP_MINUTES, minutesLabel } from '../components/MusicPlayer';
import SearchBar from '../components/SearchBar';
import { ThemedText } from '../components/ThemedText';
import { useTheme } from '../context/ThemeContext';
import { gutter, shapes, spacing } from '../theme';
import {
    LibraryAccess,
    Track,
    checkLibraryAccess,
    ensureVideoAccess,
    folderName,
    formatTime,
    getLibrary,
    inFolder,
    listFolders,
    music,
    requestLibraryAccess,
    useMusic,
} from '../utils/music';
import { logger } from '../utils/logger';
import { getMusicFolder, setMusicFolder } from '../storage';

const ROW_HEIGHT = 60;

const count = (n: number) => `${n} ${n === 1 ? 'song' : 'songs'}`;

/** Where to play from: every song, or one folder (subfolders included). */
const FolderPicker: React.FC<{
    visible: boolean;
    library: Track[];
    folder: string;
    onPick: (folder: string) => void;
    onClose: () => void;
}> = ({ visible, library, folder, onPick, onClose }) => {
    const { colors } = useTheme().theme;
    const folders = useMemo(() => (visible ? listFolders(library) : []), [visible, library]);
    const all = useMemo(() => library.filter(t => t.music).length, [library]);

    const row = (path: string, title: string, detail: string) => {
        const selected = path === folder;
        return (
            <Pressable
                key={path || 'all'}
                onPress={() => onPick(path)}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                style={({ pressed }) => [styles.folder, pressed && { backgroundColor: colors.elevated }]}>
                <IconTile icon={path ? 'Folder' : 'Music'} size={32} tone={selected ? 'accent' : 'neutral'} />
                <View style={styles.rowText}>
                    <ThemedText weight="medium" numberOfLines={1} color={selected ? 'accent' : 'text'}>
                        {title}
                    </ThemedText>
                    <ThemedText size="small" color="muted" numberOfLines={1}>
                        {detail}
                    </ThemedText>
                </View>
                {selected && <Icon name="Check" size={18} tint={colors.accent} />}
            </Pressable>
        );
    };

    return (
        <ModalPanel visible={visible} onClose={onClose}>
            <ThemedText size="large" weight="bold">
                Play from
            </ThemedText>
            <ThemedText size="small" color="muted" style={styles.pickerHint}>
                A folder plays every audio file in it, subfolders included.
            </ThemedText>
            <ScrollView style={styles.folders}>
                {row('', 'All songs', count(all))}
                {folders.map(f => row(f.path, folderName(f.path), `${f.path.slice(0, -1)} · ${count(f.count)}`))}
            </ScrollView>
            <Button label="Close" variant="secondary" onPress={onClose} />
        </ModalPanel>
    );
};

/** Plays the list on repeat and stops by itself after the chosen time. */
const GoodNight: React.FC<{
    visible: boolean;
    songs: Track[];
    source: string;
    onClose: () => void;
}> = ({ visible, songs, source, onClose }) => {
    const { colors } = useTheme().theme;
    const [minutes, setMinutes] = useState(30);

    const start = async () => {
        onClose();
        await music.play(songs, 0, false);
        await music.setRepeat('all');
        await music.sleepTimer(minutes);
    };

    return (
        <ModalPanel visible={visible} onClose={onClose}>
            <ThemedText size="large" weight="bold">
                Good night
            </ThemedText>
            <ThemedText size="small" color="muted" style={styles.pickerHint}>
                Plays {source} on repeat, then fades out and stops by itself, even with the screen off.
            </ThemedText>
            <View style={styles.folders}>
                {SLEEP_MINUTES.map(m => {
                    const selected = m === minutes;
                    return (
                        <Pressable
                            key={m}
                            onPress={() => setMinutes(m)}
                            accessibilityRole="radio"
                            accessibilityState={{ selected }}
                            style={({ pressed }) => [styles.folder, pressed && { backgroundColor: colors.elevated }]}>
                            <ThemedText weight="medium" color={selected ? 'accent' : 'text'} style={styles.rowText}>
                                {minutesLabel(m)}
                            </ThemedText>
                            {selected && <Icon name="Check" size={18} tint={colors.accent} />}
                        </Pressable>
                    );
                })}
            </View>
            <Button label="Start" onPress={start} disabled={songs.length === 0} />
            <Button label="Cancel" variant="ghost" onPress={onClose} />
        </ModalPanel>
    );
};

const matches = (track: Track, query: string) =>
    track.title.toLowerCase().includes(query) ||
    track.artist.toLowerCase().includes(query) ||
    track.album.toLowerCase().includes(query);

/** The songs on the phone and the player. Music keeps going after leaving this screen or the app. */
const MusicScreen: React.FC = () => {
    const { colors } = useTheme().theme;
    const state = useMusic();
    const [access, setAccess] = useState<LibraryAccess | null>(null);
    const [library, setLibrary] = useState<Track[]>([]);
    const [loaded, setLoaded] = useState(false);
    const [query, setQuery] = useState('');
    const [folder, setFolder] = useState('');
    const [picking, setPicking] = useState(false);
    const [goodNight, setGoodNight] = useState(false);

    const load = useCallback(async () => {
        try {
            setFolder(await getMusicFolder());
            const now = await checkLibraryAccess();
            setAccess(prev => (prev === 'blocked' && now !== 'granted' ? prev : now));
            if (now === 'granted') {
                await ensureVideoAccess().catch(() => {});
                setLibrary(await getLibrary());
            }
        } catch (error) {
            logger.warn('Could not load music', error);
        } finally {
            setLoaded(true);
        }
    }, []);

    // Also after coming back from system settings with access just granted.
    useFocusEffect(
        useCallback(() => {
            load();
        }, [load]),
    );

    const allow = async () => {
        if (access === 'blocked') {
            Linking.openSettings();
            return;
        }
        const result = await requestLibraryAccess();
        setAccess(result);
        if (result === 'granted') {
            load();
        }
    };

    const pickFolder = (next: string) => {
        setPicking(false);
        setFolder(next);
        setMusicFolder(next).catch(error => logger.warn('Could not save music folder', error));
    };

    const q = query.trim().toLowerCase();
    const songs = useMemo(() => library.filter(t => inFolder(t, folder)), [library, folder]);
    const shown = useMemo(() => (q ? songs.filter(t => matches(t, q)) : songs), [songs, q]);

    const renderItem = useCallback(
        ({ item, index }: { item: Track; index: number }) => {
            const current = item.id === state.trackId && state.count > 0;
            return (
                <Pressable
                    onPress={() => music.play(shown, index)}
                    accessibilityRole="button"
                    accessibilityLabel={`${item.title}${item.artist ? `, ${item.artist}` : ''}`}
                    style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.elevated }]}>
                    <IconTile
                        icon={current && state.playWhenReady ? 'Sound' : 'Music'}
                        tone={current ? 'accent' : 'neutral'}
                    />
                    <View style={styles.rowText}>
                        <ThemedText weight="medium" numberOfLines={1} color={current ? 'accent' : 'text'}>
                            {item.title}
                        </ThemedText>
                        <ThemedText size="small" color="muted" numberOfLines={1}>
                            {item.artist || 'Unknown artist'}
                        </ThemedText>
                    </View>
                    <ThemedText size="small" color="muted" tabular>
                        {formatTime(item.durationMs)}
                    </ThemedText>
                </Pressable>
            );
        },
        [shown, state.trackId, state.count, state.playWhenReady, colors.elevated],
    );

    const header = (
        <View>
            {state.count > 0 && (
                <View style={styles.player}>
                    <NowPlaying state={state} />
                </View>
            )}
            <View style={styles.search}>
                <SearchBar
                    placeholder="Search songs or artists"
                    keyboardType="default"
                    onSearch={setQuery}
                    value={query}
                />
            </View>
            <View style={styles.actions}>
                <Pressable
                    onPress={() => setPicking(true)}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel={`Playing from ${folder ? folderName(folder) : 'all songs'}. Change folder`}
                    style={({ pressed }) => [styles.source, pressed && styles.pressed]}>
                    <Icon name="Folder" size={16} tint={colors.muted} />
                    <ThemedText size="small" color="muted" numberOfLines={1} style={styles.sourceText}>
                        {folder ? folderName(folder) : 'All songs'} ·{' '}
                        {q ? `${shown.length} of ${count(songs.length)}` : count(songs.length)}
                    </ThemedText>
                    <Icon name="Down" size={14} tint={colors.muted} />
                </Pressable>
                <Button
                    label="Good night"
                    icon="Moon"
                    iconLeading
                    variant="ghost"
                    compact
                    disabled={shown.length === 0}
                    onPress={() => setGoodNight(true)}
                />
                <Button
                    label="Shuffle"
                    icon="Shuffle"
                    iconLeading
                    variant="ghost"
                    compact
                    disabled={shown.length === 0}
                    onPress={() => music.play(shown, Math.floor(Math.random() * shown.length), true)}
                />
            </View>
        </View>
    );

    const blocked = loaded && access !== 'granted';
    const empty = loaded && access === 'granted' && library.length === 0;

    return (
        <BaseScreen
            title="Music"
            subtitle="Keeps playing in the background"
            headerLeft={<BackButton />}
            isLoading={!loaded}>
            {blocked ? (
                <View style={styles.pad}>
                    <EmptyState
                        icon="Music"
                        title="Play your music"
                        text={`${APP_NAME} plays the songs saved on this phone, and keeps playing while you train, plan or use other apps.`}>
                        <Button
                            label={access === 'blocked' ? 'Allow in settings' : 'Allow access to music'}
                            onPress={allow}
                        />
                    </EmptyState>
                </View>
            ) : empty ? (
                <View style={styles.pad}>
                    {state.count > 0 && <NowPlaying state={state} />}
                    <EmptyState
                        icon="Music"
                        title="No songs found"
                        text="Copy music files to this phone (for example into the Music folder) and they'll show up here."
                    />
                </View>
            ) : (
                <FlatList
                    data={shown}
                    keyExtractor={t => t.id}
                    renderItem={renderItem}
                    ListHeaderComponent={header}
                    getItemLayout={(_, index) => ({ length: ROW_HEIGHT, offset: ROW_HEIGHT * index, index })}
                    keyboardShouldPersistTaps="handled"
                    keyboardDismissMode="on-drag"
                    initialNumToRender={16}
                    windowSize={9}
                    contentContainerStyle={styles.list}
                    ListEmptyComponent={
                        <ThemedText color="muted" align="center" style={styles.none}>
                            {q
                                ? `No songs match “${query.trim()}”`
                                : folder
                                ? 'No songs in this folder'
                                : 'No songs found. Pick a folder above.'}
                        </ThemedText>
                    }
                />
            )}
            <GoodNight
                visible={goodNight}
                songs={shown}
                source={folder ? `“${folderName(folder)}”` : 'all your songs'}
                onClose={() => setGoodNight(false)}
            />
            <FolderPicker
                visible={picking}
                library={library}
                folder={folder}
                onPick={pickFolder}
                onClose={() => setPicking(false)}
            />
        </BaseScreen>
    );
};

const styles = StyleSheet.create({
    pad: {
        paddingTop: spacing.xs,
    },
    player: {
        marginTop: spacing.xs,
    },
    search: {
        marginHorizontal: gutter,
        marginTop: spacing.md,
    },
    actions: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginHorizontal: gutter + 2,
        marginTop: spacing.sm,
        marginBottom: spacing.xs,
    },
    list: {
        paddingBottom: spacing.xl,
    },
    row: {
        height: ROW_HEIGHT,
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: gutter,
    },
    rowText: {
        flex: 1,
        marginHorizontal: spacing.sm + 2,
    },
    none: {
        marginTop: spacing.xl,
    },
    source: {
        flexDirection: 'row',
        alignItems: 'center',
        flexShrink: 1,
        gap: spacing.xs,
        paddingVertical: spacing.xs,
    },
    sourceText: {
        flexShrink: 1,
    },
    pressed: {
        opacity: 0.6,
    },
    pickerHint: {
        marginTop: spacing.xs,
    },
    folders: {
        maxHeight: 380,
        marginVertical: spacing.md,
        marginHorizontal: -spacing.sm,
    },
    folder: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: spacing.sm,
        paddingHorizontal: spacing.sm,
        borderRadius: shapes.borderRadius.medium,
    },
});

export default MusicScreen;
