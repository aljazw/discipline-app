import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { LngLat } from '../types/types';
import { useAppForeground } from './useAppForeground';
import { IDLE_SURVEY, LiveSurvey, appendPoints, surveyNative } from '../utils/survey';
import { logger } from '../utils/logger';

/**
 * The Water Wolf survey as the map shows it: its state once a second, its
 * track as lines (one per moving stretch) and the phone settings it needs.
 * Recording itself runs natively and doesn't depend on this.
 */
export const useSurvey = () => {
    const [state, setStateRaw] = useState<LiveSurvey>(IDLE_SURVEY);
    const [segments, setSegments] = useState<LngLat[][]>([]);
    const [gpsOn, setGpsOn] = useState(true);
    const [batteryOk, setBatteryOk] = useState(true);
    const id = useRef<string | undefined>(undefined);
    const count = useRef(0);
    /** Segment number of the last line in `segments`. */
    const lastSegment = useRef<number | null>(null);
    const lines = useRef<LngLat[][]>([]);
    const busy = useRef(false);
    /** The latest state, for code that runs after an await. */
    const latest = useRef<LiveSurvey>(IDLE_SURVEY);

    const setState = useCallback((s: LiveSurvey) => {
        latest.current = s;
        setStateRaw(s);
    }, []);

    const refresh = useCallback(async () => {
        if (busy.current || !surveyNative.available) {
            return;
        }
        busy.current = true;
        try {
            const s = await surveyNative.state();
            if (s.id !== id.current) {
                id.current = s.id;
                count.current = 0;
                lastSegment.current = null;
                lines.current = [];
                setSegments([]);
            }
            if (s.id && s.pointCount > count.current) {
                const more = await surveyNative.points(count.current);
                count.current += more.length;
                // Worked out outside a state updater: it moves lastSegment, so it must run once.
                lines.current = appendPoints(lines.current, lastSegment, more);
                setSegments(lines.current);
            }
            setState(s);
        } catch (error) {
            logger.warn('Survey refresh failed', error);
        } finally {
            busy.current = false;
        }
    }, [setState]);

    const checkPhone = useCallback(() => {
        surveyNative.gpsEnabled().then(setGpsOn).catch(() => undefined);
        surveyNative.batteryUnrestricted().then(setBatteryOk).catch(() => undefined);
    }, []);

    useFocusEffect(
        useCallback(() => {
            refresh();
            checkPhone();
            const timer = setInterval(refresh, 1000);
            return () => clearInterval(timer);
        }, [refresh, checkPhone]),
    );

    useAppForeground(() => {
        refresh();
        checkPhone();
    });

    return { state, latest, setState, refresh, segments, gpsOn, batteryOk, checkPhone };
};

export type SurveyHandle = ReturnType<typeof useSurvey>;
