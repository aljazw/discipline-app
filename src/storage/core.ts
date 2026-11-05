/**
 * Low-level storage: the native "BlockedPrefs" SharedPreferences (shared with
 * BlockAccessibilityService, DnsVpnService and AppScreen), an in-memory
 * cache in front of it, a write queue, and helpers for validating stored data.
 */
import { NativeModules } from 'react-native';

const { SharedStorage } = NativeModules;

export const KEYS = {
    websites: '@blocked_websites',
    apps: '@blocked_apps',
    habits: '@habits',
    apneaRecords: '@apnea_records',
    apneaTables: '@apnea_tables',
    apneaSettings: '@apnea_settings',
    hasSeenWelcome: '@has_seen_welcome',
    notificationScheduled: '@notification_scheduled',
    darkMode: '@is_dark_mode',
    passphrase: '@is_passphrase',
    accent: '@accent_color',
    workouts: '@workouts',
    workoutRecords: '@workout_records',
    workoutSession: '@workout_session',
    workoutCues: '@workout_cues',
    sleepSchedule: '@sleep_schedule',
    sleepDismissedUntil: '@sleep_dismissed_until',
    vacation: '@vacation',
    /** Old time-window plans; only read once, to move them into the routine. */
    dayPlans: '@day_plans',
    days: '@days',
    routineMigrated: '@routine_migrated',
    planPrefs: '@plan_prefs',
    dayHours: '@day_hours',
    planNudges: '@plan_nudges',
    promiseVideoShown: '@promise_video_shown',
    musicFolder: '@music_folder',
    notes: '@notes',
    /** The protected notes' wrapped key (never the password); see NoteCryptoModule.kt. */
    notesVault: '@notes_vault',
    /** Today's time on blocks with a daily limit; written by BlockAccessibilityService (UsageLimits.kt). */
    limitUsage: '@limit_usage',
    mapMarks: '@map_marks',
    mapRoutes: '@map_routes',
    mapPrefs: '@map_prefs',
    todos: '@todos',
    /** When habits and tasks call (written for PlanCalls.kt, which arms them). */
    planCalls: '@plan_calls',
    /** Set once habits got a kind and a time (the Today / Tasks / Habits / Time plan). */
    planKindsMigrated: '@plan_kinds_migrated',
} as const;

// ---- Cache ------------------------------------------------------------------

/** Keys the native side writes too; these are always read fresh. */
const NATIVE_WRITTEN = new Set<string>([KEYS.sleepDismissedUntil, KEYS.limitUsage]);

/**
 * Raw values by key. Only JS writes the other keys, so after the first read
 * every screen gets its data without a trip over the bridge.
 */
const rawCache = new Map<string, string | null>();
/** Bumped on every write, so a read that started before it can't cache stale data. */
const versions = new Map<string, number>();
const reads = new Map<string, Promise<string | null>>();

export const readRaw = (key: string): Promise<string | null> => {
    const cacheable = !NATIVE_WRITTEN.has(key);
    if (cacheable && rawCache.has(key)) {
        return Promise.resolve(rawCache.get(key) ?? null);
    }
    const pending = reads.get(key);
    if (pending) {
        return pending;
    }
    const version = versions.get(key) ?? 0;
    const read = (async () => {
        try {
            const value: string | null = (await SharedStorage.getItem(key)) ?? null;
            if (cacheable && (versions.get(key) ?? 0) === version) {
                rawCache.set(key, value);
            }
            return value;
        } finally {
            reads.delete(key);
        }
    })();
    reads.set(key, read);
    return read;
};

type ChangeListener = (key: string) => void;
const changeListeners = new Set<ChangeListener>();

/** Called with the key after every successful write, so open screens can refresh. */
export const onStorageChange = (listener: ChangeListener): (() => void) => {
    changeListeners.add(listener);
    return () => {
        changeListeners.delete(listener);
    };
};

const notify = (key: string) => changeListeners.forEach(listener => listener(key));

/**
 * Writes a value. Cached keys show the new value at once (screens update
 * without waiting on the native write) and roll back if the write fails.
 */
export const writeRaw = async (key: string, value: string): Promise<boolean> => {
    const version = (versions.get(key) ?? 0) + 1;
    versions.set(key, version);
    reads.delete(key);
    const cacheable = !NATIVE_WRITTEN.has(key);
    const had = rawCache.has(key);
    const before = rawCache.get(key);
    if (cacheable) {
        rawCache.set(key, value);
        notify(key);
    }
    const rollBack = () => {
        if (versions.get(key) !== version) {
            return; // a newer write owns the value now
        }
        if (had) {
            rawCache.set(key, before ?? null);
        } else {
            rawCache.delete(key);
        }
        if (cacheable) {
            notify(key);
        }
    };
    try {
        const ok = (await SharedStorage.setItem(key, value)) === true;
        if (!ok) {
            rollBack();
        } else if (!cacheable) {
            notify(key);
        }
        return ok;
    } catch (error) {
        rollBack();
        throw error;
    }
};

/** Parsed values by key, reused while the raw value is unchanged (same object = no re-render). */
const parsedCache = new Map<string, { raw: string | null; parse: unknown; value: unknown }>();

/**
 * Reads and parses a key. Returns the same object as last time when nothing
 * changed, so screens can skip re-rendering. Treat results as read-only.
 */
export const readParsed = async <T>(key: string, parse: (raw: string | null) => T): Promise<T> => {
    const raw = await readRaw(key);
    const hit = parsedCache.get(key);
    if (hit && hit.raw === raw && hit.parse === parse) {
        return hit.value as T;
    }
    const value = parse(raw);
    parsedCache.set(key, { raw, parse, value });
    return value;
};

/** Forgets cached values, e.g. in tests. */
export const clearStorageCache = () => {
    rawCache.clear();
    parsedCache.clear();
    reads.clear();
};

// ---- Queue ------------------------------------------------------------------

/**
 * Every read-modify-write runs one after another through this queue, so two
 * quick actions (e.g. adding two sites, or a double tap) can never read the
 * same old list and overwrite each other's change.
 */
let queue: Promise<unknown> = Promise.resolve();
export const serialized = <T>(task: () => Promise<T>): Promise<T> => {
    const run = queue.then(task, task);
    queue = run.catch(() => undefined);
    return run;
};

// ---- Reading and writing ----------------------------------------------------

/** Parses stored JSON; damaged data is treated as missing instead of crashing the app. */
export const parseJson = (raw: string | null | undefined): unknown => {
    if (!raw) {
        return null;
    }
    try {
        return JSON.parse(raw);
    } catch {
        return null;
    }
};

export const writeJson = (key: string, value: unknown): Promise<boolean> => writeRaw(key, JSON.stringify(value));

const parseBool = (raw: string | null): boolean | null => (raw === 'true' ? true : raw === 'false' ? false : null);

export const readBool = (key: string): Promise<boolean | null> => readParsed(key, parseBool);

/** Reads a JSON object (or {} when missing/damaged) and builds a value from it. */
export const readObject = <T>(key: string, build: (v: any) => T): Promise<T> => readParsed(key, objectParser(build));

const objectParsers = new WeakMap<object, (raw: string | null) => unknown>();
const objectParser = <T>(build: (v: any) => T) => {
    let parser = objectParsers.get(build) as ((raw: string | null) => T) | undefined;
    if (!parser) {
        parser = (raw: string | null) => {
            const v = parseJson(raw);
            return build(v && typeof v === 'object' ? v : {});
        };
        objectParsers.set(build, parser);
    }
    return parser;
};

const listParsers = new WeakMap<object, (raw: string | null) => unknown>();
const listParser = <T>(toItem: (v: any) => T | null) => {
    let parser = listParsers.get(toItem) as ((raw: string | null) => T[]) | undefined;
    if (!parser) {
        parser = (raw: string | null) => {
            const parsed = parseJson(raw);
            return Array.isArray(parsed) ? parsed.map(toItem).filter((item): item is T => item !== null) : [];
        };
        listParsers.set(toItem, parser);
    }
    return parser;
};

/** A stored list, keeping only well-formed entries. */
export const readList = <T>(key: string, toItem: (v: any) => T | null): Promise<T[]> =>
    readParsed(key, listParser(toItem));

/** Read the list, apply `change`, write it back — all inside the queue. Resolves false on failure. */
export const updateList = <T>(key: string, toItem: (v: any) => T | null, change: (list: T[]) => T[]) =>
    serialized(async () => {
        try {
            return await writeJson(key, change(await readList(key, toItem)));
        } catch {
            return false;
        }
    });

/** Inserts `item`, or replaces the entry with the same id. */
export const upsertById = <T extends { id: string }>(list: T[], item: T): T[] =>
    list.some(x => x.id === item.id) ? list.map(x => (x.id === item.id ? item : x)) : [...list, item];

export const withoutId = <T extends { id: string }>(list: T[], id: string): T[] => list.filter(x => x.id !== id);

/** Adds a record unless one with its id exists, keeping the newest `max` by start time. */
export const addRecord = <T extends { id: string; startedAt: number }>(list: T[], record: T, max: number): T[] =>
    list.some(r => r.id === record.id) ? list : [...list, record].sort((a, b) => a.startedAt - b.startedAt).slice(-max);

// ---- Validation -------------------------------------------------------------

export const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
export const TIME = /^\d{2}:\d{2}$/;

export const isString = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
export const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
export const numbers = (v: unknown): number[] => (Array.isArray(v) ? v.filter(isNumber) : []);
export const clampInt = (v: unknown, min: number, max: number, fallback: number) =>
    isNumber(v) ? Math.min(max, Math.max(min, Math.round(v))) : fallback;

/** A { "YYYY-MM-DD": value } map with only valid days and values kept; undefined when empty. */
export const dayRecord = <T>(v: unknown, valid: (x: unknown) => x is T): Record<string, T> | undefined => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) {
        return undefined;
    }
    const out: Record<string, T> = {};
    for (const [key, value] of Object.entries(v)) {
        if (DATE_KEY.test(key) && valid(value)) {
            out[key] = value;
        }
    }
    return Object.keys(out).length > 0 ? out : undefined;
};
