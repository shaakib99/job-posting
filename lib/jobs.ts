import Parser from 'rss-parser';
import db from './db';

type Source = {
  id: number;
  name: string;
  source_url: string;
  feed_url: string | null;
};

const parser = new Parser();

export async function fetchAndStoreJobs() {
  const sources = db.prepare('SELECT id, name, source_url, feed_url FROM sources WHERE enabled = 1').all() as Source[];
  const insertJob = db.prepare(`
    INSERT OR IGNORE INTO jobs (source_id, title, company, location, apply_url, posted_at, external_id, raw_json)
    VALUES (@source_id, @title, @company, @location, @apply_url, @posted_at, @external_id, @raw_json)
  `);

  let inserted = 0;

  for (const source of sources) {
    if (!source.feed_url) continue;

    try {
      const feed = await parser.parseURL(source.feed_url);
      for (const item of feed.items.slice(0, 40)) {
        const result = insertJob.run({
          source_id: source.id,
          title: item.title ?? 'Untitled role',
          company: feed.title ?? source.name,
          location: (item as Record<string, string>).location ?? null,
          apply_url: item.link ?? source.source_url,
          posted_at: item.pubDate ? new Date(item.pubDate).toISOString() : null,
          external_id: item.guid ?? item.link ?? null,
          raw_json: JSON.stringify(item)
        });
        inserted += result.changes;
      }
    } catch {
      // intentionally ignore one bad source so the rest can still sync
    }
  }

  return { inserted, scannedSources: sources.length };
}
