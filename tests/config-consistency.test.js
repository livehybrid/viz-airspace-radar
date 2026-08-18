/*
 * Drift guards between the three places the visualization is declared:
 *   - default/visualizations.conf  (Splunk registration)
 *   - appserver/static/visualizations/airspace_radar/config.json (Studio editor)
 *   - appserver/static/visualizations/airspace_radar/visualization.js (behaviour)
 *
 * On viz-realtime-clock this exact class of drift produced a viz that mounted
 * but never got its options; these tests make the contract explicit.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const VIZ_DIR = path.join(ROOT, 'appserver', 'static', 'visualizations', 'airspace_radar');

const conf = fs.readFileSync(path.join(ROOT, 'default', 'visualizations.conf'), 'utf8');
const config = JSON.parse(fs.readFileSync(path.join(VIZ_DIR, 'config.json'), 'utf8'));
const source = fs.readFileSync(path.join(VIZ_DIR, 'visualization.js'), 'utf8');

const EXPECTED_OPTIONS = [
    'centerLat', 'centerLon', 'colorScheme', 'homeLabel', 'rangeNm',
    'showAltitude', 'showHeadingVector', 'showLabels', 'sweepSeconds',
];

describe('visualizations.conf registration', () => {
    test('declares the airspace_radar stanza matching the viz directory name', () => {
        expect(conf).toMatch(/^\[airspace_radar\]$/m);
    });

    test('registers as a Studio visualization', () => {
        expect(conf).toMatch(/^framework_type\s*=\s*studio_visualization$/m);
    });

    test('declares no phantom stanzas for visualizations that do not exist', () => {
        const stanzas = [...conf.matchAll(/^\[([^\]]+)\]/gm)].map((m) => m[1]);
        const vizDirs = fs
            .readdirSync(path.join(ROOT, 'appserver', 'static', 'visualizations'))
            .filter((d) => fs.statSync(path.join(ROOT, 'appserver', 'static', 'visualizations', d)).isDirectory());
        for (const stanza of stanzas) {
            expect(vizDirs).toContain(stanza.split('.')[0]);
        }
    });

    test('search_fragment provides every field the parser consumes', () => {
        const fragment = conf.match(/^search_fragment\s*=\s*(.+)$/m)[1];
        for (const field of ['hex', 'callsign', 'lat', 'lon', 'altitude_ft', 'heading', 'speed_kts']) {
            expect(fragment).toContain(field);
        }
    });
});

describe('config.json options schema', () => {
    const schemaKeys = Object.keys(config.config.optionsSchema);

    test('exposes exactly the options the source implements', () => {
        expect(schemaKeys.sort()).toEqual(EXPECTED_OPTIONS);
    });

    test.each(EXPECTED_OPTIONS)('option %s is read by visualization.js', (key) => {
        expect(source).toMatch(new RegExp(`o\\.${key}\\b`));
    });

    test('every editorConfig option exists in the options schema', () => {
        const editorOptions = [];
        for (const section of config.config.editorConfig) {
            for (const row of section.layout) {
                for (const cell of row) {
                    if (cell.option) editorOptions.push(cell.option);
                }
            }
        }
        expect(editorOptions.length).toBeGreaterThan(0);
        for (const opt of editorOptions) {
            expect(schemaKeys).toContain(opt);
        }
    });

    test('schema defaults agree with the DEFAULTS table in the source', () => {
        const m = source.match(/var DEFAULTS = \{([\s\S]*?)\};/);
        expect(m).not.toBeNull();
        for (const key of EXPECTED_OPTIONS) {
            const schemaDefault = config.config.optionsSchema[key].default;
            if (schemaDefault === undefined) continue;
            const line = m[1].match(new RegExp(`${key}:\\s*([^,\\n]+)`));
            expect(line).not.toBeNull();
            const sourceDefault = line[1].trim().replace(/^'|'$/g, '');
            expect(String(schemaDefault)).toBe(sourceDefault);
        }
    });
});
