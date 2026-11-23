import { useEffect, useState, useSyncExternalStore } from 'react';
import { NativeEventEmitter, NativeModules, PermissionsAndroid, Platform } from 'react-native';
import { logger } from './logger';

/**
 * Bridge to the native MusicService, which keeps playing with the app in the
 * background or closed. Songs and state cross the bridge as JSON.
 */
const { Music } = NativeModules;

export interface Track {
    id: string;
    uri: string;
    title: string;
    artist: string;
    album: string;
    albumId: number;
    durationMs: number;
    /** Folder on the phone, like "Music/Gym/"; "" when unknown. */
    folder: string;
    /** Android counts it as music (not a ringtone, notification sound or voice note). */
    music: boolean;
}

export type RepeatMode = 'off' | 'all' | 'one';

export interface MusicState {
    trackId: string;
    title: string;
    artist: string;
    playing: boolean;
    /** Playing or about to be (buffering): the button shows pause. */
    playWhenReady: boolean;
    positionMs: number;
    durationMs: number;
    index: number;
    /** Songs in the queue; 0 = nothing loaded, so no player is shown. */
    count: number;
    shuffle: boolean;
    repeat: RepeatMode;
    /** When the sleep timer stops the music (epoch millis); 0 = no timed stop. */
    sleepAt: number;
    /** The sleep timer stops the music when this song ends. */
    sleepEndOfSong: boolean;
    /** When positionMs was read (epoch millis). */
    at: number;
}

const IDLE: MusicState = {
    trackId: '',
    title: '',
    artist: '',
    playing: false,
    playWhenReady: false,
    positionMs: 0,
    durationMs: 0,
    index: 0,
    count: 0,
    shuffle: false,
    repeat: 'off',
    sleepAt: 0,
    sleepEndOfSong: false,
    at: 0,
};

const REPEATS: RepeatMode[] = ['off', 'all', 'one'];
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const str = (v: unknown) => (typeof v === 'string' ? v : '');

export const parseMusicState = (raw: unknown): MusicState => {
    if (typeof raw !== 'string') {
        return IDLE;
    }
    try {
        const v = JSON.parse(raw);
        return {
            trackId: str(v.trackId),
            title: str(v.title),
            artist: str(v.artist),
            playing: v.playing === true,
            playWhenReady: v.playWhenReady === true,
            positionMs: num(v.positionMs),
            durationMs: num(v.durationMs),
            index: num(v.index),
            count: num(v.count),
            shuffle: v.shuffle === true,
            repeat: REPEATS.includes(v.repeat) ? v.repeat : 'off',
            sleepAt: num(v.sleepAt),
            sleepEndOfSong: v.sleepEndOfSong === true,
            at: num(v.at) || Date.now(),
        };
    } catch {
        return IDLE;
    }
};

export const parseLibrary = (raw: unknown): Track[] => {
    if (typeof raw !== 'string') {
        return [];
    }
    try {
        const list = JSON.parse(raw);
        return Array.isArray(list)
            ? list
                  .filter(t => t && typeof t.id === 'string' && typeof t.uri === 'string')
                  .map(t => ({
                      id: t.id,
                      uri: t.uri,
                      title: str(t.title) || 'Unknown song',
                      artist: str(t.artist),
                      album: str(t.album),
                      albumId: typeof t.albumId === 'number' ? t.albumId : -1,
                      durationMs: num(t.durationMs),
                      folder: str(t.folder),
                      music: t.music !== false,
                  }))
            : [];
    } catch {
        return [];
    }
};

// ---- Shared state -----------------------------------------------------------

let current: MusicState = IDLE;
const listeners = new Set<() => void>();
let started = false;

const set = (next: MusicState) => {
    current = next;
    listeners.forEach(l => l());
};

/** Runs a player call and takes the state it answers with. Failures are logged, never thrown. */
const call = async (run: () => Promise<unknown>) => {
    if (!Music) {
        return;
    }
    try {
        set(parseMusicState(await run()));
    } catch (error) {
        logger.warn('Music call failed', error);
    }
};

const start = () => {
    if (started || !Music) {
        return;
    }
    started = true;
    new NativeEventEmitter(Music).addListener('MusicState', raw => set(parseMusicState(raw)));
    call(() => Music.getState());
};

const subscribe = (listener: () => void) => {
    start();
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
};

/** The player's state, kept current from native events. */
export const useMusic = (): MusicState => useSyncExternalStore(subscribe, () => current);

/** The playing position, moved along between native updates while playing. */
export const useMusicPosition = (state: MusicState): number => {
    const [now, setNow] = useState(Date.now);
    useEffect(() => {
        if (!state.playing) {
            return;
        }
        const timer = setInterval(() => setNow(Date.now()), 500);
        return () => clearInterval(timer);
    }, [state.playing]);
    const position = state.playing ? state.positionMs + Math.max(0, now - state.at) : state.positionMs;
    return state.durationMs ? Math.min(position, state.durationMs) : position;
};

// ---- Controls ---------------------------------------------------------------

export const music = {
    available: !!Music,
    play: (queue: Track[], index: number, shuffle = false) =>
        call(() => Music.play(JSON.stringify(queue), index, shuffle)),
    toggle: () => call(() => Music.toggle()),
    next: () => call(() => Music.next()),
    previous: () => call(() => Music.previous()),
    seekTo: (ms: number) => call(() => Music.seekTo(Math.max(0, Math.round(ms)))),
    setShuffle: (enabled: boolean) => call(() => Music.setShuffle(enabled)),
    setRepeat: (mode: RepeatMode) => call(() => Music.setRepeat(mode)),
    stop: () => call(() => Music.stop()),
    /** Stop after `minutes`, or at the end of this song; `sleepTimer(0)` turns it off. */
    sleepTimer: (minutes: number, endOfSong = false) => call(() => Music.setSleepTimer(minutes, endOfSong)),
};

/** Time left on the sleep timer, ticking down each second; null when no timed stop is set. */
export const useSleepLeft = (state: MusicState): number | null => {
    const [now, setNow] = useState(Date.now);
    useEffect(() => {
        if (!state.sleepAt) {
            return;
        }
        setNow(Date.now());
        const timer = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(timer);
    }, [state.sleepAt]);
    return state.sleepAt ? Math.max(0, state.sleepAt - now) : null;
};

export const nextRepeat = (mode: RepeatMode): RepeatMode => REPEATS[(REPEATS.indexOf(mode) + 1) % REPEATS.length];

// ---- Library ----------------------------------------------------------------

const NEW_MEDIA_PERMISSIONS = Platform.OS === 'android' && Number(Platform.Version) >= 33;

/** Songs, and from Android 13 the sound of mp4 videos (a separate permission). */
const LIBRARY_PERMISSIONS = NEW_MEDIA_PERMISSIONS
    ? [PermissionsAndroid.PERMISSIONS.READ_MEDIA_AUDIO, PermissionsAndroid.PERMISSIONS.READ_MEDIA_VIDEO]
    : [PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE];

export type LibraryAccess = 'granted' | 'ask' | 'blocked';

/** Songs decide: with only video refused the library still opens, just without the mp4 files. */
export const checkLibraryAccess = async (): Promise<LibraryAccess> =>
    (await PermissionsAndroid.check(LIBRARY_PERMISSIONS[0])) ? 'granted' : 'ask';

export const requestLibraryAccess = async (): Promise<LibraryAccess> => {
    const results = await PermissionsAndroid.requestMultiple(LIBRARY_PERMISSIONS);
    const values = Object.values(results);
    // Songs matter most: only refusing audio keeps the library closed.
    const audio = results[LIBRARY_PERMISSIONS[0]];
    if (audio === PermissionsAndroid.RESULTS.GRANTED) {
        return 'granted';
    }
    return values.includes(PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) ? 'blocked' : 'ask';
};

let askedVideo = false;

/** Android 13+: asks once per launch for the video permission, so mp4 files show up for people who had only allowed songs. */
export const ensureVideoAccess = async (): Promise<void> => {
    if (!NEW_MEDIA_PERMISSIONS || askedVideo) {
        return;
    }
    askedVideo = true;
    const video = PermissionsAndroid.PERMISSIONS.READ_MEDIA_VIDEO;
    if (!(await PermissionsAndroid.check(video))) {
        await PermissionsAndroid.request(video);
    }
};

/** Every audio file and mp4 video on the phone, by title. */
export const getLibrary = async (): Promise<Track[]> => (Music ? parseLibrary(await Music.getLibrary()) : []);

// ---- Folders ----------------------------------------------------------------

/** "" plays every song on the phone; a folder plays all its audio, subfolders included. */
export const inFolder = (track: Track, folder: string) =>
    folder ? track.folder.startsWith(folder) : track.music;

export interface MusicFolder {
    path: string;
    /** Audio files in it, subfolders included. */
    count: number;
}

/** Every folder holding audio, and the folders above them, by path. */
export const listFolders = (tracks: Track[]): MusicFolder[] => {
    const counts = new Map<string, number>();
    tracks.forEach(t => {
        // "Music/Gym/" counts for "Music/" and "Music/Gym/".
        const parts = t.folder.split('/').filter(Boolean);
        parts.forEach((_, i) => {
            const path = `${parts.slice(0, i + 1).join('/')}/`;
            counts.set(path, (counts.get(path) ?? 0) + 1);
        });
    });
    return [...counts]
        .map(([path, count]) => ({ path, count }))
        .sort((a, b) => a.path.localeCompare(b.path, undefined, { sensitivity: 'base' }));
};

/** "Gym" for "Music/Gym/". */
export const folderName = (folder: string) => folder.split('/').filter(Boolean).pop() ?? '';

export const formatTime = (ms: number) => {
    const total = Math.max(0, Math.floor(ms / 1000));
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
};
