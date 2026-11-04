import { Todo, TodoStep } from '../types/types';
import { MAX_TITLE, pruneFinished } from '../utils/todos';
import { DATE_KEY, KEYS, isNumber, isString, readList, updateList, upsertById, withoutId } from './core';

const minutesOf = (v: unknown) => (isNumber(v) && v > 0 && v <= 24 * 60 ? { minutes: Math.round(v) } : {});
const timeOf = (name: 'doneAt' | 'droppedAt', v: unknown) => (isNumber(v) && v > 0 ? { [name]: v } : {});

const toStep = (v: any): TodoStep | null =>
    v && isString(v.id) && isString(v.title)
        ? { id: v.id, title: v.title.slice(0, MAX_TITLE), ...timeOf('doneAt', v.doneAt), ...minutesOf(v.minutes) }
        : null;

const toTodo = (v: any): Todo | null => {
    if (!v || !isString(v.id) || !isString(v.title)) {
        return null;
    }
    return {
        id: v.id,
        title: v.title.slice(0, MAX_TITLE),
        createdAt: isNumber(v.createdAt) ? v.createdAt : 0,
        steps: Array.isArray(v.steps) ? v.steps.map(toStep).filter((s: TodoStep | null): s is TodoStep => !!s) : [],
        postponed: isNumber(v.postponed) && v.postponed > 0 ? Math.floor(v.postponed) : 0,
        ...(typeof v.snoozedOn === 'string' && DATE_KEY.test(v.snoozedOn) ? { snoozedOn: v.snoozedOn } : {}),
        ...(v.quick === true ? { quick: true } : {}),
        ...timeOf('doneAt', v.doneAt),
        ...timeOf('droppedAt', v.droppedAt),
        ...minutesOf(v.minutes),
    };
};

export const getTodos = async (): Promise<Todo[]> => {
    try {
        return await readList(KEYS.todos, toTodo);
    } catch {
        throw new Error('Failed to get to-dos');
    }
};

/** Inserts the to-do, or replaces the one with the same id. */
export const saveTodo = (todo: Todo): Promise<boolean> =>
    updateList(KEYS.todos, toTodo, list => pruneFinished(upsertById(list, todo)));

/** Applies `change` to the stored to-do inside the write queue. */
export const updateTodo = (id: string, change: (todo: Todo) => Todo): Promise<boolean> =>
    updateList(KEYS.todos, toTodo, list => pruneFinished(list.map(t => (t.id === id ? change(t) : t))));

export const deleteTodo = (id: string): Promise<boolean> => updateList(KEYS.todos, toTodo, list => withoutId(list, id));
