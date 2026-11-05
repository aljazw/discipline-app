import { Habit } from '../src/types/types';
import {
    bestStreak,
    completionRate,
    currentStreak,
    fromDateKey,
    milestoneFor,
    recentDays,
    routineStreak,
    toDateKey,
    toggleCompletion,
} from '../src/utils/habits';

// 2026-10-07 is a Wednesday.
const WED = fromDateKey('2026-10-07');
const EVERY_DAY = [true, true, true, true, true, true, true];
const WEEKDAYS = [true, true, true, true, true, false, false];

const habit = (over: Partial<Habit> = {}): Habit => ({
    id: 'h1',
    kind: 'habit',
    time: 9 * 60,
    title: 'Workout',
    icon: 'Dumbbell',
    days: EVERY_DAY,
    duration: 15,
    createdAt: '2026-09-01',
    completions: [],
    ...over,
});

describe('date keys', () => {
    it('round-trips local dates', () => {
        expect(toDateKey(fromDateKey('2026-03-29'))).toBe('2026-03-29');
        expect(toDateKey(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
    });
});

describe('currentStreak', () => {
    it('counts consecutive completed days including today', () => {
        const h = habit({ completions: ['2026-10-05', '2026-10-06', '2026-10-07'] });
        expect(currentStreak(h, WED)).toBe(3);
    });

    it('keeps the streak while today is still pending', () => {
        const h = habit({ completions: ['2026-10-05', '2026-10-06'] });
        expect(currentStreak(h, WED)).toBe(2);
    });

    it('breaks on a missed past day', () => {
        const h = habit({ completions: ['2026-10-04', '2026-10-06'] });
        expect(currentStreak(h, WED)).toBe(1);
    });

    it('skips days the habit is not due', () => {
        // Weekdays only: Fri 2, (Sat 3, Sun 4 skipped), Mon 5, Tue 6, Wed 7
        const h = habit({ days: WEEKDAYS, completions: ['2026-10-02', '2026-10-05', '2026-10-06', '2026-10-07'] });
        expect(currentStreak(h, WED)).toBe(4);
    });

    it('never counts before the habit was created', () => {
        const h = habit({ createdAt: '2026-10-06', completions: ['2026-10-01', '2026-10-06', '2026-10-07'] });
        expect(currentStreak(h, WED)).toBe(2);
    });

    it('is zero with no due days', () => {
        expect(currentStreak(habit({ days: Array(7).fill(false), completions: ['2026-10-07'] }), WED)).toBe(0);
    });
});

describe('bestStreak', () => {
    it('finds the longest run', () => {
        const h = habit({
            completions: ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-06', '2026-10-07'],
        });
        expect(bestStreak(h, WED)).toBe(4);
    });

    it('does not end a run because today is unfinished', () => {
        const h = habit({ createdAt: '2026-10-05', completions: ['2026-10-05', '2026-10-06'] });
        expect(bestStreak(h, WED)).toBe(2);
    });
});

describe('toggleCompletion', () => {
    it('checks and unchecks a day', () => {
        const once = toggleCompletion(habit(), WED);
        expect(once.completions).toEqual(['2026-10-07']);
        expect(toggleCompletion(once, WED).completions).toEqual([]);
    });
});

describe('recentDays & completionRate', () => {
    it('marks the last 7 days', () => {
        const days = recentDays(habit({ completions: ['2026-10-07'] }), 7, WED);
        expect(days).toHaveLength(7);
        expect(days[6]).toMatchObject({ key: '2026-10-07', isToday: true, done: true, label: 'W' });
        expect(days[0].key).toBe('2026-10-01');
    });

    it('does not count an unfinished today against you', () => {
        // Due 7 days, done 6 of the 6 past days, today pending.
        const done = ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06'];
        expect(completionRate([habit({ completions: done })], 7, WED)).toBe(1);
        expect(completionRate([], 7, WED)).toBeNull();
    });
});

describe('milestoneFor', () => {
    it('only fires on milestone days', () => {
        expect(milestoneFor(7)).toBe(7);
        expect(milestoneFor(8)).toBeNull();
    });
});

describe('describeHabitDays', () => {
    // Imported here to keep the main suite focused on streak maths.
    const { describeHabitDays } = require('../src/utils/habitText');

    it('names common day sets', () => {
        expect(describeHabitDays(EVERY_DAY)).toBe('Every day');
        expect(describeHabitDays(WEEKDAYS)).toBe('Weekdays');
        expect(describeHabitDays([false, false, false, false, false, true, true])).toBe('Weekends');
        expect(describeHabitDays([true, false, true, false, false, false, false])).toBe('Mon, Wed');
        expect(describeHabitDays(Array(7).fill(false))).toBe('No days');
    });
});

describe('markDone', () => {
    const { markDone } = require('../src/utils/habits');
    const day = new Date(2026, 9, 8, 12);

    it('checks the day off once and never unchecks it', () => {
        const once = markDone(habit(), day);
        expect(once.completions).toEqual(['2026-10-08']);
        expect(markDone(once, day).completions).toEqual(['2026-10-08']);
    });
});

describe('routineStreak', () => {
    const a = (completions: string[], over: Partial<Habit> = {}) => habit({ id: 'a', completions, ...over });
    const b = (completions: string[], over: Partial<Habit> = {}) => habit({ id: 'b', completions, ...over });

    it('counts days on which every due task was done', () => {
        const habits = [a(['2026-10-05', '2026-10-06', '2026-10-07']), b(['2026-10-06', '2026-10-07'])];
        expect(routineStreak(habits, WED)).toBe(2);
    });

    it('leaves an unfinished today pending', () => {
        const habits = [a(['2026-10-05', '2026-10-06', '2026-10-07']), b(['2026-10-05', '2026-10-06'])];
        expect(routineStreak(habits, WED)).toBe(2);
    });

    it('skips days a task is not due and days before it existed', () => {
        // b is weekdays only and new since Monday; the weekend only needs a.
        const habits = [
            a(['2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06']),
            b(['2026-10-05', '2026-10-06'], { days: WEEKDAYS, createdAt: '2026-10-05' }),
        ];
        expect(routineStreak(habits, WED)).toBe(4);
    });

    it('is zero without tracked tasks', () => {
        expect(routineStreak([], WED)).toBe(0);
        expect(routineStreak([a([], { days: [false, false, false, false, false, false, false] })], WED)).toBe(0);
    });
});
