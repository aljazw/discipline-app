/**
 * Pure logic for the day plan. Only wake-up and bedtime are fixed; every task
 * has a duration and they follow each other in order. Times are estimates,
 * worked out live from when you last finished something.
 */
import { DayPlan, Habit, SleepSchedule } from '../types/types';
import type { IconName } from '../components/Icon';
import { fromDateKey, newId, toDateKey } from './dates';
import { guessKind, isDoneOn, isScheduled } from './habits';
import type { LegacyBlock } from '../storage/dayPlans';

export const DAY_MINUTES = 24 * 60;
export const DEFAULT_TASK_LENGTH = 30;
/** Pace within this many minutes counts as on time. */
const ON_TIME = 5;

export const newTaskId = (): string => newId('t');

// ---- Time helpers -----------------------------------------------------------

const pad = (n: number) => String(n).padStart(2, '0');

/** 450 -> "07:30"; past midnight wraps (1500 -> "01:00"). */
export const formatMinutes = (minutes: number): string => {
    const m = ((Math.round(minutes) % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
    return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
};

/** "07:30" -> 450, or null if it isn't a valid time. */
export const parseMinutes = (hhmm: string): number | null => {
    const match = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
    if (!match) {
        return null;
    }
    const h = Number(match[1]);
    const m = Number(match[2]);
    return h <= 23 && m <= 59 ? h * 60 + m : null;
};

/** 45 -> "45 min", 60 -> "1 h", 90 -> "1 h 30 min". */
export const formatDuration = (minutes: number): string => {
    const total = Math.max(0, Math.round(minutes));
    const h = Math.floor(total / 60);
    const m = total % 60;
    if (h === 0) {
        return `${m} min`;
    }
    return m ? `${h} h ${m} min` : `${h} h`;
};

export const minutesNow = (now: Date = new Date()): number => now.getHours() * 60 + now.getMinutes();

/** Epoch millis of `minutes` after local midnight on the plan's day (past 1440 runs into the next day). */
export const timestampOf = (dateKey: string, minutes: number): number => {
    const date = fromDateKey(dateKey);
    date.setHours(0, 0, 0, 0);
    date.setMinutes(minutes);
    return date.getTime();
};

export interface Anchors {
    wake: number;
    /** After `wake`; past 1440 when bedtime is after midnight. */
    bed: number;
}

export const anchorsOf = (sleep: Pick<SleepSchedule, 'wake' | 'bedtime'>): Anchors => {
    const wake = parseMinutes(sleep.wake) ?? 7 * 60;
    const bed = parseMinutes(sleep.bedtime) ?? 23 * 60;
    return { wake, bed: bed <= wake ? bed + DAY_MINUTES : bed };
};

// ---- The day's tasks ------------------------------------------------------------

export type TaskStatus = 'open' | 'done' | 'skipped';

export interface PlanTask {
    id: string;
    title: string;
    icon: IconName;
    duration: number;
    /** Set for routine tasks; one-offs have none. */
    habit?: Habit;
    status: TaskStatus;
    /** When it was checked off, if known (minutes after midnight). */
    finishedAt?: number;
}

/**
 * Puts `order` first, then slots every id it doesn't mention in after the one
 * that comes before it in `base` (so a task added to the routine later still
 * lands in its usual place).
 */
export const mergeOrder = (base: string[], order: string[]): string[] => {
    const known = new Set(base);
    const result = order.filter((id, i) => known.has(id) && order.indexOf(id) === i);
    base.forEach((id, i) => {
        if (result.includes(id)) {
            return;
        }
        const before = i > 0 ? result.indexOf(base[i - 1]) : -1;
        result.splice(before + 1, 0, id);
    });
    return result;
};

/** Routine tasks due on the day (in routine order) and the day's one-offs, in the day's order. */
export const dayTasks = (day: DayPlan, habits: Habit[]): PlanTask[] => {
    const date = fromDateKey(day.date);
    const routine: PlanTask[] = habits
        .filter(h => isScheduled(h, date) && h.createdAt <= day.date)
        .map(h => ({
            id: h.id,
            title: h.title,
            icon: h.icon,
            duration: h.duration,
            habit: h,
            status: isDoneOn(h, date) ? 'done' : 'open',
        }));
    const oneOffs: PlanTask[] = day.oneOffs.map(t => ({
        ...t,
        status: day.finished[t.id] !== undefined ? 'done' : 'open',
    }));
    const byId = new Map([...routine, ...oneOffs].map(t => [t.id, t]));
    return mergeOrder([...byId.keys()], day.order).map(id => {
        const task = byId.get(id)!;
        const finishedAt = day.finished[id];
        if (task.status === 'done') {
            return finishedAt !== undefined ? { ...task, finishedAt } : task;
        }
        return day.skipped.includes(id) ? { ...task, status: 'skipped' } : task;
    });
};

// ---- Timing -----------------------------------------------------------------

export interface Slot {
    task: PlanTask;
    /** Estimated (or, once done, actual) start and end in minutes after midnight. */
    start: number;
    end: number;
    /** The task on now (today only): the first one not done or skipped. */
    current: boolean;
    /** Ends by bedtime. */
    fits: boolean;
}

export interface DaySchedule {
    anchors: Anchors;
    slots: Slot[];
    current: Slot | null;
    /**
     * Minutes behind (positive) or ahead (negative) of a day where every task
     * took exactly its time, back to back from wake-up. Today only.
     */
    behind: number | null;
    /** Open tasks that won't fit before bedtime at this pace. */
    overflow: PlanTask[];
    /** When the last open task should be done. */
    end: number;
}

/**
 * Lines the tasks up from wake-up. For today (`now` given) the current task
 * started when you last finished something, and runs at least until now, so
 * an interruption simply pushes everything after it back.
 */
export const scheduleDay = (tasks: PlanTask[], anchors: Anchors, now: number | null): DaySchedule => {
    const { wake, bed } = anchors;
    const finishes = tasks.map(t => t.finishedAt).filter((m): m is number => m !== undefined);
    let cursor = now === null ? wake : Math.max(wake, ...finishes);
    let baseline = wake;
    let current: Slot | null = null;
    let behind: number | null = null;
    const slots: Slot[] = [];

    for (const task of tasks) {
        if (task.status === 'skipped') {
            slots.push({ task, start: cursor, end: cursor, current: false, fits: true });
            continue;
        }
        baseline += task.duration;
        if (task.status === 'done') {
            const end = task.finishedAt ?? cursor;
            slots.push({ task, start: end - task.duration, end, current: false, fits: true });
            continue;
        }
        const start = cursor;
        let end = start + task.duration;
        const isCurrent = now !== null && !current;
        if (isCurrent) {
            end = Math.max(end, now);
            behind = end - baseline;
        }
        const slot: Slot = { task, start, end, current: isCurrent, fits: end <= bed };
        if (isCurrent) {
            current = slot;
        }
        slots.push(slot);
        cursor = end;
    }

    return {
        anchors,
        slots,
        current,
        behind,
        overflow: slots.filter(s => s.task.status === 'open' && !s.fits).map(s => s.task),
        end: cursor,
    };
};

export type Pace = { kind: 'onTime' } | { kind: 'behind'; minutes: number } | { kind: 'ahead'; minutes: number };

export const paceOf = (behind: number | null): Pace | null =>
    behind === null
        ? null
        : behind > ON_TIME
        ? { kind: 'behind', minutes: behind }
        : behind < -ON_TIME
        ? { kind: 'ahead', minutes: -behind }
        : { kind: 'onTime' };

/** Total minutes of the tasks that still count (done or open). */
export const plannedMinutes = (tasks: PlanTask[]): number =>
    tasks.filter(t => t.status !== 'skipped').reduce((sum, t) => sum + t.duration, 0);

// ---- Changing the day -------------------------------------------------------------

/** The day's order with the task swapped behind the next open task ("Later"). */
export const laterOrder = (tasks: PlanTask[], id: string): string[] => {
    const ids = tasks.map(t => t.id);
    const from = ids.indexOf(id);
    if (from < 0) {
        return ids;
    }
    const after = tasks.findIndex((t, i) => i > from && t.status === 'open');
    ids.splice(from, 1);
    ids.splice(after < 0 ? ids.length : after, 0, id);
    return ids;
};

/** The day's order with `id` placed right after `afterId` (or first when null). */
export const orderWith = (tasks: PlanTask[], id: string, afterId: string | null): string[] => {
    const ids = tasks.map(t => t.id).filter(t => t !== id);
    ids.splice(afterId === null ? 0 : ids.indexOf(afterId) + 1, 0, id);
    return ids;
};

// ---- Getting started ----------------------------------------------------------

const EVERY_DAY = [true, true, true, true, true, true, true];
const WEEKDAYS = [true, true, true, true, true, false, false];

const STARTER: { title: string; icon: IconName; duration: number; days: boolean[] }[] = [
    { title: 'Morning routine', icon: 'Sunrise', duration: 30, days: EVERY_DAY },
    { title: 'Breakfast', icon: 'Meal', duration: 30, days: EVERY_DAY },
    { title: 'Deep work', icon: 'Work', duration: 180, days: WEEKDAYS },
    { title: 'Lunch', icon: 'Meal', duration: 45, days: EVERY_DAY },
    { title: 'Work', icon: 'Work', duration: 180, days: WEEKDAYS },
    { title: 'Workout', icon: 'Dumbbell', duration: 60, days: EVERY_DAY },
    { title: 'Dinner', icon: 'Meal', duration: 45, days: EVERY_DAY },
    { title: 'Read', icon: 'Book', duration: 30, days: EVERY_DAY },
    { title: 'Wind down', icon: 'Bed', duration: 30, days: EVERY_DAY },
];

/** A typical routine to start from; everything is editable. */
export const starterRoutine = (today: Date, makeId: () => string): Habit[] =>
    STARTER.map(t => ({
        ...t,
        id: makeId(),
        kind: guessKind(t.title),
        time: 7 * 60,
        createdAt: toDateKey(today),
        completions: [],
    }));

/**
 * Moves the old time-window plan into the routine: the latest plan's blocks,
 * in time order, become routine tasks with their length as duration. Blocks
 * linked to a habit give it that duration; habits without a block keep their
 * place at the end.
 */
export const routineFromLegacy = (
    latest: LegacyBlock[],
    habits: Habit[],
    today: Date,
    makeId: () => string,
): Habit[] => {
    // In the order of their usual times (a "running late" shift undone).
    const usual = (b: LegacyBlock) => b.start - (b.shift ?? 0);
    const blocks = latest.filter(b => !b.once).sort((a, b) => usual(a) - usual(b));
    const used = new Set<string>();
    const routine: Habit[] = [];
    for (const block of blocks) {
        const duration = Math.max(1, Math.min(12 * 60, block.end - block.start));
        const habit = block.habitId ? habits.find(h => h.id === block.habitId) : undefined;
        if (habit) {
            if (!used.has(habit.id)) {
                used.add(habit.id);
                routine.push({ ...habit, duration });
            }
            continue;
        }
        routine.push({
            id: makeId(),
            kind: guessKind(block.title),
            time: Math.max(0, Math.min(DAY_MINUTES - 1, usual(block))),
            title: block.title,
            icon: block.icon,
            duration,
            days: EVERY_DAY,
            createdAt: toDateKey(today),
            completions: [],
        });
    }
    return [...routine, ...habits.filter(h => !used.has(h.id))];
};

// ---- Motivation ---------------------------------------------------------------

const LINES = [
    'You planned this for a reason. Follow through.',
    'One task at a time.',
    'Small actions, done on time, add up.',
    'The plan only works if you do.',
    'Start now. Adjust later.',
    'Give this your full attention. The rest can wait.',
    'Consistency beats intensity.',
    'Discipline is choosing what you want most over what you want now.',
    'Do the next right thing.',
    'You already decided. Now just begin.',
];

/** A short line to go with a reminder; stable for the same task on the same day. */
export const motivationFor = (seed: string): string => {
    let hash = 0;
    for (let i = 0; i < seed.length; i++) {
        hash = (hash * 31 + seed.charCodeAt(i)) % 1_000_003;
    }
    return LINES[Math.abs(hash) % LINES.length];
};

export const todayKey = (): string => toDateKey(new Date());
