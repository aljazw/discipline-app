/**
 * Pure logic for the plan: what must be done today, task deadlines, when the
 * app calls you, and where the time went. Three kinds of things:
 *   - tasks (one-time; small ones have TASK_DAYS, big ones a slice a day),
 *   - habits (on set days; they call you, and skipping costs a video and a reason),
 *   - routines (only counted for time).
 */
import { DayHours, DayPlan, Habit, Todo } from '../types/types';
import { addDays, fromDateKey, toDateKey, weekdayIndex } from './dates';
import { isScheduled } from './habits';
import { currentStep, isOpen } from './todos';
import { DAY_MINUTES, parseMinutes, timestampOf } from './dayPlan';

/** A small task must be done within this many days of adding it. */
export const TASK_DAYS = 3;
/** More open tasks than this and nothing new goes in until one is finished or dropped. */
export const MAX_OPEN_TASKS = 10;
/** An undecided call comes back this often (minutes). */
export const CALL_EVERY = 30;
/** Tasks out of time call this long before bedtime (minutes). */
export const TASKS_CALL_BEFORE_BED = 3 * 60;
/** At most this many repeats of one call a day. */
const MAX_REPEATS = 16;

const DAY_MS = 24 * 60 * 60 * 1000;

const keyOf = (epoch: number) => toDateKey(new Date(epoch));

/** Whole days from `from` to `to` (date keys); negative when `to` is earlier. */
export const daysBetween = (from: string, to: string): number =>
    Math.round((fromDateKey(to).getTime() - fromDateKey(from).getTime()) / DAY_MS);

// ---- Tasks --------------------------------------------------------------------

export const isBig = (todo: Todo): boolean => !!todo.big;

/** A small task's last day: the day picked for it, or TASK_DAYS after it was added. */
export const deadlineOf = (todo: Todo): string =>
    todo.dueOn ?? toDateKey(addDays(fromDateKey(keyOf(todo.createdAt)), TASK_DAYS));

/** Days until a small task's deadline: 0 on the day, negative once late. */
export const daysLeft = (todo: Todo, todayKey: string): number => daysBetween(todayKey, deadlineOf(todo));

/** "3 days left", "Due today", "1 day late". */
export const describeDeadline = (todo: Todo, todayKey: string): string => {
    const left = daysLeft(todo, todayKey);
    if (left > 0) {
        return left === 1 ? '1 day left' : `${left} days left`;
    }
    if (left === 0) {
        return 'Due today';
    }
    return left === -1 ? '1 day late' : `${-left} days late`;
};

export const openTasks = (todos: Todo[]): Todo[] => todos.filter(isOpen);

export const canAddTask = (todos: Todo[]): boolean => openTasks(todos).length < MAX_OPEN_TASKS;

/** Minutes worked on a big task on a day. */
export const workedOn = (todo: Todo, dateKey: string): number => todo.log?.[dateKey] ?? 0;

/** Whether today's part of a big task is done: its time, or a step (or the whole thing) finished that day. */
export const sliceDoneOn = (todo: Todo, dateKey: string): boolean => {
    if (todo.big?.minutes) {
        return workedOn(todo, dateKey) >= todo.big.minutes || (!!todo.doneAt && keyOf(todo.doneAt) === dateKey);
    }
    return (
        todo.steps.some(s => s.doneAt && keyOf(s.doneAt) === dateKey) ||
        (!!todo.doneAt && keyOf(todo.doneAt) === dateKey)
    );
};

/** A big task has a part to do on this day: one of its days, since it was added. */
export const sliceDueOn = (todo: Todo, date: Date): boolean =>
    !!todo.big &&
    todo.big.days[weekdayIndex(date)] === true &&
    keyOf(todo.createdAt) <= toDateKey(date) &&
    (isOpen(todo) || sliceDoneOn(todo, toDateKey(date)));

/** "Step 2 of 5", or "20 of 50 min" for a timed one on that day. */
export const describeSlice = (todo: Todo, dateKey: string): string => {
    if (todo.big?.minutes) {
        return `${Math.min(workedOn(todo, dateKey), todo.big.minutes)} of ${todo.big.minutes} min`;
    }
    const total = todo.steps.length + 1;
    const done = todo.steps.filter(s => s.doneAt).length;
    return todo.steps.length > 0 ? `Step ${Math.min(done + 1, total)} of ${total}` : 'Last step';
};

/** What to work on now: the open step, or the task itself. */
export const sliceTitle = (todo: Todo): string => (todo.big?.minutes ? todo.title : currentStep(todo)?.title ?? todo.title);

// ---- Today --------------------------------------------------------------------

export type ItemState = 'open' | 'done' | 'skipped';

export type TodayItem =
    | { kind: 'habit'; id: string; habit: Habit; state: ItemState }
    | { kind: 'slice'; id: string; todo: Todo; state: ItemState }
    /** A small task out of time (late = days past its deadline, 0 on the day), or finished that day. */
    | { kind: 'task'; id: string; todo: Todo; state: 'open' | 'done'; late: number };

export interface TodayPlan {
    /** Still to do today, in order: habits by time, big tasks, then tasks out of time. */
    must: TodayItem[];
    /** Done or skipped today. */
    finished: TodayItem[];
    /** The small task that has waited longest and still has time. */
    upNext: Todo | null;
    /** Other small tasks that still have time. */
    waiting: number;
}

/** A habit that's due on the day (added by then). */
export const habitDueOn = (habit: Habit, date: Date): boolean =>
    habit.kind === 'habit' && isScheduled(habit, date) && habit.createdAt <= toDateKey(date);

export const habitState = (habit: Habit, dateKey: string): ItemState =>
    habit.completions.includes(dateKey) ? 'done' : habit.skips?.[dateKey] ? 'skipped' : 'open';

export const sliceState = (todo: Todo, dateKey: string): ItemState =>
    sliceDoneOn(todo, dateKey) ? 'done' : todo.skips?.[dateKey] ? 'skipped' : 'open';

/** Small tasks that still have time, the one that has waited longest first; put off ones last. */
export const waitingTasks = (todos: Todo[], todayKey: string): Todo[] =>
    todos
        .filter(t => isOpen(t) && !t.big && daysLeft(t, todayKey) > 0)
        .sort(
            (a, b) =>
                Number(!!a.snoozedOn && a.snoozedOn >= todayKey) - Number(!!b.snoozedOn && b.snoozedOn >= todayKey) ||
                a.createdAt - b.createdAt,
        );

export const planToday = (habits: Habit[], todos: Todo[], date: Date): TodayPlan => {
    const key = toDateKey(date);
    const items: TodayItem[] = [];

    habits
        .filter(h => habitDueOn(h, date))
        .sort((a, b) => a.time - b.time)
        .forEach(habit => items.push({ kind: 'habit', id: habit.id, habit, state: habitState(habit, key) }));
    todos
        .filter(t => sliceDueOn(t, date))
        .forEach(todo => items.push({ kind: 'slice', id: todo.id, todo, state: sliceState(todo, key) }));
    todos
        .filter(t => !t.big && isOpen(t) && daysLeft(t, key) <= 0)
        .sort((a, b) => daysLeft(a, key) - daysLeft(b, key) || a.createdAt - b.createdAt)
        .forEach(todo => items.push({ kind: 'task', id: todo.id, todo, state: 'open', late: -daysLeft(todo, key) }));
    todos
        .filter(t => !t.big && t.doneAt && keyOf(t.doneAt) === key)
        .forEach(todo => items.push({ kind: 'task', id: todo.id, todo, state: 'done', late: 0 }));

    const waiting = waitingTasks(todos, key);
    const fresh = waiting.filter(t => !(t.snoozedOn && t.snoozedOn >= key));
    return {
        must: items.filter(i => i.state === 'open'),
        finished: items.filter(i => i.state !== 'open'),
        upNext: fresh[0] ?? null,
        waiting: waiting.length - (fresh[0] ? 1 : 0),
    };
};

// ---- Calls --------------------------------------------------------------------

export interface PlanCall {
    /** "habit:<date>:<habitId>:<n>" or "tasks:<date>:<n>". */
    id: string;
    /** Epoch ms. */
    at: number;
    title: string;
    body: string;
}

export type CallTarget = { kind: 'habit'; date: string; habitId: string } | { kind: 'tasks'; date: string };

export const parseCallId = (id: string): CallTarget | null => {
    const parts = id.split(':');
    if (parts[0] === 'habit' && parts.length === 4) {
        return { kind: 'habit', date: parts[1], habitId: parts[2] };
    }
    if (parts[0] === 'tasks' && parts.length === 3) {
        return { kind: 'tasks', date: parts[1] };
    }
    return null;
};

/** The key a call is snoozed under for the day: one "In 30 min" per habit, one for tasks. */
export const snoozeKey = (target: CallTarget): string => (target.kind === 'habit' ? target.habitId : 'tasks');

/** Wake-up and bedtime of the day in minutes after midnight; bedtime past midnight runs over 1440. */
export const dayBounds = (hours: DayHours): { wake: number; bed: number } => {
    const wake = parseMinutes(hours.wake) ?? 7 * 60;
    let bed = parseMinutes(hours.bedtime) ?? 23 * 60;
    if (bed <= wake) {
        bed += DAY_MINUTES;
    }
    return { wake, bed };
};

const repeats = (from: number, until: number): number[] => {
    const out: number[] = [];
    for (let t = from; t < until && out.length < MAX_REPEATS; t += CALL_EVERY) {
        out.push(t);
    }
    return out;
};

const DEFAULT_WHY = 'You planned this for today. Keep your word.';

/**
 * Every call of one day still to come after `now`: each open habit at its
 * time, then every CALL_EVERY minutes until bedtime; and, when tasks are out
 * of time or a big task's part is open, one in the evening that repeats too.
 * A habit started from its call stops calling.
 */
export const callsFor = (
    habits: Habit[],
    todos: Todo[],
    day: DayPlan,
    date: Date,
    hours: DayHours,
    now: number,
): PlanCall[] => {
    const key = toDateKey(date);
    const { bed } = dayBounds(hours);
    const plan = planToday(habits, todos, date);
    const calls: PlanCall[] = [];

    for (const item of plan.must) {
        if (item.kind !== 'habit' || day.started[item.habit.id] !== undefined) {
            continue;
        }
        const { habit } = item;
        repeats(habit.time, bed).forEach((minute, n) =>
            calls.push({
                id: `habit:${key}:${habit.id}:${n}`,
                at: timestampOf(key, minute),
                title: n === 0 ? `${habit.title} · now` : `${habit.title} is still waiting`,
                body: habit.why ? `“${habit.why}”` : DEFAULT_WHY,
            }),
        );
    }

    const tasks = plan.must.filter(i => i.kind !== 'habit');
    if (tasks.length > 0) {
        const titles = tasks.map(i => (i.kind === 'slice' ? sliceTitle(i.todo) : i.kind === 'task' ? i.todo.title : ''));
        const from = Math.max(bed - TASKS_CALL_BEFORE_BED, 0);
        repeats(from, bed - CALL_EVERY + 1).forEach((minute, n) =>
            calls.push({
                id: `tasks:${key}:${n}`,
                at: timestampOf(key, minute),
                title: tasks.length === 1 ? 'One thing is out of time' : `${tasks.length} things are out of time`,
                body: titles.slice(0, 3).join(' · ') + (titles.length > 3 ? ` · +${titles.length - 3}` : ''),
            }),
        );
    }
    return calls.filter(c => c.at > now).sort((a, b) => a.at - b.at);
};

// ---- Time -----------------------------------------------------------------------

export interface TimeEntry {
    id: string;
    title: string;
    kind: 'routine' | 'habit' | 'task';
    minutes: number;
    /** Minutes after midnight, for routines. */
    start?: number;
    /** A routine's usual length, not told how long it really took. */
    estimated: boolean;
}

/** Routines of a day (minus the ones that didn't happen), done habits and time on tasks. */
export const timeOn = (habits: Habit[], todos: Todo[], day: DayPlan, date: Date): TimeEntry[] => {
    const key = toDateKey(date);
    const entries: TimeEntry[] = [];
    for (const h of habits) {
        if (h.kind === 'routine' && isScheduled(h, date) && h.createdAt <= key && !day.skipped.includes(h.id)) {
            const actual = day.actual[h.id];
            entries.push({
                id: h.id,
                title: h.title,
                kind: 'routine',
                minutes: actual ?? h.duration,
                start: h.time,
                estimated: actual === undefined,
            });
        } else if (h.kind === 'habit' && h.completions.includes(key)) {
            entries.push({ id: h.id, title: h.title, kind: 'habit', minutes: h.duration, estimated: false });
        }
    }
    for (const t of todos) {
        const minutes =
            workedOn(t, key) +
            t.steps.reduce((sum, s) => sum + (s.doneAt && keyOf(s.doneAt) === key ? s.minutes ?? 0 : 0), 0) +
            (t.doneAt && keyOf(t.doneAt) === key ? t.minutes ?? 0 : 0);
        if (minutes > 0) {
            entries.push({ id: t.id, title: t.title, kind: 'task', minutes, estimated: false });
        }
    }
    return entries.sort((a, b) => (a.start ?? DAY_MINUTES) - (b.start ?? DAY_MINUTES));
};

export interface TimeRow {
    label: string;
    kind: TimeEntry['kind'];
    minutes: number;
}

/**
 * Where the time went over `days` days up to `today`: each routine by name,
 * then habits and tasks as two totals; biggest first. Today counts only the
 * routines that have ended by `nowMinutes`.
 */
export const timeSummary = (
    habits: Habit[],
    todos: Todo[],
    dayOf: (key: string) => DayPlan,
    today: Date,
    nowMinutes: number,
    days = 7,
): TimeRow[] => {
    const totals = new Map<string, TimeRow>();
    const add = (label: string, kind: TimeEntry['kind'], minutes: number) => {
        const k = `${kind}:${label}`;
        const row = totals.get(k) ?? { label, kind, minutes: 0 };
        row.minutes += minutes;
        totals.set(k, row);
    };
    for (let i = 0; i < days; i++) {
        const date = addDays(today, -i);
        for (const e of timeOn(habits, todos, dayOf(toDateKey(date)), date)) {
            if (i === 0 && e.kind === 'routine' && (e.start ?? 0) + e.minutes > nowMinutes) {
                continue;
            }
            if (e.kind === 'routine') {
                add(e.title, 'routine', e.minutes);
            } else {
                add(e.kind === 'habit' ? 'Habits' : 'Tasks', e.kind, e.minutes);
            }
        }
    }
    return [...totals.values()].filter(r => r.minutes > 0).sort((a, b) => b.minutes - a.minutes);
};

// ---- Skips ------------------------------------------------------------------------

export interface SkipNote {
    date: string;
    title: string;
    reason: string;
}

/** Every reason typed for skipping in the last `days` days, newest first. */
export const recentSkips = (habits: Habit[], todos: Todo[], today: Date, days = 7): SkipNote[] => {
    const from = toDateKey(addDays(today, -(days - 1)));
    const notes: SkipNote[] = [];
    const collect = (title: string, skips?: Record<string, string>) =>
        Object.entries(skips ?? {}).forEach(([date, reason]) => {
            if (date >= from) {
                notes.push({ date, title, reason });
            }
        });
    habits.forEach(h => collect(h.title, h.skips));
    todos.forEach(t => collect(t.title, t.skips));
    todos.forEach(t => {
        if (t.droppedAt && t.dropReason && keyOf(t.droppedAt) >= from) {
            notes.push({ date: keyOf(t.droppedAt), title: `Dropped: ${t.title}`, reason: t.dropReason });
        }
    });
    return notes.sort((a, b) => b.date.localeCompare(a.date));
};
