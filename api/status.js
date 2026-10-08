const SOURCE_URL = 'https://raw.githubusercontent.com/beloralabs-connect/connect-status/master/history/summary.json';
const SITE_URL = 'https://status.belora-connect.com';

function stateFor(value) {
    const status = String(value == null ? '' : value).toUpperCase();
    if (['UP', 'OPERATIONAL', 'OK', '1'].includes(status)) return 'operational';
    if (['DEGRADED', 'DEGRADED_PERFORMANCE', 'PARTIAL_OUTAGE', 'MAINTENANCE', '2'].includes(status)) return 'degraded';
    if (['DOWN', 'OUTAGE', 'MAJOR_OUTAGE', 'SERVICE_UNAVAILABLE', '0'].includes(status)) return 'down';
    return 'unknown';
}

function stateLabel(state) {
    return { operational: 'Operational', degraded: 'Degraded', down: 'Service unavailable', unknown: 'No data received yet' }[state] || 'No data received yet';
}

function overallState(components) {
    if (!components.length || components.every((component) => component.state === 'unknown')) return 'unknown';
    if (components.some((component) => component.state === 'down')) return 'down';
    if (components.some((component) => component.state === 'degraded')) return 'degraded';
    return 'operational';
}

function numberOrNull(value) {
    if (value == null || value === '') return null;
    const number = typeof value === 'string' ? parseFloat(value.replace('%', '')) : Number(value);
    return Number.isFinite(number) ? number : null;
}

function normalize(summary) {
    const list = Array.isArray(summary) ? summary : (summary && (summary.services || summary.monitors || summary.data)) || [];
    return Array.isArray(list) ? list.map((service) => {
        const state = stateFor(service.status);
        return {
            id: String(service.slug || service.name || ''),
            name: service.name || 'Connect service',
            slug: service.slug || '',
            url: service.url || '',
            status: stateLabel(state),
            state,
            responseTimeMs: numberOrNull(service.time),
            uptime: {
                day: numberOrNull(service.uptimeDay),
                week: numberOrNull(service.uptimeWeek),
                month: numberOrNull(service.uptimeMonth),
                year: numberOrNull(service.uptimeYear),
            },
            dailyMinutesDown: service.dailyMinutesDown || {},
        };
    }) : [];
}

export default async function handler(req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.setHeader('Allow', 'GET, HEAD');
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const response = await fetch(SOURCE_URL, { headers: { Accept: 'application/json' } });
        if (!response.ok) throw new Error('Status source returned ' + response.status);
        const components = normalize(await response.json());
        const state = overallState(components);
        const payload = {
            page: {
                name: 'BeLora Connect Status',
                url: SITE_URL,
                status: stateLabel(state),
                state,
            },
            components,
            activeIncidents: [],
            activeMaintenances: [],
            updatedAt: new Date().toISOString(),
        };

        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=60, stale-while-revalidate=300');
        return res.status(200).json(req.method === 'HEAD' ? {} : payload);
    } catch (error) {
        console.error('[PUBLIC STATUS API]', error);
        res.setHeader('Cache-Control', 'no-store');
        return res.status(502).json({ error: 'Unable to load current status' });
    }
}
