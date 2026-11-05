import { DayPlan, Habit } from '../src/types/types';
import {
    PlanTask,
    anchorsOf,
    dayTasks,
    formatDuration,
    formatMinutes,
    laterOrder,
    mergeOrder,
    motivationFor,
    orderWith,
    paceOf,
    parseMinutes,
    routineFromLegacy,
    scheduleDay,
    starterRoutine,
} from '../src/utils/dayPlan';

// 2026-10-10 is a Saturday.
const SAT = '2026-10-10';
const EVERY_DAY = [true, true, true, true, true, true, true];
const WEEKDAYS = [true, true, true, true, true, false, false];
const ANCHORS = { wake: 7 * 60, bed: 23 * 60 };

const habit = (id: string, duration: number, over: Partial<Habit> = {}): Habit => ({
    id,
    kind: 'habit',
    time: 9 * 60,
    title: id,
    icon: 'Target',
    days: EVERY_DAY,
    duration,
    createdAt: '2026-09-01',
    completions: [],
    ...over,
});

const day = (over: Partial<DayPlan> = {}): DayPlan => ({
    date: SAT,
    order: [],
    oneOffs: [],
    finished: {},
    actual: {},
    started: {},
    snoozed: [],
    skipped: [],
    ...over,
});

const task = (id: string, duration: number, over: Partial<PlanTask> = {}): PlanTask => ({
    id,
    title: id,
    icon: 'Target',
    duration,
    status: 'open',
    ...over,
});

const times = (tasks: PlanTask[], now: number | null) =>
    scheduleDay(tasks, ANCHORS, now).slots.map(s => `${s.task.id} ${formatMinutes(s.start)}-${formatMinutes(s.end)}`);

describe('time helpers', () => {
    it('formats and parses clock times', () => {
        expect(formatMinutes(450)).toBe('07:30');
        expect(formatMinutes(1500)).toBe('01:00');
        expect(parseMinutes('07:30')).toBe(450);
        expect(parseMinutes('24:00')).toBeNull();
    });

    it('formats durations', () => {
        expect(formatDuration(45)).toBe('45 min');
        expect(formatDuration(60)).toBe('1 h');
        expect(formatDuration(90)).toBe('1 h 30 min');
    });

    it('puts a bedtime after midnight on the next day', () => {
        expect(anchorsOf({ wake: '07:00', bedtime: '23:00' })).toEqual({ wake: 420, bed: 1380 });
        expect(anchorsOf({ wake: '07:00', bedtime: '00:30' })).toEqual({ wake: 420, bed: 1470 });
    });
});

describe('dayTasks', () => {
    it('lists the routine due that day, in routine order, then one-offs', () => {
        const habits = [habit('a', 30), habit('work', 60, { days: WEEKDAYS }), habit('b', 15)];
        const tasks = dayTasks(day({ oneOffs: [{ id: 'x', title: 'x', icon: 'Target', duration: 20 }] }), habits);
        expect(tasks.map(t => t.id)).toEqual(['a', 'b', 'x']);
    });

    it('leaves out tasks created after the day', () => {
        const tasks = dayTasks(day(), [habit('new', 30, { createdAt: '2026-10-11' })]);
        expect(tasks).toEqual([]);
    });

    it('marks done, skipped and finish times', () => {
        const habits = [habit('a', 30, { completions: [SAT] }), habit('b', 30)];
        const tasks = dayTasks(day({ finished: { a: 480 }, skipped: ['b'] }), habits);
        expect(tasks.map(t => [t.id, t.status, t.finishedAt])).toEqual([
            ['a', 'done', 480],
            ['b', 'skipped', undefined],
        ]);
    });

    it('follows the day’s own order', () => {
        const tasks = dayTasks(day({ order: ['b', 'a'] }), [habit('a', 30), habit('b', 30)]);
        expect(tasks.map(t => t.id)).toEqual(['b', 'a']);
    });
});

describe('mergeOrder', () => {
    it('keeps a task missing from the order next to the one before it', () => {
        expect(mergeOrder(['a', 'b', 'c'], ['c', 'a'])).toEqual(['c', 'a', 'b']);
        expect(mergeOrder(['new', 'a'], ['a'])).toEqual(['new', 'a']);
    });

    it('drops ids that no longer exist', () => {
        expect(mergeOrder(['a'], ['gone', 'a'])).toEqual(['a']);
    });
});

describe('scheduleDay', () => {
    it('lines tasks up from wake-up for another day', () => {
        expect(times([task('a', 30), task('b', 60)], null)).toEqual(['a 07:00-07:30', 'b 07:30-08:30']);
    });

    it('starts the current task when the last one was finished', () => {
        const tasks = [task('a', 30, { status: 'done', finishedAt: 500 }), task('b', 60), task('c', 30)];
        expect(times(tasks, 510)).toEqual(['a 07:50-08:20', 'b 08:20-09:20', 'c 09:20-09:50']);
    });

    it('lets a task that runs long push the rest back', () => {
        const tasks = [task('a', 30), task('b', 30)];
        const schedule = scheduleDay(tasks, ANCHORS, 8 * 60 + 15);
        expect(schedule.current?.task.id).toBe('a');
        expect(schedule.slots.map(s => s.end)).toEqual([495, 525]);
        expect(schedule.behind).toBe(45);
        expect(paceOf(schedule.behind)).toEqual({ kind: 'behind', minutes: 45 });
    });

    it('counts finishing early as ahead', () => {
        const tasks = [task('a', 60, { status: 'done', finishedAt: 450 }), task('b', 30)];
        expect(paceOf(scheduleDay(tasks, ANCHORS, 450).behind)).toEqual({ kind: 'ahead', minutes: 30 });
    });

    it('takes skipped tasks out of the timing', () => {
        const tasks = [task('a', 120, { status: 'skipped' }), task('b', 30)];
        expect(times(tasks, null)).toEqual(['a 07:00-07:00', 'b 07:00-07:30']);
    });

    it('flags tasks that won’t fit before bedtime', () => {
        const tasks = [task('long', 15 * 60 + 30), task('read', 60), task('walk', 30)];
        expect(scheduleDay(tasks, ANCHORS, null).overflow.map(t => t.id)).toEqual(['read', 'walk']);
    });

    it('has no current task once everything is done', () => {
        const schedule = scheduleDay([task('a', 30, { status: 'done', finishedAt: 450 })], ANCHORS, 600);
        expect(schedule.current).toBeNull();
        expect(schedule.behind).toBeNull();
    });
});

describe('changing the order', () => {
    const tasks = [task('a', 30), task('b', 30, { status: 'done' }), task('c', 30), task('d', 30)];

    it('moves a task behind the next open one', () => {
        expect(laterOrder(tasks, 'a')).toEqual(['b', 'c', 'a', 'd']);
        expect(laterOrder(tasks, 'd')).toEqual(['a', 'b', 'c', 'd']);
    });

    it('places a task after another one, or first', () => {
        expect(orderWith(tasks, 'x', 'a')).toEqual(['a', 'x', 'b', 'c', 'd']);
        expect(orderWith(tasks, 'x', null)).toEqual(['x', 'a', 'b', 'c', 'd']);
    });
});

describe('starting a routine', () => {
    it('creates editable routine tasks', () => {
        let n = 0;
        const routine = starterRoutine(new Date(2026, 9, 10), () => `h${n++}`);
        expect(routine.length).toBeGreaterThan(5);
        expect(routine.every(h => h.duration > 0 && h.createdAt === SAT)).toBe(true);
    });

    it('turns old time windows into routine tasks in time order', () => {
        let n = 0;
        const habits = [habit('gym', 15), habit('other', 15)];
        const routine = routineFromLegacy(
            [
                { title: 'Lunch', icon: 'Meal', start: 720, end: 765 },
                { title: 'Dentist', icon: 'Target', start: 600, end: 660, once: true },
                { title: 'gym', icon: 'Dumbbell', start: 1080, end: 1140, habitId: 'gym' },
                { title: 'Breakfast', icon: 'Meal', start: 480, end: 510 },
            ],
            habits,
            new Date(2026, 9, 10),
            () => `new${n++}`,
        );
        expect(routine.map(h => [h.title, h.duration])).toEqual([
            ['Breakfast', 30],
            ['Lunch', 45],
            ['gym', 60],
            ['other', 15],
        ]);
    });
});

describe('motivationFor', () => {
    it('is stable for the same seed', () => {
        expect(motivationFor('x')).toBe(motivationFor('x'));
    });
});
