/**
 * Loading and changing the plan, its calls (PlanCalls.kt opens the app when a
 * habit is due or tasks are out of time) and its notifications (did a routine
 * end, is a started habit done). Pure logic is in plan.ts.
 */
import notifee, { AndroidImportance, Event, EventType, TriggerType } from '@notifee/react-native';
import { NativeModules } from 'react-native';
import { DayHours, DayPlan, Habit, Todo } from '../types/types';
import { addDays, fromDateKey, newId, toDateKey } from './dates';
import { isScheduled, markDone, skipHabit } from './habits';
import { formatDuration, minutesNow, routineFromLegacy, timestampOf } from './dayPlan';
import { callsFor, dayBounds } from './plan';
import { newTodo } from './todos';
import {
    STORAGE_KEYS,
    getDay,
    getDayHours,
    getDays,
    getHabits,
    getLegacyPlans,
    getPlanPrefs,
    getTodos,
    onStorageChange,
    saveHabits,
    saveTodo,
    updateDay,
    updateHabit,
} from '../storage';
import { KEYS, parseJson, readBool, readRaw, writeJson } from '../storage/core';
import { logger } from './logger';

const native: { schedule?: () => Promise<boolean>; takeOpen?: () => Promise<string | null>; dismiss?: () => void } | undefined =
    NativeModules.PlanCalls;

export interface LoadedDay {
    day: DayPlan;
    habits: Habit[];
    hours: DayHours;
}

export const loadDay = async (date: string): Promise<LoadedDay> => {
    const [day, habits, hours] = await Promise.all([getDay(date), getHabits(), getDayHours()]);
    return { day, habits, hours };
};

// ---- Changes --------------------------------------------------------------------

/** Remembers when a habit was checked off elsewhere (e.g. by finishing a workout). */
export const recordFinished = (date: string, taskId: string, at: number): Promise<boolean> =>
    updateDay(date, day => ({ ...day, finished: { ...day.finished, [taskId]: at } }));

/** Checks a habit off for the day, or takes it back. */
export const setHabitDone = async (habitId: string, date: string, done: boolean): Promise<boolean> => {
    const ok = await updateHabit(habitId, h =>
        done ? markDone(h, fromDateKey(date)) : { ...h, completions: h.completions.filter(k => k !== date) },
    );
    return ok && (!done || (await recordFinished(date, habitId, minutesNow(new Date()))));
};

export const skipHabitOn = (habitId: string, date: string, reason: string): Promise<boolean> =>
    updateHabit(habitId, h => skipHabit(h, date, reason));

/** "Start now" on a habit's call: it stops calling, and asks later whether it's done. */
export const startHabit = (habitId: string, date: string, at: number): Promise<boolean> =>
    updateDay(date, day => ({ ...day, started: { ...day.started, [habitId]: at } }));

/** "In 30 min" was used for this call today. */
export const snoozeCall = (date: string, key: string): Promise<boolean> =>
    updateDay(date, day => ({ ...day, snoozed: [...day.snoozed.filter(k => k !== key), key] }));

/** How long a routine really took that day; null goes back to its usual length. */
export const setRoutineActual = (date: string, routineId: string, minutes: number | null): Promise<boolean> =>
    updateDay(date, day => {
        const rest = Object.fromEntries(Object.entries(day.actual).filter(([id]) => id !== routineId));
        return { ...day, actual: minutes === null ? rest : { ...rest, [routineId]: Math.max(0, Math.round(minutes)) } };
    });

/** A routine that didn't happen that day isn't counted. */
export const setRoutineHappened = (date: string, routineId: string, happened: boolean): Promise<boolean> =>
    updateDay(date, day => ({
        ...day,
        skipped: happened ? day.skipped.filter(id => id !== routineId) : [...day.skipped.filter(id => id !== routineId), routineId],
    }));

// ---- Moving data over ------------------------------------------------------------

/**
 * Once: turns the old time-window plan into the routine (see
 * routineFromLegacy) and clears the old habit reminders. Never throws.
 */
export const migrateRoutine = async (): Promise<void> => {
    try {
        if (!(await readBool(KEYS.routineMigrated))) {
            const [legacy, habits] = await Promise.all([getLegacyPlans(), getHabits()]);
            const latest = legacy.filter(p => p.date <= toDateKey(new Date())).pop() ?? legacy[legacy.length - 1];
            if (latest && latest.blocks.length > 0) {
                const routine = routineFromLegacy(latest.blocks, habits, new Date(), () => newId('h'));
                if (!(await saveHabits(routine))) {
                    return;
                }
            }
            await writeJson(KEYS.routineMigrated, true);
            notifee
                .getTriggerNotificationIds()
                .then(ids => notifee.cancelTriggerNotifications(ids.filter(id => id.startsWith('habit:'))))
                .catch(error => logger.warn('Could not clear old habit reminders', error));
        }
        await migratePlanKinds();
    } catch (error) {
        logger.warn('Could not move the old plan over', error);
    }
};

/**
 * Habits once had no time of their own: they followed each other from
 * wake-up in routine order. Each gets the time it used to start at (on the
 * first weekday it's on). Day one-offs from today on become tasks (once).
 */
export const habitTimesFromOrder = (habits: Habit[], wake: number): Habit[] => {
    const times = new Map<string, number>();
    for (let wd = 0; wd < 7; wd++) {
        let cursor = wake;
        for (const h of habits) {
            if (!h.once && h.days[wd]) {
                if (!times.has(h.id)) {
                    times.set(h.id, Math.min(cursor, 24 * 60 - 1));
                }
                cursor += h.duration;
            }
        }
    }
    return habits.map(h => ({ ...h, time: times.get(h.id) ?? h.time }));
};

const migratePlanKinds = async (): Promise<void> => {
    // Habits without a time of their own: from before, or from an old backup.
    const raw = parseJson(await readRaw(KEYS.habits));
    if (Array.isArray(raw) && raw.some(h => h && typeof h.time !== 'number')) {
        const [habits, hours] = await Promise.all([getHabits(), getDayHours()]);
        if (!(await saveHabits(habitTimesFromOrder(habits, dayBounds(hours).wake)))) {
            return;
        }
    }
    if (await readBool(KEYS.planKindsMigrated)) {
        return;
    }
    const today = toDateKey(new Date());
    for (const day of (await getDays()).filter(d => d.date >= today)) {
        for (const oneOff of day.oneOffs.filter(t => !(t.id in day.finished))) {
            await saveTodo(newTodo(oneOff.title, Date.now()));
        }
    }
    await writeJson(KEYS.planKindsMigrated, true);
};

// ---- Calls -------------------------------------------------------------------------

/** The call that opened the app, if one rang and wasn't shown yet (its id). */
export const takeOpenCall = async (): Promise<string | null> => {
    try {
        const json = await native?.takeOpen?.();
        return json ? parseCallJson(json) : null;
    } catch {
        return null;
    }
};

export const parseCallJson = (json: string): string | null => {
    try {
        const id = JSON.parse(json)?.id;
        return typeof id === 'string' ? id : null;
    } catch {
        return null;
    }
};

/** Clears a decided call's notification. */
export const dismissCall = () => native?.dismiss?.();

// ---- Notifications ----------------------------------------------------------------

const CHANNEL_ID = 'plan';
const ID_PREFIX = 'plan:';
/** "Still going" / "Not yet" follow-ups; kept across syncs while still unanswered. */
const AGAIN_PREFIX = 'plan-again:';
const AGAIN_AFTER = 15 * 60_000;

const ACTION_YES = 'plan-yes';
const ACTION_AGAIN = 'plan-again';

/** What a notification asks: did a routine end, or is a started habit done. */
interface Asks {
    kind: 'routine' | 'habit';
    date: string;
    id: string;
    title: string;
    /** Minutes after midnight it started. */
    start: number;
}

const notification = (id: string, title: string, body: string, asks: Asks) => ({
    id,
    title,
    body,
    data: { kind: asks.kind, date: asks.date, id: asks.id, title: asks.title, start: String(asks.start) },
    android: {
        channelId: CHANNEL_ID,
        smallIcon: 'ic_stat_app',
        pressAction: { id: 'default' },
        // No launchActivity: the buttons work without opening the app.
        actions: [
            { title: asks.kind === 'routine' ? 'Finished' : `✓ Done`, pressAction: { id: ACTION_YES } },
            { title: asks.kind === 'routine' ? 'Still going' : 'Not yet', pressAction: { id: ACTION_AGAIN } },
        ],
    },
});

const asksOf = (data: Record<string, unknown> | undefined): Asks | null =>
    data &&
    (data.kind === 'routine' || data.kind === 'habit') &&
    typeof data.date === 'string' &&
    typeof data.id === 'string' &&
    typeof data.title === 'string'
        ? { kind: data.kind, date: data.date, id: data.id, title: data.title, start: Number(data.start) || 0 }
        : null;

/**
 * Handles the buttons on plan notifications (foreground and background):
 * Finished records how long a routine really took, Done checks a habit off,
 * the other asks again in 15 minutes. Never throws.
 */
export const handlePlanNotificationEvent = async ({ type, detail }: Event): Promise<void> => {
    const action = detail.pressAction?.id;
    const asks = asksOf(detail.notification?.data);
    if (type !== EventType.ACTION_PRESS || !asks || (action !== ACTION_YES && action !== ACTION_AGAIN)) {
        return;
    }
    try {
        if (detail.notification?.id) {
            await notifee.cancelNotification(detail.notification.id);
        }
        if (action === ACTION_YES) {
            if (asks.kind === 'routine') {
                const now = asks.date === toDateKey(new Date()) ? minutesNow(new Date()) : null;
                if (now !== null && now > asks.start) {
                    await setRoutineActual(asks.date, asks.id, now - asks.start);
                }
            } else {
                await setHabitDone(asks.id, asks.date, true);
            }
            return;
        }
        await notifee.createTriggerNotification(
            notification(
                `${AGAIN_PREFIX}${asks.date}:${asks.id}`,
                asks.kind === 'routine' ? `Still at ${asks.title}?` : `${asks.title}: done yet?`,
                asks.kind === 'routine' ? 'Tap Finished when it ends, so the day’s time is right.' : 'Tap Done when it’s finished.',
                asks,
            ),
            { type: TriggerType.TIMESTAMP, timestamp: Date.now() + AGAIN_AFTER },
        );
    } catch (error) {
        logger.warn('Could not handle a plan notification', error);
    }
};

/** Everything calls and notifications are built from. */
const INPUTS: string[] = [
    STORAGE_KEYS.days,
    STORAGE_KEYS.habits,
    STORAGE_KEYS.todos,
    STORAGE_KEYS.planPrefs,
    STORAGE_KEYS.dayHours,
    STORAGE_KEYS.sleepSchedule,
];

/**
 * Keeps calls and notifications in step with the data (once per burst of
 * writes). Call once at startup; returns a function that stops watching.
 */
export const watchPlanReminders = (): (() => void) => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = onStorageChange(key => {
        if (INPUTS.includes(key) && !timer) {
            timer = setTimeout(() => {
                timer = null;
                syncPlanReminders();
            }, 300);
        }
    });
    return () => {
        unsubscribe();
        if (timer) {
            clearTimeout(timer);
        }
    };
};

let syncing: Promise<void> | null = null;
let again = false;

/** Rebuilds today's and tomorrow's calls and notifications; one run at a time. Never throws. */
export const syncPlanReminders = (): Promise<void> => {
    if (syncing) {
        again = true;
        return syncing;
    }
    syncing = (async () => {
        do {
            again = false;
            await syncOnce();
        } while (again);
    })().finally(() => {
        syncing = null;
    });
    return syncing;
};

/** Whether a follow-up still has something to ask. */
const stillOpen = (asks: { kind: string; id: string }, day: DayPlan, habits: Habit[]): boolean => {
    const habit = habits.find(h => h.id === asks.id);
    if (!habit) {
        return false;
    }
    return asks.kind === 'routine'
        ? day.actual[habit.id] === undefined && !day.skipped.includes(habit.id)
        : !habit.completions.includes(day.date);
};

const syncOnce = async (): Promise<void> => {
    try {
        const [habits, todos, hours, prefs] = await Promise.all([getHabits(), getTodos(), getDayHours(), getPlanPrefs()]);
        const now = new Date();
        const dates = [now, addDays(now, 1)];
        const days = await Promise.all(dates.map(d => getDay(toDateKey(d))));

        await writeCalls(habits, todos, days, dates, hours, now.getTime());

        const pending = await notifee.getTriggerNotificationIds();
        const ids = pending.filter(id => id.startsWith(ID_PREFIX));
        if (ids.length > 0) {
            await notifee.cancelTriggerNotifications(ids);
        }
        const today = days[0];
        const stale = pending
            .filter(id => id.startsWith(AGAIN_PREFIX))
            .filter(id => {
                const [, date, habitId] = id.split(':');
                const habit = habits.find(h => h.id === habitId);
                return (
                    !prefs.reminders ||
                    date !== today.date ||
                    !habit ||
                    !stillOpen({ kind: habit.kind, id: habitId }, today, habits)
                );
            });
        if (stale.length > 0) {
            await notifee.cancelTriggerNotifications(stale);
        }
        if (!prefs.reminders) {
            return;
        }
        await notifee.createChannel({ id: CHANNEL_ID, name: 'Day plan', importance: AndroidImportance.HIGH });

        const jobs: Promise<unknown>[] = [];
        dates.forEach((date, i) => {
            const day = days[i];
            for (const h of habits) {
                if (!isScheduled(h, date) || h.createdAt > day.date) {
                    continue;
                }
                const routine = h.kind === 'routine';
                const start = routine ? h.time : day.started[h.id];
                if (start === undefined || !stillOpen({ kind: h.kind, id: h.id }, day, habits)) {
                    continue;
                }
                const at = timestampOf(day.date, start + h.duration);
                if (at <= now.getTime()) {
                    continue;
                }
                const asks: Asks = { kind: h.kind, date: day.date, id: h.id, title: h.title, start };
                jobs.push(
                    notifee.createTriggerNotification(
                        notification(
                            `${ID_PREFIX}${day.date}:${h.id}`,
                            routine ? `${h.title}: finished?` : `${h.title}: done?`,
                            routine
                                ? `Tap Finished when it ends. If you don’t, the usual ${formatDuration(h.duration)} is counted.`
                                : 'You started it. Tap Done when it’s finished.',
                            asks,
                        ),
                        { type: TriggerType.TIMESTAMP, timestamp: at },
                    ),
                );
            }
        });
        await Promise.all(jobs);
    } catch (error) {
        logger.warn('Could not schedule plan reminders', error);
    }
};

/** Today's and tomorrow's calls, handed to PlanCalls.kt to ring. */
const writeCalls = async (
    habits: Habit[],
    todos: Todo[],
    days: DayPlan[],
    dates: Date[],
    hours: DayHours,
    now: number,
): Promise<void> => {
    const calls = dates.flatMap((date, i) => callsFor(habits, todos, days[i], date, hours, now));
    if (await writeJson(KEYS.planCalls, calls)) {
        await native?.schedule?.();
    }
};
