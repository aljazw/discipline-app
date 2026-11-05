import { DayPlan, Habit, Todo } from '../src/types/types';
import {
    MAX_OPEN_TASKS,
    callsFor,
    canAddTask,
    deadlineOf,
    describeDeadline,
    parseCallId,
    planToday,
    recentSkips,
    sliceDoneOn,
    timeOn,
    timeSummary,
} from '../src/utils/plan';
import { fromDateKey } from '../src/utils/dates';
import { guessKind, skipHabit, unskipHabit } from '../src/utils/habits';
import { dropWithReason, logTime, pickDay } from '../src/utils/todos';
import { habitTimesFromOrder } from '../src/utils/planService';

// 2026-11-04 is a Wednesday.
const WED = '2026-11-04';
const wed = fromDateKey(WED);
const at = (key: string, h: number, m = 0) => {
    const d = fromDateKey(key);
    d.setHours(h, m, 0, 0);
    return d.getTime();
};
const EVERY_DAY = [true, true, true, true, true, true, true];
const HOURS = { wake: '07:00', bedtime: '23:00' };

const habit = (over: Partial<Habit> = {}): Habit => ({
    id: 'h1',
    kind: 'habit',
    time: 18 * 60,
    title: 'Workout',
    icon: 'Dumbbell',
    days: EVERY_DAY,
    duration: 60,
    createdAt: '2026-10-01',
    completions: [],
    ...over,
});

const todo = (over: Partial<Todo> = {}): Todo => ({
    id: 't1',
    title: 'Call dentist',
    createdAt: at('2026-11-02', 10),
    steps: [],
    postponed: 0,
    ...over,
});

const day = (over: Partial<DayPlan> = {}): DayPlan => ({
    date: WED,
    order: [],
    oneOffs: [],
    finished: {},
    skipped: [],
    actual: {},
    started: {},
    snoozed: [],
    ...over,
});

describe('small tasks', () => {
    it('have three days, then are due, then late', () => {
        const t = todo(); // added Monday
        expect(deadlineOf(t)).toBe('2026-11-05');
        expect(describeDeadline(t, '2026-11-02')).toBe('3 days left');
        expect(describeDeadline(t, WED)).toBe('1 day left');
        expect(describeDeadline(t, '2026-11-05')).toBe('Due today');
        expect(describeDeadline(t, '2026-11-07')).toBe('2 days late');
    });

    it('can get one picked day', () => {
        expect(deadlineOf(pickDay(todo(), '2026-11-09'))).toBe('2026-11-09');
    });

    it('come up next while they have time, and are must-dos once out of it', () => {
        const fresh = todo({ id: 'fresh', createdAt: at(WED, 9) });
        const due = todo({ id: 'due', createdAt: at('2026-11-01', 9) });
        const plan = planToday([], [fresh, due], wed);
        expect(plan.upNext?.id).toBe('fresh');
        expect(plan.must.map(i => i.id)).toEqual(['due']);
    });

    it('"Not now" hides one for the day only', () => {
        const fresh = todo({ id: 'fresh', createdAt: at(WED, 9), snoozedOn: WED });
        expect(planToday([], [fresh], wed).upNext).toBeNull();
        expect(planToday([], [fresh], fromDateKey('2026-11-05')).upNext?.id).toBe('fresh');
    });

    it('are capped', () => {
        const many = Array.from({ length: MAX_OPEN_TASKS }, (_, i) => todo({ id: `t${i}` }));
        expect(canAddTask(many)).toBe(false);
        expect(canAddTask([...many.slice(1), dropWithReason(many[0], at(WED, 9), 'not needed')])).toBe(true);
    });
});

describe('big tasks', () => {
    it('with time: today is done once its minutes are in', () => {
        const t = todo({ big: { days: EVERY_DAY, minutes: 50 } });
        expect(planToday([], [t], wed).must.map(i => i.kind)).toEqual(['slice']);
        const worked = logTime(logTime(t, WED, 30), WED, 25);
        expect(sliceDoneOn(worked, WED)).toBe(true);
        expect(planToday([], [worked], wed).finished.map(i => i.kind)).toEqual(['slice']);
    });

    it('with steps: today is done once a step is', () => {
        const t = todo({
            big: { days: EVERY_DAY },
            steps: [
                { id: 's1', title: 'Login screen', doneAt: at(WED, 11) },
                { id: 's2', title: 'Home screen' },
            ],
        });
        expect(sliceDoneOn(t, WED)).toBe(true);
        expect(sliceDoneOn(t, '2026-11-05')).toBe(false);
    });

    it('only on their days', () => {
        const t = todo({ big: { days: [false, false, false, false, true, false, false] } }); // Fridays
        expect(planToday([], [t], wed).must).toEqual([]);
    });
});

describe('habits', () => {
    it('are must-dos by time; done and skipped ones move down', () => {
        const a = habit({ id: 'a', time: 19 * 60 });
        const b = habit({ id: 'b', time: 7 * 60 });
        const done = habit({ id: 'd', completions: [WED] });
        const skipped = skipHabit(habit({ id: 's' }), WED, 'sick');
        const plan = planToday([a, b, done, skipped, habit({ id: 'r', kind: 'routine' })], [], wed);
        expect(plan.must.map(i => i.id)).toEqual(['b', 'a']);
        expect(plan.finished.map(i => i.id).sort()).toEqual(['d', 's']);
        expect(unskipHabit(skipped, WED).skips).toBeUndefined();
    });

    it('guess their kind from old data', () => {
        expect(guessKind('Workout')).toBe('habit');
        expect(guessKind('Lunch')).toBe('routine');
        expect(guessKind('Swim', 'workout')).toBe('habit');
    });

    it('get times from the old order of the day', () => {
        const [first, second] = habitTimesFromOrder(
            [habit({ id: 'a', duration: 30 }), habit({ id: 'b', duration: 60 })],
            7 * 60,
        );
        expect(first.time).toBe(7 * 60);
        expect(second.time).toBe(7 * 60 + 30);
    });
});

describe('calls', () => {
    it('ring at a habit’s time and every 30 minutes until bedtime', () => {
        const calls = callsFor([habit({ time: 21 * 60 })], [], day(), wed, HOURS, at(WED, 8));
        expect(calls.map(c => new Date(c.at).getHours() * 60 + new Date(c.at).getMinutes())).toEqual([
            21 * 60,
            21 * 60 + 30,
            22 * 60,
            22 * 60 + 30,
        ]);
        expect(parseCallId(calls[0].id)).toEqual({ kind: 'habit', date: WED, habitId: 'h1' });
    });

    it('stop once a habit is done, skipped or started', () => {
        const h = habit();
        expect(callsFor([{ ...h, completions: [WED] }], [], day(), wed, HOURS, at(WED, 8))).toEqual([]);
        expect(callsFor([skipHabit(h, WED, 'ill')], [], day(), wed, HOURS, at(WED, 8))).toEqual([]);
        expect(callsFor([h], [], day({ started: { h1: 18 * 60 } }), wed, HOURS, at(WED, 8))).toEqual([]);
    });

    it('only those still to come', () => {
        expect(callsFor([habit()], [], day(), wed, HOURS, at(WED, 22, 10)).length).toBe(1);
    });

    it('call in the evening about tasks out of time', () => {
        const calls = callsFor([], [todo({ createdAt: at('2026-10-30', 9) })], day(), wed, HOURS, at(WED, 8));
        expect(calls[0].id).toBe(`tasks:${WED}:0`);
        expect(new Date(calls[0].at).getHours()).toBe(20);
        expect(calls[0].body).toBe('Call dentist');
        expect(parseCallId(calls[0].id)).toEqual({ kind: 'tasks', date: WED });
    });

    it('never for routines', () => {
        expect(callsFor([habit({ kind: 'routine' })], [], day(), wed, HOURS, at(WED, 8))).toEqual([]);
    });
});

describe('time', () => {
    const work = habit({ id: 'w', kind: 'routine', title: 'Work', time: 8 * 60, duration: 8 * 60 });

    it('counts routines at their usual length until told otherwise', () => {
        expect(timeOn([work], [], day(), wed)[0]).toMatchObject({ minutes: 480, estimated: true, start: 480 });
        expect(timeOn([work], [], day({ actual: { w: 540 } }), wed)[0]).toMatchObject({ minutes: 540, estimated: false });
        expect(timeOn([work], [], day({ skipped: ['w'] }), wed)).toEqual([]);
    });

    it('adds done habits and time on tasks', () => {
        const entries = timeOn(
            [habit({ completions: [WED] })],
            [logTime(todo({ big: { days: EVERY_DAY, minutes: 50 } }), WED, 40)],
            day(),
            wed,
        );
        expect(entries.map(e => [e.kind, e.minutes])).toEqual([
            ['habit', 60],
            ['task', 40],
        ]);
    });

    it('sums the week, today only for routines that ended', () => {
        const rows = timeSummary([work], [], () => day(), wed, 12 * 60, 3);
        expect(rows).toEqual([{ label: 'Work', kind: 'routine', minutes: 2 * 480 }]);
    });
});

it('collects the week’s reasons for skipping and dropping', () => {
    const notes = recentSkips(
        [skipHabit(habit(), WED, 'tired')],
        [dropWithReason(todo(), at(WED, 9), 'not needed')],
        wed,
    );
    expect(notes.map(n => n.reason).sort()).toEqual(['not needed', 'tired']);
});
