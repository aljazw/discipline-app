/**
 * Backup export / import as one JSON file.
 *
 * Export takes everything worth keeping: blocks, the routine and day plans, workouts
 * and their history, apnea tables, records and settings, notes, sleep time,
 * vacation, appearance, the music folder, the DNS resolver, and the map's
 * saved places, routes and settings (tracks and map files stay on the phone).
 *
 * Protected notes go into the file exactly as stored: encrypted, next to the
 * key that's wrapped with the notes password. The password itself is stored
 * nowhere, so the file opens them only for someone who knows it.
 *
 * Import restores it, with one rule: it can never weaken protection, or it
 * would be a two-tap way around the app.
 *  - Blocked sites and apps are only added; nothing on the list is removed.
 *  - Sleep time is taken only while it's off here.
 *  - A vacation is taken only if it hasn't started yet and none is planned.
 *  - Passphrase protection can be turned on, never off.
 * Everything else replaces what's on the phone.
 */
import { SleepSchedule, Vacation } from '../types/types';
import { isValidVacation, vacationPhase } from '../utils/vacation';
import { APP_NAME } from '../constants/brand';
import { KEYS, parseJson, readRaw, serialized, writeJson, writeRaw } from './core';
import { mergeBlockedApps, mergeBlockedWebsites } from './blockList';
import { getSleepSchedule, setSleepSchedule } from './sleep';
import { getVacation, setVacation } from './vacation';

export const BACKUP_FORMAT = 'discipline-app-backup';
/** Format names written by earlier builds, still accepted on import. */
const LEGACY_FORMATS = ['gaman-backup'];
export const BACKUP_VERSION = 1;

/** Native-only key: the resolver for allowed sites, stored as a plain string. */
const DNS_UPSTREAM = '@dns_upstream';

/** Restored by replacing the current value. Lists must be arrays, the rest objects or flags. */
const REPLACED = {
    habits: { key: KEYS.habits, kind: 'list' },
    todos: { key: KEYS.todos, kind: 'list' },
    days: { key: KEYS.days, kind: 'list' },
    planPrefs: { key: KEYS.planPrefs, kind: 'object' },
    dayHours: { key: KEYS.dayHours, kind: 'object' },
    workouts: { key: KEYS.workouts, kind: 'list' },
    workoutRecords: { key: KEYS.workoutRecords, kind: 'list' },
    workoutCues: { key: KEYS.workoutCues, kind: 'object' },
    apneaTables: { key: KEYS.apneaTables, kind: 'list' },
    apneaRecords: { key: KEYS.apneaRecords, kind: 'list' },
    apneaSettings: { key: KEYS.apneaSettings, kind: 'object' },
    darkMode: { key: KEYS.darkMode, kind: 'flag' },
    accent: { key: KEYS.accent, kind: 'string' },
    musicFolder: { key: KEYS.musicFolder, kind: 'string' },
    // The key before the notes it opens, so the two always arrive together.
    notesVault: { key: KEYS.notesVault, kind: 'object' },
    notes: { key: KEYS.notes, kind: 'list' },
    mapMarks: { key: KEYS.mapMarks, kind: 'list' },
    mapRoutes: { key: KEYS.mapRoutes, kind: 'list' },
    mapPrefs: { key: KEYS.mapPrefs, kind: 'object' },
} as const;

type ReplacedName = keyof typeof REPLACED;

export interface BackupData {
    websites?: unknown[];
    apps?: unknown[];
    sleepSchedule?: unknown;
    vacation?: unknown;
    dnsUpstream?: string;
    passphrase?: boolean;
    [name: string]: unknown;
}

export interface Backup {
    format: typeof BACKUP_FORMAT;
    version: number;
    exportedAt: string;
    data: BackupData;
}

const names = Object.keys(REPLACED) as ReplacedName[];

const fits = (kind: string, v: unknown) =>
    kind === 'list'
        ? Array.isArray(v)
        : kind === 'object'
        ? !!v && typeof v === 'object' && !Array.isArray(v)
        : kind === 'flag'
        ? typeof v === 'boolean'
        : typeof v === 'string';

/** Collects all app data into a backup object. */
export const createBackup = async (now: Date = new Date()): Promise<Backup> => {
    const data: BackupData = {};
    const read = async (key: string) => parseJson(await readRaw(key));
    for (const name of names) {
        const value = await read(REPLACED[name].key);
        if (value !== null && fits(REPLACED[name].kind, value)) {
            data[name] = value;
        }
    }
    data.websites = ((await read(KEYS.websites)) as unknown[] | null) ?? [];
    data.apps = ((await read(KEYS.apps)) as unknown[] | null) ?? [];
    data.sleepSchedule = await read(KEYS.sleepSchedule);
    data.vacation = await read(KEYS.vacation);
    data.dnsUpstream = (await readRaw(DNS_UPSTREAM)) ?? '';
    data.passphrase = (await read(KEYS.passphrase)) === true;
    return { format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: now.toISOString(), data };
};

/** Parses a backup file, or explains why it can't be used. */
export const parseBackup = (text: string): { backup: Backup } | { error: string } => {
    let v: any;
    try {
        v = JSON.parse(text);
    } catch {
        return { error: 'This file isn’t valid JSON.' };
    }
    if (!v || (v.format !== BACKUP_FORMAT && !LEGACY_FORMATS.includes(v.format)) || !v.data || typeof v.data !== 'object') {
        return { error: `This isn’t a ${APP_NAME} backup file.` };
    }
    if (typeof v.version !== 'number' || v.version > BACKUP_VERSION) {
        return { error: `This backup comes from a newer version of ${APP_NAME}. Update the app, then try again.` };
    }
    return { backup: v as Backup };
};

const count = (v: unknown) => (Array.isArray(v) ? v.length : 0);

/** Short human summary of what a backup holds, for the confirm dialog. */
export const describeBackup = (backup: Backup): string => {
    const d = backup.data;
    const parts = [
        [count(d.websites), 'blocked site'],
        [count(d.apps), 'blocked app'],
        [count(d.habits), 'routine task'],
        [count(d.todos), 'to-do'],
        [count(d.workouts), 'workout'],
        [count(d.workoutRecords), 'workout session'],
        [count(d.apneaTables), 'apnea table'],
        [count(d.apneaRecords), 'apnea session'],
        [count(d.notes), 'note'],
    ] as const;
    const list = parts.filter(([n]) => n > 0).map(([n, label]) => `${n} ${label}${n === 1 ? '' : 's'}`);
    const date = new Date(backup.exportedAt);
    const when = Number.isNaN(date.getTime()) ? '' : ` from ${date.toLocaleDateString()}`;
    return `Backup${when}: ${list.length ? list.join(', ') : 'settings only'}.`;
};

export interface ImportResult {
    ok: boolean;
    /** Things the import deliberately left alone, to tell the user. */
    skipped: string[];
}

/** Applies a parsed backup under the rules at the top of this file. */
export const importBackup = async (backup: Backup, now: Date = new Date()): Promise<ImportResult> => {
    const d = backup.data;
    const skipped: string[] = [];
    let ok = true;

    for (const name of names) {
        const value = d[name];
        if (value === undefined || !fits(REPLACED[name].kind, value)) {
            continue;
        }
        ok = (await serialized(() => writeJson(REPLACED[name].key, value)).catch(() => false)) && ok;
    }
    // A backup from before the routine: its time-window plan is moved over like on the phone itself.
    if (Array.isArray(d.dayPlans) && d.days === undefined) {
        ok = (await serialized(() => writeJson(KEYS.dayPlans, d.dayPlans)).catch(() => false)) && ok;
        ok = (await writeRaw(KEYS.routineMigrated, 'false').catch(() => false)) && ok;
    }
    if (d.passphrase === true) {
        ok = (await writeJson(KEYS.passphrase, true).catch(() => false)) && ok;
    }
    if (typeof d.dnsUpstream === 'string') {
        ok = (await writeRaw(DNS_UPSTREAM, d.dnsUpstream.trim().toLowerCase()).catch(() => false)) && ok;
    }

    // Sleep time: only fill it in while it's off, so an import can't switch it off.
    const sleep = d.sleepSchedule as Partial<SleepSchedule> | null | undefined;
    if (sleep && typeof sleep === 'object') {
        const current = await getSleepSchedule();
        if (current.enabled) {
            skipped.push('Sleep time kept as it is (it’s on, and an import can’t change it)');
        } else {
            ok = (await setSleepSchedule({ ...current, ...sleep } as SleepSchedule)) && ok;
        }
    }

    // Vacation: never one that would pause blocks right now.
    const vacation = d.vacation as Vacation | null | undefined;
    if (vacation && typeof vacation === 'object') {
        const valid = typeof vacation.start === 'string' && typeof vacation.end === 'string';
        const upcoming = valid && isValidVacation(vacation) && vacationPhase(vacation, now) === 'upcoming';
        const existing = await getVacation();
        if (upcoming && !existing) {
            ok = (await setVacation({ start: vacation.start, end: vacation.end })) && ok;
        } else if (valid && vacationPhase(vacation, now) !== 'over') {
            skipped.push('Vacation not imported (it would pause blocks now, or one is already planned)');
        }
    }

    // Blocks: only added, never removed.
    if (Array.isArray(d.websites)) {
        ok = (await mergeBlockedWebsites(d.websites)) && ok;
    }
    if (Array.isArray(d.apps)) {
        ok = (await mergeBlockedApps(d.apps)) && ok;
    }

    return { ok, skipped };
};

/** The file name an export suggests, e.g. discipline-app-backup-2026-10-13.json. */
export const backupFileName = (now: Date = new Date()) => {
    const pad = (n: number) => `${n}`.padStart(2, '0');
    return `discipline-app-backup-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.json`;
};
