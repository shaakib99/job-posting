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

const parser = new Parser();

function normalizeDate(value?: string | null) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

async function syncRssSource(source: Source) {
  const feed = await parser.parseURL(source.feed_url as string);
  return feed.items.slice(0, 40).map((item) => ({
    title: item.title ?? 'Untitled role',
    company: feed.title ?? source.name,
    location: (item as Record<string, string>).location ?? null,
    apply_url: item.link ?? source.source_url,
    posted_at: normalizeDate(item.pubDate),
    external_id: item.guid ?? item.link ?? null,
    raw_json: JSON.stringify(item)
  }));
}

async function syncJsonSource(source: Source) {
  const endpoint = (source.feed_url as string).replace(/^json:/, '');
  const response = await fetch(endpoint, {
    headers: {
      'User-Agent': 'job-posting-dashboard/1.0',
      Accept: 'application/json'
    },
    cache: 'no-store'
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const payload = (await response.json()) as { data?: any[] };
  const jobs = Array.isArray(payload.data) ? payload.data : [];

  return jobs.slice(0, 60).map((item) => ({
    title: item.title ?? 'Untitled role',
    company: item.company_name ?? source.name,
    location: Array.isArray(item.location) ? item.location.join(', ') : item.location ?? null,
    apply_url: item.url ?? source.source_url,
    posted_at: normalizeDate(item.created_at ?? item.published_at),
    external_id: String(item.slug ?? item.id ?? item.url ?? Math.random()),
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
    if (!source.feed_url) {
      details.push({ source: source.name, inserted: 0, status: 'skipped', message: 'No feed_url configured.' });
      continue;
    }

    try {
      const records = source.feed_url.startsWith('json:') ? await syncJsonSource(source) : await syncRssSource(source);
      let sourceInserted = 0;
      for (const record of records) {
        const result = insertJob.run({ source_id: source.id, ...record });
        sourceInserted += result.changes;
      }
      inserted += sourceInserted;
      details.push({ source: source.name, inserted: sourceInserted, status: 'ok' });
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
