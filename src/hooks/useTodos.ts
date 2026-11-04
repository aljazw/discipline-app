import { Todo } from '../types/types';
import { STORAGE_KEYS, getTodos } from '../storage';
import { useFocusData } from './useFocusData';

const NONE: Todo[] = [];
const WATCH = [STORAGE_KEYS.todos];

/** Every to-do, open and finished; stays current with changes made anywhere. */
export const useTodos = () => {
    const { data: todos, loaded, failed } = useFocusData(getTodos, NONE, { watch: WATCH });
    return { todos, loaded, failed };
};
