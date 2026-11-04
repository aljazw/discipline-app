/* eslint-env jest */
/* Stubs for native modules that don't exist in the Jest environment. */

jest.mock('@notifee/react-native', () => ({
    __esModule: true,
    default: {
        requestPermission: jest.fn(async () => ({ authorizationStatus: 1 })),
        getNotificationSettings: jest.fn(async () => ({ authorizationStatus: 1 })),
        createChannel: jest.fn(async () => 'channel'),
        createTriggerNotification: jest.fn(async () => 'id'),
        cancelTriggerNotifications: jest.fn(async () => {}),
        getTriggerNotificationIds: jest.fn(async () => []),
        displayNotification: jest.fn(async () => 'id'),
        onForegroundEvent: jest.fn(() => () => {}),
        onBackgroundEvent: jest.fn(),
    },
    AndroidImportance: { DEFAULT: 3, HIGH: 4, LOW: 2 },
    AuthorizationStatus: { NOT_DETERMINED: -1, DENIED: 0, AUTHORIZED: 1, PROVISIONAL: 2 },
    RepeatFrequency: { NONE: -1, HOURLY: 0, DAILY: 1, WEEKLY: 2 },
    TriggerType: { TIMESTAMP: 0, INTERVAL: 1 },
}));


jest.mock('react-native-navigation-bar-color', () => jest.fn());

/** The map view is native-only; screens importing it render plain views in tests. */
jest.mock('@maplibre/maplibre-react-native', () => {
    const React = require('react');
    const Stub = ({ children }) => React.createElement(React.Fragment, null, children);
    return {
        MapView: Stub,
        Camera: React.forwardRef((props, ref) => null),
        UserLocation: () => null,
        ShapeSource: Stub,
        LineLayer: () => null,
        CircleLayer: () => null,
        MarkerView: Stub,
        UserTrackingMode: { Follow: 'normal', FollowWithHeading: 'compass', FollowWithCourse: 'course' },
    };
});
