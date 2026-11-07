/**
 * GPX export: places, routes and tracks in the format every map, chart
 * plotter and sports app reads. (Import is native: map/GeoImport.kt.)
 */
import { APP_NAME } from '../constants/brand';
import { MapMark, MapRoute, Track } from '../types/types';

export const escapeXml = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const gpxNumber = (v: number, digits = 7) => Number(v.toFixed(digits)).toString();

const escape = escapeXml;
const n = gpxNumber;

const SYMBOLS: Record<MapMark['kind'], string> = {
    spot: 'Waypoint',
    fish: 'Fishing Area',
    anchor: 'Anchor',
    danger: 'Danger Area',
    flag: 'Flag, Blue',
    home: 'Residence',
    camp: 'Campground',
};

export const buildGpx = (data: { marks?: MapMark[]; routes?: MapRoute[]; tracks?: Track[] }): string => {
    const out: string[] = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        `<gpx version="1.1" creator="${escape(APP_NAME)}" xmlns="http://www.topografix.com/GPX/1/1">`,
    ];
    for (const m of data.marks ?? []) {
        out.push(`  <wpt lat="${n(m.lat)}" lon="${n(m.lon)}">`);
        out.push(`    <time>${new Date(m.createdAt).toISOString()}</time>`);
        out.push(`    <name>${escape(m.name)}</name>`);
        if (m.note) {
            out.push(`    <desc>${escape(m.note)}</desc>`);
        }
        out.push(`    <sym>${SYMBOLS[m.kind]}</sym>`);
        out.push('  </wpt>');
    }
    for (const r of data.routes ?? []) {
        out.push('  <rte>', `    <name>${escape(r.name)}</name>`);
        r.points.forEach(([lon, lat]) => out.push(`    <rtept lat="${n(lat)}" lon="${n(lon)}"/>`));
        out.push('  </rte>');
    }
    for (const t of data.tracks ?? []) {
        out.push('  <trk>', `    <name>${escape(t.name)}</name>`, '    <trkseg>');
        for (const [lat, lon, alt, time] of t.points) {
            const ele = alt ? `<ele>${n(alt, 1)}</ele>` : '';
            const at = time ? `<time>${new Date(time).toISOString()}</time>` : '';
            out.push(`      <trkpt lat="${n(lat)}" lon="${n(lon)}">${ele}${at}</trkpt>`);
        }
        out.push('    </trkseg>', '  </trk>');
    }
    out.push('</gpx>', '');
    return out.join('\n');
};

/** A safe file name, e.g. "Morning ride.gpx". */
export const gpxFileName = (name: string) =>
    `${name.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim() || 'export'}.gpx`;
