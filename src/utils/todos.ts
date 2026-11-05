/** Pure logic for to-dos: what comes next, postponing, steps. Storage is in storage/todos.ts. */
import { Todo, TodoStep } from '../types/types';
import { newId } from './dates';

/** After this many "Not now"s it has to be done, made smaller or dropped. */
export const POSTPONE_LIMIT = 3;

/** Finished and dropped to-dos kept for stats; older ones are removed. */
export const MAX_FINISHED = 300;

export const MAX_TITLE = 120;

const DAY_MS = 24 * 60 * 60 * 1000;

export const isOpen = (todo: Todo): boolean => !todo.doneAt && !todo.droppedAt;

/** The first open step, or undefined when the to-do itself is up. */
export const currentStep = (todo: Todo): TodoStep | undefined => todo.steps.find(s => !s.doneAt);

/** What to do right now: the open step, or the to-do itself. */
export const currentTitle = (todo: Todo): string => currentStep(todo)?.title ?? todo.title;

/** Put off today with "Not now"; it comes back tomorrow. */
export const isSnoozed = (todo: Todo, todayKey: string): boolean => !!todo.snoozedOn && todo.snoozedOn >= todayKey;

export const mustDecide = (todo: Todo): boolean => todo.postponed >= POSTPONE_LIMIT;

/**
 * The one thing up next: the most postponed first (it has waited longest in
 * your head), then the oldest. Snoozed ones wait until tomorrow.
 */
export const pickNext = (todos: Todo[], todayKey: string, quickOnly = false): Todo | null =>
    todos
        .filter(t => isOpen(t) && !isSnoozed(t, todayKey) && (!quickOnly || t.quick))
        .sort((a, b) => b.postponed - a.postponed || a.createdAt - b.createdAt)[0] ?? null;

/** Open to-dos, in the order they'll come up. */
export const openInOrder = (todos: Todo[], todayKey: string): Todo[] =>
    todos
        .filter(isOpen)
        .sort(
            (a, b) =>
                Number(isSnoozed(a, todayKey)) - Number(isSnoozed(b, todayKey)) ||
                b.postponed - a.postponed ||
                a.createdAt - b.createdAt,
        );

export const newTodo = (title: string, now: number): Todo => ({
    id: newId('t'),
    title: title.trim().slice(0, MAX_TITLE),
    createdAt: now,
    steps: [],
    postponed: 0,
});

export const newStep = (title: string): TodoStep => ({ id: newId('s'), title: title.trim().slice(0, MAX_TITLE) });

/** "Not now": counted, and out of the way until tomorrow. */
export const postpone = (todo: Todo, todayKey: string): Todo => ({
    ...todo,
    postponed: todo.postponed + 1,
    snoozedOn: todayKey,
});

/** The postpone count starts over (undefined keys drop out when stored). */
const fresh = (todo: Todo): Todo => ({ ...todo, postponed: 0, snoozedOn: undefined });

/** Finishes what's up: the open step, or the whole to-do once no steps are left. */
export const completeCurrent = (todo: Todo, now: number, minutes?: number): Todo => {
    const step = currentStep(todo);
    const took = minutes && minutes > 0 ? { minutes } : {};
    if (step) {
        return fresh({
            ...todo,
            steps: todo.steps.map(s => (s.id === step.id ? { ...s, doneAt: now, ...took } : s)),
        });
    }
    return { ...fresh(todo), doneAt: now, ...took };
};

/** Finishes the to-do and every step left, e.g. when it got done in one go. */
export const completeAll = (todo: Todo, now: number): Todo => ({
    ...fresh(todo),
    steps: todo.steps.map(s => (s.doneAt ? s : { ...s, doneAt: now })),
    doneAt: now,
});

/** A smaller first step goes in front of what's up, and the postpone count starts over. */
export const makeSmaller = (todo: Todo, stepTitle: string): Todo => {
    const at = todo.steps.findIndex(s => !s.doneAt);
    const steps = [...todo.steps];
    steps.splice(at < 0 ? steps.length : at, 0, newStep(stepTitle));
    return fresh({ ...todo, steps });
};

export const drop = (todo: Todo, now: number): Todo => ({ ...todo, droppedAt: now });

/** Steps and to-dos finished since `since` (epoch ms). */
export const doneSince = (todos: Todo[], since: number): number =>
    todos.reduce(
        (sum, t) =>
            sum + (t.doneAt && t.doneAt >= since ? 1 : 0) + t.steps.filter(s => s.doneAt && s.doneAt >= since).length,
        0,
    );

export const daysOld = (todo: Todo, now: number): number => Math.max(0, Math.floor((now - todo.createdAt) / DAY_MS));

/** "Added today", "Added 23 days ago · put off 4 times". */
export const describeAge = (todo: Todo, now: number): string => {
    const days = daysOld(todo, now);
    const age = days === 0 ? 'Added today' : days === 1 ? 'Added yesterday' : `Added ${days} days ago`;
    const put =
        todo.postponed === 0 ? '' : todo.postponed === 1 ? ' · put off once' : ` · put off ${todo.postponed} times`;
    return age + put;
};

/** "Step 2 of 4", or empty without steps. Counting the to-do itself as the last step. */
export const describeProgress = (todo: Todo): string => {
    if (todo.steps.length === 0) {
        return '';
    }
    const total = todo.steps.length + 1;
    const done = todo.steps.filter(s => s.doneAt).length;
    return `Step ${done + 1} of ${total}`;
};

/** Keeps every open to-do and the newest finished ones. */
export const pruneFinished = (todos: Todo[]): Todo[] => {
    const finished = todos
        .filter(t => !isOpen(t))
        .sort((a, b) => (b.doneAt ?? b.droppedAt ?? 0) - (a.doneAt ?? a.droppedAt ?? 0));
    if (finished.length <= MAX_FINISHED) {
        return todos;
    }
    const removed = new Set(finished.slice(MAX_FINISHED).map(t => t.id));
    return todos.filter(t => !removed.has(t.id));
};

/** The one extra day picked after a small task ran out of time. */
export const pickDay = (todo: Todo, dateKey: string): Todo => ({ ...fresh(todo), dueOn: dateKey });

/** Dropped, with the reason why (shown in the weekly review). */
export const dropWithReason = (todo: Todo, now: number, reason: string): Todo => ({
    ...todo,
    droppedAt: now,
    dropReason: reason.trim(),
});

/** Today's part of a big task is skipped, with the reason why. */
export const skipSlice = (todo: Todo, dateKey: string, reason: string): Todo => ({
    ...todo,
    skips: { ...todo.skips, [dateKey]: reason.trim() },
});

/** Adds minutes worked on a day (a big task with daily time). */
export const logTime = (todo: Todo, dateKey: string, minutes: number): Todo => ({
    ...todo,
    log: { ...todo.log, [dateKey]: Math.min(24 * 60, (todo.log?.[dateKey] ?? 0) + Math.max(0, Math.round(minutes))) },
});
