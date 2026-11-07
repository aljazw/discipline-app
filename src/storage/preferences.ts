import { KEYS, parseJson, readBool, readParsed, writeJson } from './core';

const flag = (key: string) => ({
    get: async (): Promise<boolean> => (await readBool(key)) === true,
    set: async (value: boolean): Promise<void> => {
        await writeJson(key, value);
    },
});

const welcome = flag(KEYS.hasSeenWelcome);
const notificationScheduled = flag(KEYS.notificationScheduled);

export const hasUserSeenWelcome = welcome.get;
export const setUserHasSeenWelcome = welcome.set;
const planGuide = flag(KEYS.planGuideSeen);
export const hasSeenPlanGuide = planGuide.get;
export const setSeenPlanGuide = planGuide.set;
export const isNotificationScheduled = notificationScheduled.get;
export const setNotificationScheduled = notificationScheduled.set;

/** null = never chosen (follow the default). */
export const getThemePreference = (): Promise<boolean | null> => readBool(KEYS.darkMode);
export const setThemePreference = flag(KEYS.darkMode).set;

export const getPassphrasePreference = (): Promise<boolean | null> => readBool(KEYS.passphrase);
export const setPassphrasePreference = flag(KEYS.passphrase).set;

const toText = (raw: string | null): string | null => {
    const value = parseJson(raw);
    return typeof value === 'string' ? value : null;
};

export const getAccentPreference = (): Promise<string | null> => readParsed(KEYS.accent, toText);

export const setAccentPreference = async (accent: string): Promise<void> => {
    await writeJson(KEYS.accent, accent);
};

const toFolder = (raw: string | null): string => toText(raw) ?? '';

/** The folder the music screen plays from; "" = every song. */
export const getMusicFolder = (): Promise<string> => readParsed(KEYS.musicFolder, toFolder);

export const setMusicFolder = async (folder: string): Promise<void> => {
    await writeJson(KEYS.musicFolder, folder);
};
