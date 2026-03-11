import Parser from 'rss-parser';
import db from './db';

type Source = {
  id: number;
  name: string;
  source_url: string;
  feed_url: string | null;
};

type SyncDetail = {
  source: string;
  inserted: number;
  status: 'ok' | 'skipped' | 'error';
  message?: string;
};

type JobRecord = {
  title: string;
  company: string | null;
  location: string | null;
  apply_url: string;
  posted_at: string | null;
  external_id: string | null;
  raw_json: string;
};

const parser = new Parser();
const JOB_HINT = /(job|career|position|opening|vacanc|requisition|opportunit|role|apply)/i;

function normalizeDate(value?: string | null) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function stripHtml(value: string) {
  return value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function absoluteUrl(baseUrl: string, maybeUrl: string) {
  try {
    return new URL(maybeUrl, baseUrl).toString();
  } catch {
    return null;
  }
}

async function fetchHtml(url: string) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; job-posting-dashboard/1.0)',
      Accept: 'text/html,application/xhtml+xml'
    },
    cache: 'no-store'
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return response.text();
}

function parseAnchors(html: string, baseUrl: string) {
  const links: Array<{ href: string; text: string }> = [];
  const anchorRegex = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;

  for (const match of html.matchAll(anchorRegex)) {
    const rawHref = match[1]?.trim();
    const text = stripHtml(match[2] ?? '');
    if (!rawHref) continue;
    const href = absoluteUrl(baseUrl, rawHref);
    if (!href) continue;
    links.push({ href, text });
  }

  return links;
}

async function crawlSitemap(source: Source): Promise<JobRecord[]> {
  const sitemapCandidates = [
    new URL('/sitemap.xml', source.source_url).toString(),
    new URL('/sitemap_index.xml', source.source_url).toString()
  ];

  for (const sitemapUrl of sitemapCandidates) {
    try {
      const response = await fetch(sitemapUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; job-posting-dashboard/1.0)' },
        cache: 'no-store'
      });

      if (!response.ok) continue;
      const xml = await response.text();

      const locMatches = Array.from(xml.matchAll(/<loc>([^<]+)<\/loc>/gi)).map((m) => m[1]).slice(0, 400);
      const filtered = locMatches.filter((loc) => JOB_HINT.test(loc));

      if (filtered.length === 0) continue;

      return filtered.slice(0, 80).map((url) => ({
        title: decodeURIComponent(url.split('/').pop() ?? 'Job Opening').replace(/[-_]/g, ' ').trim() || 'Job Opening',
        company: source.name,
        location: null,
        apply_url: url,
        posted_at: null,
        external_id: url,
        raw_json: JSON.stringify({ discovered_from: 'sitemap', url })
      }));
    } catch {
      // try next sitemap candidate
    }
  }

  return [];
}

async function crawlHtmlSource(source: Source): Promise<JobRecord[]> {
  const html = await fetchHtml(source.source_url);
  const links = parseAnchors(html, source.source_url);

  const filtered = links.filter((link) => JOB_HINT.test(link.href) || JOB_HINT.test(link.text)).slice(0, 120);

  const unique = new Map<string, JobRecord>();
  for (const link of filtered) {
    if (unique.has(link.href)) continue;
    unique.set(link.href, {
      title: link.text || decodeURIComponent(link.href.split('/').pop() ?? 'Job Opening').replace(/[-_]/g, ' '),
      company: source.name,
      location: null,
      apply_url: link.href,
      posted_at: null,
      external_id: link.href,
      raw_json: JSON.stringify({ discovered_from: 'html', link })
    });
  }

  if (unique.size > 0) {
    return Array.from(unique.values()).slice(0, 80);
  }

  return crawlSitemap(source);
}

async function syncRssSource(source: Source): Promise<JobRecord[]> {
  const feed = await parser.parseURL(source.feed_url as string);
  return feed.items.slice(0, 60).map((item) => ({
    title: item.title ?? 'Untitled role',
    company: feed.title ?? source.name,
    location: (item as Record<string, string>).location ?? null,
    apply_url: item.link ?? source.source_url,
    posted_at: normalizeDate(item.pubDate),
    external_id: item.guid ?? item.link ?? null,
    raw_json: JSON.stringify(item)
  }));
}

async function syncJsonSource(source: Source): Promise<JobRecord[]> {
  const endpoint = (source.feed_url as string).replace(/^json:/, '');
  const response = await fetch(endpoint, {
    headers: {
      'User-Agent': 'job-posting-dashboard/1.0',
      Accept: 'application/json'
    },
    cache: 'no-store'
  });

  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const payload = (await response.json()) as { data?: any[]; jobs?: any[]; results?: any[] };
  const jobs = payload.data ?? payload.jobs ?? payload.results ?? [];

  if (!Array.isArray(jobs)) return [];

  return jobs.slice(0, 100).map((item) => ({
    title: item.title ?? item.position ?? 'Untitled role',
    company: item.company_name ?? item.company ?? source.name,
    location: Array.isArray(item.location) ? item.location.join(', ') : item.location ?? null,
    apply_url: item.url ?? item.apply_url ?? source.source_url,
    posted_at: normalizeDate(item.created_at ?? item.published_at ?? item.date),
    external_id: String(item.slug ?? item.id ?? item.url ?? item.apply_url ?? Math.random()),
    raw_json: JSON.stringify(item)
  }));
}

export async function fetchAndStoreJobs() {
  const sources = db.prepare('SELECT id, name, source_url, feed_url FROM sources WHERE enabled = 1').all() as Source[];
  const insertJob = db.prepare(`
    INSERT OR IGNORE INTO jobs (source_id, title, company, location, apply_url, posted_at, external_id, raw_json)
    VALUES (@source_id, @title, @company, @location, @apply_url, @posted_at, @external_id, @raw_json)
  `);

  let inserted = 0;
  const details: SyncDetail[] = [];

  for (const source of sources) {
    try {
      let records: JobRecord[] = [];

      if (source.feed_url?.startsWith('json:')) {
        records = await syncJsonSource(source);
      } else if (source.feed_url) {
        records = await syncRssSource(source);
      } else {
        records = await crawlHtmlSource(source);
      }

      let sourceInserted = 0;
      for (const record of records) {
        const result = insertJob.run({ source_id: source.id, ...record });
        sourceInserted += result.changes;
      }

      inserted += sourceInserted;
      details.push({
        source: source.name,
        inserted: sourceInserted,
        status: 'ok',
        message: `${records.length} discovered`
      });
    } catch (error) {
      details.push({
        source: source.name,
        inserted: 0,
        status: 'error',
        message: error instanceof Error ? error.message : 'Unknown sync error'
      });
    }
  }

  return { inserted, scannedSources: sources.length, details };
}
