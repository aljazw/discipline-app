import { NavigationProp, NavigatorScreenParams } from '@react-navigation/native';
import type { IconName } from '../components/Icon';

export type TabParamList = {
    /** Opens on today, tomorrow or the routine list. */
    Habits: { view?: RoutineView } | undefined;
    Workout: undefined;
    /** Music, apnea training and notes. */
    Tools: undefined;
    /** The block list, with Settings behind a button. */
    Block: undefined;
};

export type RootStackParamList = {
    BottomTabs: NavigatorScreenParams<TabParamList> | undefined;
    /** Pick a website or app to block. */
    AddSite: undefined;
    /** Pass websiteUrl for a site, or app for an app. */
    Schedule: { websiteUrl?: string; app?: { packageName: string; appName: string } };
    /**
     * A routine task (habitId), a one-off task of a day (date + taskId), or a
     * new task: with a date it starts as a one-off for that day (up next, today).
     */
    TaskEditor: { habitId?: string; date?: string; taskId?: string } | undefined;
    /** A generated CO2/O2 table, or a custom one (no tableId = create, optionally prefilled). */
    ApneaTable: { kind: 'co2' | 'o2' } | { kind: 'custom'; tableId?: string; name?: string; rounds?: TableRound[] };
    /** The live (or just finished) training session. */
    ApneaSession: undefined;
    /** Apnea training home: tables, breathing exercises and history. */
    Apnea: undefined;
    ApneaHistory: undefined;
    ApneaSettings: undefined;
    Sleep: undefined;
    DayHours: undefined;
    Music: undefined;
    Vacation: undefined;
    Settings: undefined;
    /** No workoutId = create a new workout. */
    WorkoutEditor: { workoutId?: string } | undefined;
    /** The live (or just finished) workout. */
    WorkoutSession: undefined;
    Notes: undefined;
    /** No noteId = a new note. */
    NoteEditor: { noteId?: string } | undefined;
    /** The map; optionally zoomed to a saved place, or navigating to one. */
    Map: { show?: MapTarget; navigate?: MapTarget } | undefined;
    /** Saved places, routes, tracks and map files. */
    MapLibrary: { tab?: MapLibraryTab } | undefined;
};

export type MapLibraryTab = 'marks' | 'routes' | 'tracks' | 'maps';

export type RoutineView = 'next' | 'today' | 'tomorrow' | 'routine';

// ---- To-dos (one-time things) -----------------------------------------------

/** A smaller step of a to-do, done before the to-do itself. */
export interface TodoStep {
    id: string;
    title: string;
    /** Epoch ms. */
    doneAt?: number;
    /** How long it really took, if given. */
    minutes?: number;
}

/**
 * Something to do once, e.g. "Call dentist". With steps it's a project: the
 * open steps come first, one at a time, then the to-do itself.
 */
export interface Todo {
    id: string;
    title: string;
    /** Epoch ms. */
    createdAt: number;
    steps: TodoStep[];
    /** "Not now" taps on what's currently up (resets when a step is done or it's made smaller). */
    postponed: number;
    /** Local date "YYYY-MM-DD": put off until the day after this. */
    snoozedOn?: string;
    /** Takes under five minutes. */
    quick?: boolean;
    doneAt?: number;
    droppedAt?: number;
    /** How long the to-do itself took, if given. */
    minutes?: number;
}

// ---- Day plan ---------------------------------------------------------------

/** A task for one day only, e.g. "Dentist". Routine tasks are habits. */
export interface OneOffTask {
    id: string;
    title: string;
    icon: IconName;
    /** Minutes. */
    duration: number;
}

/**
 * What happened on one day. The day's tasks are the routine tasks due that
 * day plus its one-offs, between wake-up and bedtime; nothing has a fixed time.
 */
export interface DayPlan {
    /** Local date "YYYY-MM-DD". */
    date: string;
    /** Task ids in the day's order, once it differs from the routine ("Later", one-offs). */
    order: string[];
    oneOffs: OneOffTask[];
    /** When each finished task was checked off, in minutes after midnight. */
    finished: Record<string, number>;
    /** Task ids skipped for the day. */
    skipped: string[];
}

export interface PlanPrefs {
    /** A notification when each task is due to start (by the estimate). */
    reminders: boolean;
    /** Occasional in-app check-ins when a task runs long. */
    nudges: boolean;
    /** An alarm at wake-up time; turning it off plays the motivation video. Mirrors WakeAlarm.kt. */
    wakeAlarm: boolean;
}

/** When the day plan starts and ends, "HH:mm". Separate from sleep time, which only blocks the phone. */
export interface DayHours {
    wake: string;
    bedtime: string;
}

/** Nightly sleep time; times are "HH:mm". Mirrors SleepSchedule.kt. */
export interface SleepSchedule {
    enabled: boolean;
    bedtime: string;
    wake: string;
}

/** Vacation mode: no blocks apply from start to end, both "YYYY-MM-DD" and included. Mirrors Vacation.kt. */
export interface Vacation {
    start: string;
    end: string;
}

export interface BlockedWebsitesData {
    days: string;
    time: string;
    websiteUrl: string;
    visible: boolean;
    /** Minutes a day it may be used while its schedule is on; unset = blocked outright. */
    limit?: number;
}

export interface BlockedAppData {
    days: string;
    time: string;
    packageName: string;
    appName: string;
    visible: boolean;
    /** Minutes a day it may be used while its schedule is on; unset = blocked outright. */
    limit?: number;
}

/** A website or app on the block list, in one shape for the UI. */
export interface BlockEntry {
    kind: 'site' | 'app';
    /** websiteUrl for sites, packageName for apps. */
    key: string;
    label: string;
    days: string;
    time: string;
    visible: boolean;
    limit?: number;
}

/**
 * A routine task, e.g. "Workout · 45 min" on Mon, Wed, Fri. It's in the day
 * plan on each of its days, and missing one breaks its streak.
 */
export interface Habit {
    id: string;
    title: string;
    icon: IconName;
    /** Seven flags, Monday first: which weekdays the task is due. */
    days: boolean[];
    /** How long it usually takes, in minutes. */
    duration: number;
    /** Local date "YYYY-MM-DD" the habit was created; streaks never look further back. */
    createdAt: string;
    /** Local dates "YYYY-MM-DD" the habit was checked off. */
    completions: string[];
    /** Checked off automatically when a session of this kind is finished. */
    link?: HabitLink;
}

export type HabitLink = 'apnea' | 'workout';

// ---- Notes -----------------------------------------------------------------

/**
 * A note as stored. A protected note keeps its title and text only inside
 * `cipher` (encrypted with the notes password, see NoteCryptoModule.kt).
 */
export interface StoredNote {
    id: string;
    /** Epoch ms. */
    createdAt: number;
    updatedAt: number;
    title?: string;
    body?: string;
    cipher?: string;
}

/** A note ready to show: protected ones carry their text only while the notes are unlocked. */
export interface Note {
    id: string;
    createdAt: number;
    updatedAt: number;
    title: string;
    body: string;
    protected: boolean;
    /** Protected and not readable right now (notes locked). */
    locked: boolean;
}

// ---- Workouts ---------------------------------------------------------------

/** Counted in reps (tap when a set is done) or timed (a countdown, e.g. a plank). */
export type ExerciseMode = 'reps' | 'time';

export interface Exercise {
    id: string;
    name: string;
    mode: ExerciseMode;
    sets: number;
    /** Target reps per set; used when mode is "reps". */
    reps: number;
    /** Seconds per set; used when mode is "time". */
    seconds: number;
    /** Rest after each set, in seconds (0 = none). */
    rest: number;
}

export interface Workout {
    id: string;
    name: string;
    exercises: Exercise[];
    /**
     * Circuit: one set of every exercise per round (1, 2, 3, then 1, 2, 3 again)
     * instead of finishing all sets of one exercise first.
     */
    circuit?: boolean;
    /** Circuit only: rest after each full round, in seconds (0 = none). */
    roundRest?: number;
}

/**
 * ready: waiting for the user (tap "Done" for reps, "Start" for a timed set).
 * work:  a timed set is counting down; phaseStartedAt may lie in the future (get-ready lead-in).
 * rest:  resting after a set.
 * done:  finished or ended early.
 */
export type WorkoutPhase = 'ready' | 'work' | 'rest' | 'done';

/** The workout in progress. Wall-clock millis, so it survives the app closing. */
export interface WorkoutSession {
    id: string;
    workoutId: string;
    title: string;
    /** Snapshot taken at the start, so editing the workout can't break a running session. */
    exercises: Exercise[];
    /** Circuit order (see Workout.circuit); `set` is then the round. */
    circuit: boolean;
    roundRest: number;
    exercise: number;
    set: number;
    phase: WorkoutPhase;
    phaseStartedAt: number;
    startedAt: number;
    endedAt: number;
    setsDone: number;
    /** Ended with "End workout" before the last set. */
    endedEarly: boolean;
}

export interface WorkoutRecord {
    id: string;
    workoutId: string;
    title: string;
    startedAt: number;
    endedAt: number;
    setsDone: number;
    setsTotal: number;
    /** Reached the end (skipped sets allowed) rather than ended early; this checks off linked habits. */
    completed: boolean;
}

export interface WorkoutCues {
    sound: boolean;
    vibration: boolean;
}

// ---- Apnea training ---------------------------------------------------------

export type ApneaKind = 'co2' | 'o2' | 'custom' | 'pb' | 'breathing';

/** One row of a breath-hold table, in seconds: rest (breathe) first, then hold. */
export interface TableRound {
    breathe: number;
    hold: number;
}

/** Inputs of a generated table, in seconds. */
export interface TableParams {
    hold: number;
    breathe: number;
    /** Change per round: less breathe time (CO₂) or more hold (O₂). */
    step: number;
    rounds: number;
}

export interface CustomTable {
    id: string;
    name: string;
    rounds: TableRound[];
}

export interface ApneaSettings {
    sound: boolean;
    vibration: boolean;
    /** Soft pulse every 30 s during an open-ended max hold. */
    holdPulse: boolean;
    /** Relaxed breathing before a max-hold test, in seconds (0 = none). */
    breatheUp: number;
    /** Parameters of the generated CO₂ and O₂ tables (see utils/apnea TableParams). */
    co2: TableParams;
    o2: TableParams;
    safetyAccepted: boolean;
}

/** A finished training session (or a manually entered personal best). */
export interface ApneaRecord {
    id: string;
    kind: ApneaKind;
    title: string;
    /** Epoch ms. */
    startedAt: number;
    endedAt: number;
    /** All rounds done (false = ended early). */
    completed: boolean;
    /** Actual hold lengths in ms, in order. */
    holds: number[];
    /** Planned hold lengths in ms; -1 = open-ended (max hold). */
    targets: number[];
    /** Per hold: contraction times, ms into the hold. */
    contractions: number[][];
    /** Number of holds the session planned. */
    planned: number;
    manual?: boolean;
}

// ---- Map --------------------------------------------------------------------

export type MapTarget = { kind: 'mark' | 'route' | 'track'; id: string };

/** [longitude, latitude], the order maps and GeoJSON use. */
export type LngLat = [number, number];

export type MarkKind = 'spot' | 'fish' | 'anchor' | 'danger' | 'flag' | 'home' | 'camp';

/** A saved place on the map, e.g. a fishing spot. */
export interface MapMark {
    id: string;
    name: string;
    kind: MarkKind;
    lat: number;
    lon: number;
    note: string;
    createdAt: number;
}

/** A planned route: points to pass in order. */
export interface MapRoute {
    id: string;
    name: string;
    points: LngLat[];
    createdAt: number;
}

export type MapUnits = 'metric' | 'nautical' | 'imperial';
/** Decimal degrees, degrees + decimal minutes (charts), or degrees, minutes, seconds. */
export type CoordFormat = 'dd' | 'dm' | 'dms';

/** An online map: built in, or added by the user as an XYZ tile URL or a style URL. */
export interface OnlineMap {
    id: string;
    name: string;
    url: string;
    /** "raster" = an XYZ template with {z}/{x}/{y}; "style" = a MapLibre style JSON URL. */
    type: 'raster' | 'style';
    maxZoom?: number;
    attribution?: string;
}

export interface MapPrefs {
    /** "file:<id>" for an offline map, "online:<id>" for an online one. */
    base: string;
    /** OpenSeaMap sea marks over the base map. */
    seamarks: boolean;
    showMarks: boolean;
    showTracks: boolean;
    units: MapUnits;
    coords: CoordFormat;
    keepAwake: boolean;
    /** Online maps the user added. */
    custom: OnlineMap[];
    /** Where the map was last left: [lon, lat], zoom. */
    camera?: { center: LngLat; zoom: number };
    /** The map to go back to when the satellite button is tapped again. */
    previousBase?: string;
}

/** A saved track as listed (no full points). Distances in meters, speeds m/s. */
export interface TrackSummary {
    id: string;
    name: string;
    startedAt: number;
    endedAt: number;
    distance: number;
    movingMs: number;
    maxSpeed: number;
    pointCount: number;
    /** A thinned outline, [lat, lon] pairs. */
    preview: [number, number][];
}

/** One recorded fix: [lat, lon, altitude m, time ms, speed m/s]. */
export type TrackPoint = [number, number, number, number, number];

export interface Track extends Omit<TrackSummary, 'preview' | 'pointCount'> {
    points: TrackPoint[];
}

export type RootStackNavigation = NavigationProp<RootStackParamList>;
