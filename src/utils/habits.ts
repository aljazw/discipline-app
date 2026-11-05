/** Pure streak logic for habits, over local "YYYY-MM-DD" day keys (see dates.ts). */
import { Habit, HabitKind } from '../types/types';
import { addDays, fromDateKey, newId, toDateKey, weekdayIndex } from './dates';

export { addDays, fromDateKey, toDateKey, weekdayIndex };

/** Due on this day: on one of its weekdays, or on its one date. */
export const isScheduled = (habit: Habit, date: Date): boolean =>
    habit.once ? habit.once === toDateKey(date) : habit.days[weekdayIndex(date)] === true;

export const isDoneOn = (habit: Habit, date: Date): boolean => habit.completions.includes(toDateKey(date));

/** Upper bound on how far back we walk, so corrupt data can never loop for long. */
const MAX_LOOKBACK_DAYS = 3660;

/**
 * Consecutive due days completed, counting back from today. Days the habit
 * isn't due are skipped. Today only counts once it's done — an unfinished
 * today is "still pending", so it doesn't break the streak.
 */
export const currentStreak = (habit: Habit, today: Date = new Date()): number => {
    if (!habit.days.some(Boolean)) {
        return 0;
    }
    const done = new Set(habit.completions);
    const start = habit.createdAt;
    let day = today;
    let streak = 0;

    if (isScheduled(habit, day) && !done.has(toDateKey(day))) {
        day = addDays(day, -1); // today is still pending
    }
    for (let i = 0; i < MAX_LOOKBACK_DAYS && toDateKey(day) >= start; i++, day = addDays(day, -1)) {
        if (!isScheduled(habit, day)) {
            continue;
        }
        if (!done.has(toDateKey(day))) {
            break;
        }
        streak++;
    }
    return streak;
};

/**
 * The whole routine's streak: consecutive days on which every task due that
 * day was done. Days with nothing due are skipped, and a task only counts
 * from the day it was created. Like [currentStreak], an unfinished today is
 * still pending and doesn't break it.
 */
export const routineStreak = (habits: Habit[], today: Date = new Date()): number => {
    const tracked = habits.filter(h => h.kind === 'habit' && h.days.some(Boolean));
    if (tracked.length === 0) {
        return 0;
    }
    const done = tracked.map(h => new Set(h.completions));
    const start = tracked.reduce((min, h) => (h.createdAt < min ? h.createdAt : min), tracked[0].createdAt);
    /** null: nothing due that day. */
    const allDone = (day: Date): boolean | null => {
        const key = toDateKey(day);
        const due = tracked.map((h, i) => i).filter(i => tracked[i].createdAt <= key && isScheduled(tracked[i], day));
        return due.length === 0 ? null : due.every(i => done[i].has(key));
    };

    let day = today;
    let streak = 0;
    if (allDone(day) === false) {
        day = addDays(day, -1); // today is still pending
    }
    for (let i = 0; i < MAX_LOOKBACK_DAYS && toDateKey(day) >= start; i++, day = addDays(day, -1)) {
        const result = allDone(day);
        if (result === null) {
            continue;
        }
        if (!result) {
            break;
        }
        streak++;
    }
    return streak;
};

/** Longest run of completed due days since the habit was created. */
export const bestStreak = (habit: Habit, today: Date = new Date()): number => {
    if (!habit.days.some(Boolean)) {
        return 0;
    }
    const done = new Set(habit.completions);
    const todayKey = toDateKey(today);
    let day = fromDateKey(habit.createdAt);
    let run = 0;
    let best = 0;

    for (let i = 0; i < MAX_LOOKBACK_DAYS && toDateKey(day) <= todayKey; i++, day = addDays(day, 1)) {
        if (!isScheduled(habit, day)) {
            continue;
        }
        const key = toDateKey(day);
        if (done.has(key)) {
            run++;
            best = Math.max(best, run);
        } else if (key !== todayKey) {
            run = 0; // a missed past day ends the run; today is still pending
        }
    }
    return best;
};

export interface DayStatus {
    key: string;
    label: string;
    scheduled: boolean;
    done: boolean;
    isToday: boolean;
}

/** The last `count` days, oldest first, for the little history dots. */
export const recentDays = (habit: Habit, count = 7, today: Date = new Date()): DayStatus[] =>
    Array.from({ length: count }, (_, i) => {
        const day = addDays(today, i - (count - 1));
        const key = toDateKey(day);
        return {
            key,
            label: 'MTWTFSS'[weekdayIndex(day)],
            scheduled: isScheduled(habit, day) && key >= habit.createdAt,
            done: habit.completions.includes(key),
            isToday: i === count - 1,
        };
    });

/**
 * Share of due check-ins completed over the last `days` days (0–1), or null
 * if nothing was due. An unfinished today isn't counted against you yet.
 */
export const completionRate = (habits: Habit[], days = 7, today: Date = new Date()): number | null => {
    let due = 0;
    let done = 0;
    for (const habit of habits.filter(h => h.kind === 'habit')) {
        for (const day of recentDays(habit, days, today)) {
            if (!day.scheduled) {
                continue;
            }
            if (day.done) {
                due++;
                done++;
            } else if (!day.isToday) {
                due++;
            }
        }
    }
    return due === 0 ? null : done / due;
};

export const STREAK_MILESTONES = [3, 7, 14, 21, 30, 50, 75, 100, 150, 200, 365];

/** The milestone hit exactly at this streak length, if any. */
export const milestoneFor = (streak: number): number | null => (STREAK_MILESTONES.includes(streak) ? streak : null);

/** Returns the habit with today's check-in toggled. */
export const toggleCompletion = (habit: Habit, date: Date = new Date()): Habit => {
    const key = toDateKey(date);
    const completions = habit.completions.includes(key)
        ? habit.completions.filter(k => k !== key)
        : [...habit.completions, key].sort();
    return { ...habit, completions };
};

/** Returns the habit checked off for `date` (unchanged if it already is). */
export const markDone = (habit: Habit, date: Date = new Date()): Habit =>
    isDoneOn(habit, date) ? habit : toggleCompletion(habit, date);

export const newHabitId = (): string => newId('h');

/** Skipped on a day, with the reason why; a skipped day isn't done. */
export const skipHabit = (habit: Habit, dateKey: string, reason: string): Habit => ({
    ...habit,
    completions: habit.completions.filter(k => k !== dateKey),
    skips: { ...habit.skips, [dateKey]: reason.trim() },
});

/** Takes a skip back. */
export const unskipHabit = (habit: Habit, dateKey: string): Habit => {
    const rest = Object.fromEntries(Object.entries(habit.skips ?? {}).filter(([k]) => k !== dateKey));
    return { ...habit, skips: Object.keys(rest).length ? rest : undefined };
};

/** Things you'd skip if nothing made you; anything else starts as a routine. */
const HABIT_WORDS =
    /workout|train|gym|run|learn|study|read|meditat|stretch|yoga|apnea|practi|exercise|walk|swim|journal|language|plank|cardio|lift/i;

/** For data from before habits and routines were apart: guess from the link and the name. */
export const guessKind = (title: string, link?: string): HabitKind =>
    link || HABIT_WORDS.test(title) ? 'habit' : 'routine';
