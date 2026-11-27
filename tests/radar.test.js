/*
 * Render-behaviour tests for the Airspace Radar visualization.
 *
 * The shipped file is an IIFE with no exports, so these tests drive the REAL
 * code through its real entry point: stub globalThis.DashboardExtensionAPI and
 * #root, let bootWhenReady() find them, then step the animation loop by hand
 * and assert on what the viz draws into the (mocked) canvas 2d context.
 *
 * NOTE: do NOT use vm.runInThisContext to evaluate the source. It runs in
 * Node's V8 context, where `document` is undefined, so bootWhenReady() spins on
 * its 25 ms retry forever and every "absence" assertion passes vacuously.
 * new Function evaluates in the jsdom context the tests actually live in.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const SOURCE = path.join(
    __dirname, '..', 'appserver', 'static', 'visualizations', 'airspace_radar', 'visualization.js'
);
const CODE = fs.readFileSync(SOURCE, 'utf8');
const evaluate = () => new Function(CODE)();

// The viz drives itself with requestAnimationFrame. Replace rAF with a manual
// queue so tests decide exactly how many frames run.
let rafQueue;

function stepFrame() {
    const cbs = rafQueue.splice(0);
    if (cbs.length === 0) throw new Error('no frame queued — did the viz boot?');
    cbs.forEach((cb) => cb(performance.now()));
}

/** Build the Studio dataSources shape from a list of flat aircraft rows. */
function toDataSources(rows) {
    const names = rows.length ? Object.keys(rows[0]) : [];
    return {
        dataSources: {
            primary: {
                data: {
                    fields: names.map((n) => ({ name: n })),
                    columns: names.map((n) => rows.map((r) => r[n])),
                },
            },
        },
    };
}

/**
 * Boot the real viz against a stub Studio API, run one frame, and return the
 * canvas context (a jest-canvas-mock spy target) plus geometry helpers.
 */
function boot({ options = {}, rows = [] } = {}) {
    document.body.innerHTML = '<div id="root"></div>';
    const root = document.getElementById('root');

    globalThis.DashboardExtensionAPI = {
        addOptionsListener: () => {},
        addDataSourcesListener: () => {},
        getOptions: () => options,
        getDataSources: () => (rows === null ? null : toDataSources(rows)),
    };

    evaluate();

    const canvas = root.querySelector('canvas');
    if (!canvas) throw new Error('viz did not create a canvas — boot failed');
    const ctx = canvas.getContext('2d');
    const fillText = jest.spyOn(ctx, 'fillText');
    stepFrame();

    return {
        root,
        canvas,
        ctx,
        fillText,
        // All strings drawn this frame
        texts: () => fillText.mock.calls.map((c) => String(c[0])),
        // Calls for one exact string
        callsFor: (s) => fillText.mock.calls.filter((c) => String(c[0]) === s),
    };
}

beforeEach(() => {
    rafQueue = [];
    window.requestAnimationFrame = (cb) => { rafQueue.push(cb); return rafQueue.length; };
});

afterEach(() => {
    delete globalThis.DashboardExtensionAPI;
    document.body.innerHTML = '';
    jest.restoreAllMocks();
});

// Centre matches the app default (53.8, -1.55). ~0.2 deg latitude = ~12 nm.
const NEAR_NORTH = { hex: 'A1', callsign: 'BAW123', lat: 54.0, lon: -1.55, altitude_ft: 35000, heading: 90, speed_kts: 450 };
const NEAR_EAST  = { hex: 'A2', callsign: 'EZY456', lat: 53.8, lon: -1.20, altitude_ft: 12000, heading: 180, speed_kts: 320 };
const FAR_NORTH  = { hex: 'A3', callsign: 'FAR999', lat: 56.0, lon: -1.55, altitude_ft: 38000, heading: 0, speed_kts: 480 };

describe('boot and canvas setup', () => {
    test('creates a canvas sized to the iframe viewport', () => {
        const app = boot();
        expect(app.canvas.width).toBe(window.innerWidth);
        expect(app.canvas.height).toBe(window.innerHeight);
    });

    test('draws the scope furniture (cardinal points) with no data bound', () => {
        const app = boot();
        for (const cardinal of ['N', 'S', 'E', 'W']) {
            expect(app.texts()).toContain(cardinal);
        }
    });

    test('draws the default home label at the scope centre', () => {
        const app = boot();
        expect(app.texts()).toContain('Leeds');
    });
});

describe('aircraft rendering from search data', () => {
    test('draws a callsign label for an in-range aircraft', () => {
        const app = boot({ rows: [NEAR_NORTH] });
        expect(app.texts()).toContain('BAW123');
    });

    test('draws the flight level next to the callsign', () => {
        const app = boot({ rows: [NEAR_NORTH] });
        expect(app.texts()).toContain('350FL');
    });

    test('an aircraft beyond rangeNm is not drawn', () => {
        const app = boot({ rows: [NEAR_NORTH, FAR_NORTH] });
        expect(app.texts()).toContain('BAW123'); // guards against vacuous pass
        expect(app.texts()).not.toContain('FAR999');
    });

    test('widening rangeNm brings the far aircraft into scope', () => {
        const app = boot({ options: { rangeNm: 200 }, rows: [FAR_NORTH] });
        expect(app.texts()).toContain('FAR999');
    });

    test('rows with unparseable coordinates are skipped, not fatal', () => {
        const junk = { hex: 'A4', callsign: 'JUNK1', lat: 'not-a-number', lon: '', altitude_ft: 1, heading: 1, speed_kts: 1 };
        const app = boot({ rows: [junk, NEAR_NORTH] });
        expect(app.texts()).toContain('BAW123');
        expect(app.texts()).not.toContain('JUNK1');
    });
});

describe('projection geometry', () => {
    test('a due-north aircraft is drawn above the scope centre', () => {
        const app = boot({ rows: [NEAR_NORTH] });
        const [, , y] = app.callsFor('BAW123')[0];
        expect(y).toBeLessThan(window.innerHeight / 2);
    });

    test('a due-east aircraft is drawn right of the scope centre', () => {
        const app = boot({ rows: [NEAR_EAST] });
        const [, x] = app.callsFor('EZY456')[0];
        expect(x).toBeGreaterThan(window.innerWidth / 2);
    });
});

describe('options', () => {
    test('showLabels=false suppresses callsign labels but keeps the scope', () => {
        const app = boot({ options: { showLabels: false }, rows: [NEAR_NORTH] });
        expect(app.texts()).toContain('N'); // scope still drawn
        expect(app.texts()).not.toContain('BAW123');
    });

    test('showAltitude=false suppresses the flight level', () => {
        const app = boot({ options: { showAltitude: false }, rows: [NEAR_NORTH] });
        expect(app.texts()).toContain('BAW123');
        expect(app.texts()).not.toContain('350FL');
    });

    test('colorScheme amber sets the amber background', () => {
        const app = boot({ options: { colorScheme: 'amber' } });
        expect(app.root.style.background).toBe('rgb(12, 5, 0)'); // #0c0500
    });

    test('an unknown colorScheme falls back to the green palette', () => {
        const app = boot({ options: { colorScheme: 'nonsense' } });
        expect(app.root.style.background).toBe('rgb(1, 12, 6)'); // #010c06
    });

    test('a custom homeLabel replaces the default', () => {
        const app = boot({ options: { homeLabel: 'EGNM' } });
        expect(app.texts()).toContain('EGNM');
        expect(app.texts()).not.toContain('Leeds');
    });

    test('options may arrive nested under .options (Studio delivery shape)', () => {
        const app = boot({ options: { options: { homeLabel: 'NESTED' } } });
        expect(app.texts()).toContain('NESTED');
    });
});

describe('animation loop', () => {
    test('every frame re-queues the next one', () => {
        boot();
        expect(rafQueue.length).toBe(1);
        stepFrame();
        expect(rafQueue.length).toBe(1);
    });
});

describe('empty and malformed data', () => {
    test('rows without usable lat/lon say so instead of showing a quiet scope', () => {
        const wrong = { hex: 'W1', callsign: 'WRONG1', latitude: 53.9, longitude: -1.5 };
        const app = boot({ rows: [wrong] });
        expect(app.texts()).toContain('NO POSITION DATA (lat/lon)');
        expect(app.texts()).not.toContain('WRONG1');
    });

    test('valid rows that are all out of range show no status line', () => {
        const app = boot({ rows: [FAR_NORTH] });
        expect(app.texts()).toContain('N');
        expect(app.texts()).not.toContain('NO POSITION DATA (lat/lon)');
    });

    test('zero rows or nothing delivered: no status line', () => {
        for (const rows of [[], null]) {
            const app = boot({ rows });
            expect(app.texts()).toContain('N'); // the scope itself did draw
            expect(app.texts().filter((t) => /^NO /.test(t))).toEqual([]);
        }
    });
});

describe('wrong-type and out-of-range options fall back to defaults', () => {
    test('the string "false" turns a boolean option off, not on', () => {
        const app = boot({ options: { showLabels: 'false' }, rows: [NEAR_NORTH] });
        expect(app.texts()).toContain('N');
        expect(app.texts()).not.toContain('BAW123');
    });

    test('a non-boolean, non-string value keeps the default', () => {
        const app = boot({ options: { showAltitude: 0 }, rows: [NEAR_NORTH] });
        expect(app.texts()).toContain('350FL');
    });

    test('a centre latitude past the pole falls back instead of mirroring east-west', () => {
        const app = boot({ options: { centerLat: 200 }, rows: [NEAR_EAST] });
        const calls = app.callsFor('EZY456');
        expect(calls.length).toBe(1);
        expect(calls[0][1]).toBeGreaterThan(window.innerWidth / 2);
    });

    test('an infinite or negative range falls back to 50 nm', () => {
        for (const rangeNm of ['Infinity', -5, 'wide']) {
            const app = boot({ options: { rangeNm }, rows: [NEAR_NORTH] });
            expect([rangeNm, app.texts()]).toEqual([rangeNm, expect.arrayContaining(['25nm', 'BAW123'])]);
        }
    });

    test('a prototype key as colorScheme falls back to green', () => {
        const app = boot({ options: { colorScheme: 'toString' } });
        expect(app.root.style.background).toBe('rgb(1, 12, 6)');
    });

    test('an object homeLabel never draws "[object Object]"', () => {
        const app = boot({ options: { homeLabel: { a: 1 } } });
        expect(app.texts()).not.toContain('[object Object]');
        expect(app.texts()).toContain('Leeds');
    });
});

describe('antimeridian', () => {
    test('an aircraft just across 180 deg is plotted east of a centre at 179.5', () => {
        const fiji = { hex: 'F1', callsign: 'FJI910', lat: -17.5, lon: -179.8, altitude_ft: 30000, heading: 90, speed_kts: 450 };
        const app = boot({ options: { centerLat: -17.5, centerLon: 179.5 }, rows: [fiji] });
        const calls = app.callsFor('FJI910');
        expect(calls.length).toBe(1);
        expect(calls[0][1]).toBeGreaterThan(window.innerWidth / 2);
    });
});
