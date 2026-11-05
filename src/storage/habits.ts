import { Habit } from '../types/types';
import { habitIconFrom } from '../constants/habitIcons';
import { guessKind } from '../utils/habits';
import {
    DATE_KEY,
    KEYS,
    clampInt,
    dayRecord,
    isString,
    readList,
    serialized,
    updateList,
    upsertById,
    withoutId,
    writeJson,
} from './core';

export const DEFAULT_TASK_MINUTES = 15;
export const MAX_TASK_MINUTES = 12 * 60;
export const MAX_WHY = 200;
export const MAX_REASON = 200;
/** Until a time is set: 9:00. */
export const DEFAULT_HABIT_TIME = 9 * 60;

const reasonOk = (x: unknown): x is string => typeof x === 'string' && x.trim().length > 0;

const toHabit = (v: any): Habit | null => {
    if (!v || !isString(v.id) || !isString(v.title) || !Array.isArray(v.days) || v.days.length !== 7) {
        return null;
    }
    const link = v.link === 'apnea' || v.link === 'workout' ? v.link : undefined;
    return {
        id: v.id,
        kind: v.kind === 'habit' || v.kind === 'routine' ? v.kind : guessKind(v.title, link),
        time: clampInt(v.time, 0, 24 * 60 - 1, DEFAULT_HABIT_TIME),
        ...(isString(v.why) && v.why.trim() ? { why: v.why.slice(0, MAX_WHY) } : {}),
        ...(dayRecord(v.skips, reasonOk) ? { skips: dayRecord(v.skips, reasonOk) } : {}),
        ...(typeof v.once === 'string' && DATE_KEY.test(v.once) ? { once: v.once } : {}),
        title: v.title,
        icon: habitIconFrom(v.icon, v.emoji),
        days: v.days.map((d: unknown) => d === true),
        duration: clampInt(v.duration, 1, MAX_TASK_MINUTES, DEFAULT_TASK_MINUTES),
        createdAt: typeof v.createdAt === 'string' && DATE_KEY.test(v.createdAt) ? v.createdAt : '1970-01-01',
        completions: Array.isArray(v.completions)
            ? [
                  ...new Set<string>(v.completions.filter((k: unknown) => typeof k === 'string' && DATE_KEY.test(k))),
              ].sort()
            : [],
        ...(link ? { link } : {}),
    };
};

/** Habits are kept in routine order: the order they come in during the day. */
export const getHabits = async (): Promise<Habit[]> => {
    try {
        return await readList(KEYS.habits, toHabit);
    } catch {
        throw new Error('Failed to get habits');
    }
};

/** Inserts the habit, or replaces the one with the same id. */
export const saveHabit = (habit: Habit): Promise<boolean> =>
    updateList(KEYS.habits, toHabit, list => upsertById(list, habit));

/** Applies `change` to the stored habit (by id) inside the write queue, so check-ins never race. */
export const updateHabit = (id: string, change: (habit: Habit) => Habit): Promise<boolean> =>
    updateList(KEYS.habits, toHabit, list => list.map(h => (h.id === id ? change(h) : h)));

export const deleteHabit = (id: string): Promise<boolean> =>
    updateList(KEYS.habits, toHabit, list => withoutId(list, id));

/** Replaces the whole list, e.g. after reordering the routine. */
export const saveHabits = (habits: Habit[]): Promise<boolean> =>
    serialized(async () => {
        try {
            return await writeJson(KEYS.habits, habits);
        } catch {
            return false;
        }
    });
