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
const JOB_HINT = /(job|career|position|opening|vacanc|requisition|opportunit|role|apply|workday|greenhouse|lever)/i;

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

function uniqueByApplyUrl(records: JobRecord[]) {
  const map = new Map<string, JobRecord>();
  for (const record of records) {
    if (!record.apply_url) continue;
    if (!map.has(record.apply_url)) {
      map.set(record.apply_url, record);
    }
  }
  return Array.from(map.values());
}

async function fetchText(url: string, accept = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8') {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; job-posting-dashboard/1.0)',
      Accept: accept
    },
    cache: 'no-store'
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }

  return response.text();
}

function extractJsonLdJobs(html: string, source: Source): JobRecord[] {
  const scripts = Array.from(
    html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)
  ).map((m) => m[1]);

  const records: JobRecord[] = [];

  for (const scriptContent of scripts) {
    try {
      const parsed = JSON.parse(scriptContent.trim());
      const nodes = Array.isArray(parsed) ? parsed : [parsed];

      for (const node of nodes) {
        const type = node?.['@type'];
        if (type === 'JobPosting') {
          const applyUrl = node.url ? absoluteUrl(source.source_url, node.url) : source.source_url;
          if (!applyUrl) continue;

          records.push({
            title: node.title ?? 'Job Opening',
            company: node.hiringOrganization?.name ?? source.name,
            location:
              node.jobLocation?.address?.addressLocality ??
              node.jobLocation?.address?.addressRegion ??
              node.jobLocation?.address?.addressCountry ??
              null,
            apply_url: applyUrl,
            posted_at: normalizeDate(node.datePosted ?? node.validFrom),
            external_id: String(node.identifier?.value ?? applyUrl),
            raw_json: JSON.stringify({ discovered_from: 'jsonld', node })
          });
        }
      }
    } catch {
      // ignore invalid JSON-LD
    }
  }

  return records;
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

function parseLooseUrls(html: string, baseUrl: string) {
  const found = new Set<string>();

  for (const match of html.matchAll(/https?:\/\/[^"'\s<>()]+/gi)) {
    if (JOB_HINT.test(match[0])) {
      found.add(match[0]);
    }
  }

  for (const match of html.matchAll(/"(\/[^"]*(job|career|position|opening)[^"]*)"/gi)) {
    const url = absoluteUrl(baseUrl, match[1]);
    if (url) found.add(url);
  }

  return Array.from(found);
}

function asJobRecord(source: Source, url: string, title?: string): JobRecord {
  const cleanTitle =
    title?.trim() || decodeURIComponent(url.split('/').pop() ?? 'Job Opening').replace(/[-_]/g, ' ').trim() || 'Job Opening';

  return {
    title: cleanTitle,
    company: source.name,
    location: null,
    apply_url: url,
    posted_at: null,
    external_id: url,
    raw_json: JSON.stringify({ discovered_from: 'crawl', url, title: cleanTitle })
  };
}

async function crawlSitemap(source: Source): Promise<JobRecord[]> {
  const root = new URL(source.source_url).origin;
  const sitemapCandidates = [
    `${root}/sitemap.xml`,
    `${root}/sitemap_index.xml`,
    `${root}/sitemap-index.xml`,
    `${root}/sitemaps.xml`
  ];

  for (const sitemapUrl of sitemapCandidates) {
    try {
      const xml = await fetchText(sitemapUrl, 'application/xml,text/xml;q=0.9,*/*;q=0.8');
      const locMatches = Array.from(xml.matchAll(/<loc>([^<]+)<\/loc>/gi)).map((m) => m[1]).slice(0, 2000);
      const filtered = locMatches.filter((loc) => JOB_HINT.test(loc));
      if (filtered.length === 0) continue;
      return filtered.slice(0, 120).map((url) => asJobRecord(source, url));
    } catch {
      // continue candidate sitemap
    }
  }

  return [];
}

async function crawlHtmlSource(source: Source): Promise<JobRecord[]> {
  const root = new URL(source.source_url).origin;
  const entryPoints = uniqueByApplyUrl(
    [
      source.source_url,
      `${root}/careers`,
      `${root}/career`,
      `${root}/jobs`,
      `${root}/job`,
      `${root}/join-us`
    ]
      .map((url) => ({ apply_url: url }))
      .map((x) => asJobRecord(source, x.apply_url))
  ).map((x) => x.apply_url);

  const collected: JobRecord[] = [];

  for (const entry of entryPoints) {
    try {
      const html = await fetchText(entry);

      const jsonLdJobs = extractJsonLdJobs(html, source);
      collected.push(...jsonLdJobs);

      const links = parseAnchors(html, entry)
        .filter((link) => JOB_HINT.test(link.href) || JOB_HINT.test(link.text))
        .slice(0, 200)
        .map((link) => asJobRecord(source, link.href, link.text));
      collected.push(...links);

      const loose = parseLooseUrls(html, entry).slice(0, 200).map((url) => asJobRecord(source, url));
      collected.push(...loose);
    } catch {
      // continue other entry points
    }
  }

  const unique = uniqueByApplyUrl(collected).slice(0, 150);
  if (unique.length > 0) return unique;

  return crawlSitemap(source);
}

async function syncRssSource(source: Source): Promise<JobRecord[]> {
  const feed = await parser.parseURL(source.feed_url as string);
  return feed.items.slice(0, 100).map((item) => ({
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

  const payload = (await response.json()) as { data?: any[]; jobs?: any[]; results?: any[]; postings?: any[] };
  const jobs = payload.data ?? payload.jobs ?? payload.results ?? payload.postings ?? [];

  if (!Array.isArray(jobs)) return [];

  return jobs.slice(0, 200).map((item) => ({
    title: item.title ?? item.position ?? item.name ?? 'Untitled role',
    company: item.company_name ?? item.company ?? source.name,
    location: Array.isArray(item.location) ? item.location.join(', ') : item.location ?? null,
    apply_url: item.url ?? item.apply_url ?? item.absolute_url ?? source.source_url,
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

      const deduped = uniqueByApplyUrl(records).filter((record) => Boolean(record.apply_url));

      let sourceInserted = 0;
      for (const record of deduped) {
        const result = insertJob.run({ source_id: source.id, ...record });
        sourceInserted += result.changes;
      }

      inserted += sourceInserted;
      details.push({
        source: source.name,
        inserted: sourceInserted,
        status: deduped.length > 0 ? 'ok' : 'skipped',
        message: `${deduped.length} discovered`
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
