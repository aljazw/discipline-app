jest.mock('react-native', () => {
    const store = new Map<string, string>();
    return {
        NativeModules: {
            SharedStorage: {
                store,
                getItem: jest.fn(async (key: string) => store.get(key) ?? null),
                setItem: jest.fn(async (key: string, value: string) => {
                    store.set(key, value);
                    return true;
                }),
            },
        },
    };
});
jest.mock('../src/components/Icon', () => ({ isIconName: (v: unknown) => typeof v === 'string' }));

import { Todo } from '../src/types/types';
import { getTodos, saveTodo, updateTodo } from '../src/storage';
import {
    MAX_FINISHED,
    POSTPONE_LIMIT,
    completeAll,
    completeCurrent,
    currentTitle,
    describeAge,
    describeProgress,
    doneSince,
    drop,
    makeSmaller,
    mustDecide,
    newTodo,
    openInOrder,
    pickNext,
    postpone,
    pruneFinished,
} from '../src/utils/todos';

const DAY = 24 * 60 * 60 * 1000;
const T0 = new Date('2026-11-01T10:00:00').getTime();
const today = '2026-11-04';

const todo = (title: string, createdAt: number, extra: Partial<Todo> = {}): Todo => ({
    ...newTodo(title, createdAt),
    ...extra,
});

describe('pickNext', () => {
    it('puts up the most postponed, then the oldest', () => {
        const a = todo('a', T0);
        const b = todo('b', T0 + DAY);
        const c = todo('c', T0 + 2 * DAY, { postponed: 2 });
        expect(pickNext([a, b, c], today)?.title).toBe('c');
        expect(pickNext([b, a], today)?.title).toBe('a');
    });

    it('skips snoozed, finished and dropped to-dos', () => {
        const a = postpone(todo('a', T0), today);
        const b = { ...todo('b', T0), doneAt: T0 };
        const c = drop(todo('c', T0), T0);
        const d = todo('d', T0 + DAY);
        expect(pickNext([a, b, c, d], today)?.title).toBe('d');
        expect(pickNext([a, b, c], today)).toBeNull();
        // Snoozed comes back the next day, ahead of others since it was put off.
        expect(pickNext([a, d], '2026-11-05')?.title).toBe('a');
    });

    it('can pick quick ones only', () => {
        const a = todo('a', T0);
        const b = todo('b', T0 + DAY, { quick: true });
        expect(pickNext([a, b], today, true)?.title).toBe('b');
    });

    it('lists snoozed ones last', () => {
        const a = postpone(todo('a', T0), today);
        const b = todo('b', T0 + DAY);
        expect(openInOrder([a, b], today).map(t => t.title)).toEqual(['b', 'a']);
    });
});

describe('postponing', () => {
    it('must be decided after the limit', () => {
        let t = todo('taxes', T0);
        for (let i = 0; i < POSTPONE_LIMIT; i++) {
            expect(mustDecide(t)).toBe(false);
            t = postpone(t, today);
        }
        expect(mustDecide(t)).toBe(true);
        expect(describeAge(t, T0 + 23 * DAY)).toBe(`Added 23 days ago · put off ${POSTPONE_LIMIT} times`);
    });

    it('making it smaller puts a step first and starts the count over', () => {
        const t = makeSmaller(postpone(postpone(postpone(todo('Do taxes', T0), today), today), today), 'Find papers');
        expect(mustDecide(t)).toBe(false);
        expect(t.snoozedOn).toBeUndefined();
        expect(currentTitle(t)).toBe('Find papers');
        expect(describeProgress(t)).toBe('Step 1 of 2');
    });
});

describe('completing', () => {
    it('finishes steps one by one, then the to-do', () => {
        let t = makeSmaller(makeSmaller(todo('Renovate room', T0), 'Measure'), 'Buy paint');
        // The newer smaller step goes in front of the open one.
        expect(currentTitle(t)).toBe('Buy paint');
        t = completeCurrent(t, T0 + 1, 30);
        expect(t.steps[0]).toMatchObject({ title: 'Buy paint', minutes: 30 });
        expect(currentTitle(t)).toBe('Measure');
        expect(describeProgress(t)).toBe('Step 2 of 3');
        t = completeCurrent(t, T0 + 2);
        expect(currentTitle(t)).toBe('Renovate room');
        expect(t.doneAt).toBeUndefined();
        t = completeCurrent(t, T0 + 3, 120);
        expect(t).toMatchObject({ doneAt: T0 + 3, minutes: 120 });
        expect(doneSince([t], T0)).toBe(3);
        expect(doneSince([t], T0 + 3)).toBe(1);
    });

    it('can finish everything at once', () => {
        const t = completeAll(makeSmaller(todo('x', T0), 'y'), T0 + 5);
        expect(t.doneAt).toBe(T0 + 5);
        expect(t.steps.every(s => s.doneAt === T0 + 5)).toBe(true);
    });
});

describe('pruneFinished', () => {
    it('keeps open ones and the newest finished', () => {
        const finished = Array.from({ length: MAX_FINISHED + 5 }, (_, i) => ({
            ...todo(`f${i}`, T0),
            doneAt: T0 + i,
        }));
        const openOne = todo('open', T0);
        const kept = pruneFinished([openOne, ...finished]);
        expect(kept).toHaveLength(MAX_FINISHED + 1);
        expect(kept.some(t => t.title === 'open')).toBe(true);
        expect(kept.some(t => t.title === 'f0')).toBe(false);
    });
});

describe('storage', () => {
    it('saves, updates and validates to-dos', async () => {
        const t = todo('Call dentist', T0, { quick: true });
        expect(await saveTodo(t)).toBe(true);
        expect(await updateTodo(t.id, x => postpone(x, today))).toBe(true);
        const [stored] = await getTodos();
        expect(stored).toMatchObject({ title: 'Call dentist', quick: true, postponed: 1, snoozedOn: today });
    });
});
