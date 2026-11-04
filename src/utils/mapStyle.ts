/**
 * Builds the MapLibre style for the chosen base map: an offline file (MBTiles
 * through the on-phone tile server, PMTiles read directly) or an online map.
 * Places, routes and tracks are drawn on top by the map screen itself.
 */
import { MapPrefs, OnlineMap } from '../types/types';
import { MapFile } from './mapNative';

/** Online maps that need no account. All are cached as they load. */
export const ONLINE_MAPS: OnlineMap[] = [
    {
        id: 'osm',
        name: 'Streets',
        url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
        type: 'raster',
        maxZoom: 19,
        attribution: '© OpenStreetMap contributors',
    },
    {
        id: 'topo',
        name: 'Terrain',
        url: 'https://tile.opentopomap.org/{z}/{x}/{y}.png',
        type: 'raster',
        maxZoom: 17,
        attribution: '© OpenStreetMap contributors, SRTM · style © OpenTopoMap (CC-BY-SA)',
    },
    {
        id: 'cycle',
        name: 'Cycling',
        url: 'https://a.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png',
        type: 'raster',
        maxZoom: 20,
        attribution: '© OpenStreetMap contributors · CyclOSM',
    },
    {
        id: 'satellite',
        name: 'Satellite',
        url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        type: 'raster',
        maxZoom: 19,
        attribution: 'Imagery © Esri, Maxar, Earthstar Geographics',
    },
];

const SEAMARKS_URL = 'https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png';

/** The satellite map behind the one-tap switch: Esri imagery, no account or key. */
export const SATELLITE_BASE = 'online:satellite';

/** Satellite on, or back to the map that was showing before. */
export const toggleSatellite = (prefs: MapPrefs): MapPrefs =>
    prefs.base === SATELLITE_BASE
        ? { ...prefs, base: prefs.previousBase && prefs.previousBase !== SATELLITE_BASE ? prefs.previousBase : 'online:osm' }
        : { ...prefs, base: SATELLITE_BASE, previousBase: prefs.base };

export const fileBaseId = (file: MapFile) => `file:${file.id}`;
export const onlineBaseId = (map: OnlineMap) => `online:${map.id}`;

export type BaseMap =
    | { kind: 'file'; file: MapFile }
    | { kind: 'online'; map: OnlineMap };

/** The chosen base map, falling back to Streets when it's gone (e.g. a deleted file). */
export const resolveBase = (prefs: MapPrefs, files: MapFile[]): BaseMap => {
    if (prefs.base.startsWith('file:')) {
        const file = files.find(f => f.id === prefs.base.slice(5));
        if (file) {
            return { kind: 'file', file };
        }
    }
    const id = prefs.base.startsWith('online:') ? prefs.base.slice(7) : '';
    const map = [...ONLINE_MAPS, ...prefs.custom].find(m => m.id === id) ?? ONLINE_MAPS[0];
    return { kind: 'online', map };
};

/** Muted colors for drawing any vector layer, cycled by layer. */
const VECTOR_COLORS = ['#6E90C0', '#7FA37A', '#C09A6E', '#9C7FB8', '#6FB0B0', '#B87F8C'];

/** A plain style for vector tiles without one of their own: every layer as fills, lines and dots. */
const genericVectorLayers = (source: string, layers: string[], dark: boolean) =>
    layers.flatMap((layer, i) => {
        const color = VECTOR_COLORS[i % VECTOR_COLORS.length];
        return [
            {
                id: `${layer}-fill`,
                type: 'fill',
                source,
                'source-layer': layer,
                filter: ['==', ['geometry-type'], 'Polygon'],
                paint: { 'fill-color': color, 'fill-opacity': dark ? 0.25 : 0.2 },
            },
            {
                id: `${layer}-line`,
                type: 'line',
                source,
                'source-layer': layer,
                filter: ['!=', ['geometry-type'], 'Point'],
                paint: { 'line-color': color, 'line-width': 1 },
            },
            {
                id: `${layer}-point`,
                type: 'circle',
                source,
                'source-layer': layer,
                filter: ['==', ['geometry-type'], 'Point'],
                paint: { 'circle-color': color, 'circle-radius': 2.5 },
            },
        ];
    });

/**
 * The style object for the base map, or a URL for an online style. Raster
 * maps are overzoomed past their last level, so a chart stays usable when
 * zoomed in further than it was made for.
 */
export const buildStyle = (
    base: BaseMap,
    opts: { serverUrl: string | null; seamarks: boolean; dark: boolean },
): object | string => {
    if (base.kind === 'online' && base.map.type === 'style') {
        return base.map.url;
    }
    const background = opts.dark ? '#0B0C0E' : '#EEF0F2';
    const sources: Record<string, object> = {};
    const layers: object[] = [{ id: 'background', type: 'background', paint: { 'background-color': background } }];

    if (base.kind === 'online') {
        sources.base = {
            type: 'raster',
            tiles: [base.map.url],
            tileSize: 256,
            maxzoom: base.map.maxZoom ?? 19,
            ...(base.map.attribution ? { attribution: base.map.attribution } : {}),
        };
        layers.push({ id: 'base', type: 'raster', source: 'base' });
    } else {
        const f = base.file;
        const tiles =
            f.kind === 'pmtiles'
                ? { url: `pmtiles://file://${f.path}` }
                : opts.serverUrl
                ? { tiles: [`${opts.serverUrl}/${encodeURIComponent(f.id)}/{z}/{x}/{y}`] }
                : null;
        if (tiles) {
            sources.base = {
                type: f.type,
                ...tiles,
                minzoom: f.minZoom,
                maxzoom: f.maxZoom,
                ...(f.type === 'raster' ? { tileSize: 256 } : {}),
                ...(f.bounds ? { bounds: f.bounds } : {}),
                ...(f.attribution ? { attribution: f.attribution } : {}),
            };
            if (f.type === 'raster') {
                layers.push({ id: 'base', type: 'raster', source: 'base' });
            } else {
                layers.push(...genericVectorLayers('base', f.layers?.length ? f.layers : [], opts.dark));
            }
        }
    }

    if (opts.seamarks) {
        sources.seamarks = {
            type: 'raster',
            tiles: [SEAMARKS_URL],
            tileSize: 256,
            minzoom: 6,
            maxzoom: 18,
            attribution: '© OpenSeaMap contributors',
        };
        layers.push({ id: 'seamarks', type: 'raster', source: 'seamarks' });
    }

    return { version: 8, name: 'map', sources, layers };
};

/** A raster XYZ template has {z}, {x} and {y} (or {-y}); anything else is taken as a style URL. */
export const onlineMapType = (url: string): OnlineMap['type'] =>
    /\{z\}/.test(url) && /\{x\}/.test(url) && /\{-?y\}/.test(url) ? 'raster' : 'style';

export const isWebUrl = (url: string) => /^https?:\/\/\S+$/i.test(url.trim());
