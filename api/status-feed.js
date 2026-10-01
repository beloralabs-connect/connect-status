const REPOSITORY = 'beloralabs-connect/connect-status';
const SITE_URL = 'https://status.belora-connect.com';

function escapeXml(value) {
    return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

function stripMarkdown(value) {
    return String(value || '')
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
        .replace(/^\s{0,3}#{1,6}\s*/gm, '')
        .replace(/[>*_~-]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function issueStatus(issue) {
    const body = String(issue.body || '');
    const match = body.match(/Status\s*:\s*(Service unavailable|Down|Degraded|Operational|Resolved|Investigating|Identified|Resolving)/i);
    if (match) return match[1];
    const labels = (issue.labels || []).map((label) => String(label.name || '').toLowerCase());
    return labels.includes('maintenance') ? 'Maintenance' : 'Update';
}

async function githubIssues() {
    const headers = {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'belora-connect-status-rss',
        'X-GitHub-Api-Version': '2022-11-28',
    };
    if (process.env.GITHUB_TOKEN) {
        headers.Authorization = 'Bearer ' + process.env.GITHUB_TOKEN;
    }

    const response = await fetch(
        'https://api.github.com/repos/' + REPOSITORY + '/issues?state=all&per_page=30',
        { headers },
    );
    if (!response.ok) throw new Error('GitHub returned ' + response.status);
    const issues = await response.json();
    return Array.isArray(issues) ? issues.filter((issue) => !issue.pull_request) : [];
}

export default async function handler(req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.setHeader('Allow', 'GET, HEAD');
        return res.status(405).send('Method not allowed');
    }

    try {
        const issues = await githubIssues();
        const items = issues.map((issue) => {
            const status = issueStatus(issue);
            const detail = stripMarkdown(issue.body) || 'A BeLora Connect status update was published.';
            const title = status + ' — ' + stripMarkdown(issue.title);
            const date = new Date(issue.updated_at || issue.created_at).toUTCString();
            return [
                '        <item>',
                '            <title>' + escapeXml(title) + '</title>',
                '            <link>' + escapeXml(issue.html_url) + '</link>',
                '            <guid isPermaLink="true">' + escapeXml(issue.html_url) + '</guid>',
                '            <pubDate>' + escapeXml(date) + '</pubDate>',
                '            <description>' + escapeXml(detail) + '</description>',
                '        </item>',
            ].join('\n');
        }).join('\n');

        const updated = new Date().toUTCString();
        const feedXml = [
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<rss version="2.0">',
            '    <channel>',
            '        <title>BeLora Connect updates</title>',
            '        <link>' + SITE_URL + '</link>',
            '        <description>Service status, incidents, maintenance, and availability updates from BeLora Connect.</description>',
            '        <language>en-us</language>',
            '        <lastBuildDate>' + escapeXml(updated) + '</lastBuildDate>',
            '        <ttl>1</ttl>',
            items,
            '    </channel>',
            '</rss>',
        ].join('\n');

        res.setHeader('Content-Type', 'application/rss+xml; charset=utf-8');
        res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=60, stale-while-revalidate=300');
        return res.status(200).send(req.method === 'HEAD' ? '' : feedXml);
    } catch (error) {
        console.error('[STATUS RSS]', error);
        res.setHeader('Cache-Control', 'no-store');
        return res.status(502).send('Unable to load status updates');
    }
}
