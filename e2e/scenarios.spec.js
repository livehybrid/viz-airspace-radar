/*
 * Data and option scenarios for the Airspace Radar on a real Splunk, in
 * Dashboard Studio (the viz is Studio-only: framework_type =
 * studio_visualization, so there is no Simple XML leg).
 *
 * What the scope drew is read from a recorder installed by an init script in
 * every frame: it wraps CanvasRenderingContext2D fillText/arc and snapshots
 * each frame's calls when the viz clears the canvas. The viz never reads the
 * recorder. Positions are checked by geometry measured from the drawing (blip
 * offset relative to the outer range ring), not by re-using the viz's layout
 * formula.
 */
const { test, expect, request } = require('@playwright/test');

const MGMT_URL = process.env.SPLUNK_MGMT_URL || 'https://localhost:8089';
const USER = process.env.SPLUNK_USER || 'admin';
const PASS = process.env.SPLUNK_PASSWORD || 'Changeme1!';
const APP = 'viz-airspace-radar';
const HOST_APP = 'search';

const TABLE = '| table hex, callsign, lat, lon, altitude_ft, heading, speed_kts';
// 1 nm is one minute of latitude.
const NM = 1 / 60;

function radarDashboard(title, query, options = {}, dsExtra = {}) {
    return {
        version: '2',
        title,
        dataSources: { ds: { type: 'ds.search', options: { query, ...dsExtra } } },
        visualizations: {
            viz_radar: {
                type: `${APP}.airspace_radar`,
                dataSources: { primary: 'ds' },
                options: { sweepSeconds: 2, ...options },
                title,
            },
        },
        inputs: {},
        defaults: {},
        layout: {
            type: 'grid',
            options: {},
            structure: [{ item: 'viz_radar', type: 'block', position: { x: 0, y: 0, w: 600, h: 500 } }],
        },
    };
}

const VIEWS = {
    // Due north and due east of the default centre (53.8, -1.55), 25 nm out.
    radar_e2e_geometry: radarDashboard('Radar geometry',
        `| makeresults | eval hex="N1", callsign="NORTH25", lat=53.8+25*${NM}, lon=-1.55, altitude_ft=30000, heading=0, speed_kts=400 ` +
        `| append [| makeresults | eval hex="E1", callsign="EAST25", lat=53.8, lon=-1.55+25*${NM}/cos(53.8*pi()/180), altitude_ft=20000, heading=90, speed_kts=300] ${TABLE}`),
    // Centre just west of the antimeridian; the aircraft is 0.7 deg east of it.
    radar_e2e_antimeridian: radarDashboard('Radar antimeridian',
        `| makeresults | eval hex="F1", callsign="FJI910", lat=-17.5, lon=-179.8, altitude_ft=30000, heading=90, speed_kts=450 ${TABLE}`,
        { centerLat: -17.5, centerLon: 179.5, rangeNm: 100, homeLabel: 'NADI' }),
    radar_e2e_empty: radarDashboard('Radar empty', `| makeresults | where 1=0 ${TABLE}`),
    // Wrong column names, nulls and strings where numbers belong.
    radar_e2e_malformed: radarDashboard('Radar malformed',
        '| makeresults count=3 | streamstats count as n | eval hex="M".n, callsign="BAD".n, ' +
        'latitude=53.9, longitude=-1.5, lat=if(n=1, null(), "north"), lon="east", altitude_ft="high", heading="left" ' +
        '| table hex, callsign, latitude, longitude, lat, lon, altitude_ft, heading'),
    // Every option wrong. Expected: defaults, so the aircraft due east of
    // Leeds is plotted right of centre, labels off ("false"), 50 nm rings.
    radar_e2e_badopts: radarDashboard('Radar bad options',
        `| makeresults | eval hex="E1", callsign="EAST25", lat=53.8, lon=-1.55+25*${NM}/cos(53.8*pi()/180), altitude_ft=20000, heading=90, speed_kts=300 ${TABLE}`,
        {
            showLabels: 'false', centerLat: 200, centerLon: 'west', rangeNm: 'Infinity',
            sweepSeconds: -3, colorScheme: 'toString', homeLabel: { a: 1 },
        }),
    // Alternates every 10 s between two aircraft (ALPHA1, ALPHA2) and one
    // other (BRAVO1), refreshed every 4 s: the scope must follow the data both
    // ways with no stale blips. (Zero rows would swap in Studio's placeholder.)
    radar_e2e_rerun: radarDashboard('Radar re-run',
        '| makeresults count=2 | streamstats count as n | eval phase=floor(now()/10)%2 | where n=1 OR phase=0 ' +
        '| eval tag=if(phase=0, "ALPHA", "BRAVO") ' +
        `| eval hex=tag.n, callsign=tag.n, lat=53.8+n*0.1, lon=-1.55, altitude_ft=10000, heading=0, speed_kts=250 ${TABLE}`,
        {}, { refresh: '4s', refreshType: 'delay' }),
};

const RECORDER = () => {
    const P = window.CanvasRenderingContext2D && window.CanvasRenderingContext2D.prototype;
    if (!P || P.__e2eWrapped) return;
    P.__e2eWrapped = true;
    const cur = { texts: [], arcs: [] };
    const rec = { last: null, count: 0 };
    Object.defineProperty(window, '__radarRec', { value: rec });
    const { clearRect, fillText, arc } = P;
    P.clearRect = function (x, y, ...rest) {
        if (x === 0 && y === 0) {
            rec.last = { texts: cur.texts.splice(0), arcs: cur.arcs.splice(0), w: window.innerWidth, h: window.innerHeight };
            rec.count++;
        }
        return clearRect.call(this, x, y, ...rest);
    };
    P.fillText = function (t, x, y, ...rest) { cur.texts.push({ t: String(t), x, y }); return fillText.call(this, t, x, y, ...rest); };
    P.arc = function (x, y, r, ...rest) { cur.arcs.push({ x, y, r }); return arc.call(this, x, y, r, ...rest); };
};

test.beforeAll(async () => {
    const api = await request.newContext({
        baseURL: MGMT_URL, ignoreHTTPSErrors: true, httpCredentials: { username: USER, password: PASS },
    });
    for (const [name, def] of Object.entries(VIEWS)) {
        const xml = `<dashboard version="2" theme="dark"><label>${def.title}</label>` +
            `<definition><![CDATA[${JSON.stringify(def)}]]></definition></dashboard>`;
        const create = await api.post(`/servicesNS/${USER}/${HOST_APP}/data/ui/views?output_mode=json`, { form: { name, 'eai:data': xml } });
        if (!create.ok()) {
            const update = await api.post(`/servicesNS/${USER}/${HOST_APP}/data/ui/views/${name}?output_mode=json`, { form: { 'eai:data': xml } });
            if (!update.ok()) throw new Error(`could not create/update ${name}: ${update.status()} ${await update.text()}`);
        }
    }
    await api.dispose();
});

async function openRadar(page, view) {
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    await page.addInitScript(RECORDER);
    await page.goto('/en-GB/account/login');
    await page.fill('input[name="username"]', USER);
    await page.fill('input[name="password"]', PASS);
    await page.press('input[name="password"]', 'Enter');
    await page.waitForURL((u) => /^\/[^/]+\/(app|launcher|home)\b/.test(new URL(u).pathname), { timeout: 60000 });
    await page.goto(`/en-GB/app/${HOST_APP}/${view}`);
    const deadline = Date.now() + 120000;
    while (Date.now() < deadline) {
        for (const f of page.frames()) {
            if (f === page.mainFrame()) continue;
            try {
                if (await f.$('canvas')) {
                    const recorded = await f.evaluate(() => !!window.__radarRec);
                    if (!recorded) throw new Error('canvas recorder not installed in the viz frame');
                    return { frame: f, vizErrors: () => errors.filter((e) => /airspace_radar|visualization\.js/.test(e)) };
                }
            } catch (e) { if (/recorder/.test(e.message)) throw e; }
        }
        await page.waitForTimeout(2000);
    }
    throw new Error(`no radar canvas in any viz frame of ${view}`);
}

const lastFrame = (radar) => radar.frame.evaluate(() => window.__radarRec.last);

/* Poll recorded frames until `pred(frame)` holds; return that frame. */
async function frameWhere(radar, pred, what, timeout = 60000) {
    let seen = null;
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        seen = await lastFrame(radar);
        if (seen && pred(seen)) return seen;
        await radar.frame.page().waitForTimeout(500);
    }
    throw new Error(`never saw a frame where ${what}; last frame texts: ${JSON.stringify(seen && seen.texts.map((t) => t.t))}`);
}

const texts = (fr) => fr.texts.map((t) => t.t);
/* Scope geometry measured from the drawing: the largest arc is the outer
 * range ring, its centre is the scope centre. Blips are radius-4 arcs away
 * from that centre. */
function geometry(fr) {
    const ring = fr.arcs.reduce((a, b) => (b.r > a.r ? b : a));
    const blips = fr.arcs.filter((a) => a.r === 4 && Math.hypot(a.x - ring.x, a.y - ring.y) > 6);
    return { ring, blips };
}

test('aircraft are plotted at their true bearing and range', async ({ page }) => {
    const radar = await openRadar(page, 'radar_e2e_geometry');
    const fr = await frameWhere(radar, (f) => texts(f).includes('NORTH25') && texts(f).includes('EAST25'), 'both callsigns drawn');
    expect(texts(fr)).toContain('N'); // positive control: the scope furniture is recorded too
    const { ring, blips } = geometry(fr);
    expect(blips).toHaveLength(2);
    const half = ring.r * 25 / 50;
    const north = blips.find((b) => b.y < ring.y - half / 2);
    const east = blips.find((b) => b.x > ring.x + half / 2);
    expect(north && Math.abs(north.x - ring.x)).toBeLessThan(3);
    expect(north && Math.abs(ring.y - north.y - half)).toBeLessThan(3);
    expect(east && Math.abs(east.y - ring.y)).toBeLessThan(3);
    expect(east && Math.abs(east.x - ring.x - half)).toBeLessThan(3);
    expect(radar.vizErrors()).toEqual([]);
});

test('an aircraft across the antimeridian is plotted east of the centre', async ({ page }) => {
    const radar = await openRadar(page, 'radar_e2e_antimeridian');
    const fr = await frameWhere(radar, (f) => texts(f).includes('NADI'), 'the centre label is drawn');
    // Give the search time to land, then require the blip.
    const withBlip = await frameWhere(radar, (f) => texts(f).includes('FJI910'), 'FJI910 is drawn', 45000)
        .catch(() => null);
    expect(withBlip, `FJI910 never drawn; texts: ${JSON.stringify(texts(fr))}`).not.toBeNull();
    const { ring, blips } = geometry(withBlip);
    expect(blips).toHaveLength(1);
    // 0.7 deg of longitude at 17.5 S is ~40 nm: 0.4 of a 100 nm ring.
    expect(blips[0].x - ring.x).toBeGreaterThan(ring.r * 0.35);
    expect(blips[0].x - ring.x).toBeLessThan(ring.r * 0.45);
    expect(radar.vizErrors()).toEqual([]);
});

// Platform behaviour, pinned: zero rows never reach the viz. Studio swaps
// the panel for its no-results placeholder and does not mount the iframe, so
// there is no stale scope left behind either. (10.6 labels the placeholder
// with a Warning icon, 10.4 does not, so the check is that nothing mounts.)
test('empty results: Studio shows its no-results placeholder, no stale scope', async ({ page }) => {
    let dispatched = false;
    page.on('request', (r) => {
        if (r.method() === 'POST' && /\/search\/(v2\/)?jobs(\?|$)/.test(r.url()) && (r.postData() || '').includes('where')) dispatched = true;
    });
    await page.goto('/en-GB/account/login');
    await page.fill('input[name="username"]', USER);
    await page.fill('input[name="password"]', PASS);
    await page.press('input[name="password"]', 'Enter');
    await page.waitForURL((u) => /^\/[^/]+\/(app|launcher|home)\b/.test(new URL(u).pathname), { timeout: 60000 });
    await page.goto(`/en-GB/app/${HOST_APP}/radar_e2e_empty`);
    await expect.poll(() => dispatched, { timeout: 60000 }).toBe(true);
    await page.waitForTimeout(15000);
    for (const f of page.frames()) {
        if (f === page.mainFrame()) continue;
        expect(await f.$('canvas').catch(() => null)).toBeNull();
    }
});

test('wrong field names, nulls and strings give a position message, not a crash', async ({ page }) => {
    const radar = await openRadar(page, 'radar_e2e_malformed');
    const fr = await frameWhere(radar, (f) => texts(f).includes('NO POSITION DATA (lat/lon)'), 'the position message is drawn');
    expect(texts(fr).filter((t) => /^BAD/.test(t))).toEqual([]);
    expect(geometry(fr).blips).toEqual([]);
    // Still animating after the bad data arrived.
    const n = await radar.frame.evaluate(() => window.__radarRec.count);
    await page.waitForTimeout(1000);
    expect(await radar.frame.evaluate(() => window.__radarRec.count)).toBeGreaterThan(n);
    expect(radar.vizErrors()).toEqual([]);
});

test('wrong-type and out-of-range options fall back to the defaults', async ({ page }) => {
    const radar = await openRadar(page, 'radar_e2e_badopts');
    const fr = await frameWhere(radar, (f) => geometry(f).blips.length === 1, 'one blip is drawn');
    const t = texts(fr);
    expect(t).toContain('Leeds'); // homeLabel object -> default
    expect(t).not.toContain('[object Object]');
    // rangeNm "Infinity" -> 50: ring labels at a quarter, half and three quarters.
    expect(t).toEqual(expect.arrayContaining(['13nm', '25nm', '38nm']));
    expect(t).not.toContain('EAST25'); // showLabels "false"
    expect(t).not.toContain('200FL');
    const { ring, blips } = geometry(fr);
    // centerLat 200 -> 53.8: the aircraft is due east, half way to the ring.
    expect(blips[0].x - ring.x).toBeGreaterThan(ring.r * 0.45);
    expect(blips[0].x - ring.x).toBeLessThan(ring.r * 0.55);
    expect(Math.abs(blips[0].y - ring.y)).toBeLessThan(3);
    expect(radar.vizErrors()).toEqual([]);
});

test('a re-run with different results updates the scope both ways, with no stale blips', async ({ page }) => {
    test.setTimeout(240000);
    const radar = await openRadar(page, 'radar_e2e_rerun');
    const alpha = await frameWhere(radar, (f) => texts(f).includes('ALPHA1') && texts(f).includes('ALPHA2'),
        'both ALPHA aircraft are drawn', 90000);
    expect(geometry(alpha).blips).toHaveLength(2);
    const bravo = await frameWhere(radar, (f) => texts(f).includes('BRAVO1'), 'the re-run BRAVO1 is drawn', 90000);
    expect(texts(bravo).filter((x) => /^ALPHA/.test(x))).toEqual([]);
    expect(geometry(bravo).blips).toHaveLength(1);
    // And back again: not a one-way latch.
    await frameWhere(radar, (f) => texts(f).includes('ALPHA2') && !texts(f).includes('BRAVO1'), 'ALPHA again with BRAVO gone', 90000);
    expect(radar.vizErrors()).toEqual([]);
});
