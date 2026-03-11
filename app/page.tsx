'use client';

import { FormEvent, useEffect, useState } from 'react';
import dayjs from 'dayjs';

type Source = {
  id: number;
  name: string;
  source_url: string;
  feed_url: string | null;
  enabled: number;
};

type Job = {
  id: number;
  title: string;
  company: string | null;
  location: string | null;
  apply_url: string;
  posted_at: string | null;
  source_name: string;
};

type SyncDetail = {
  source: string;
  inserted: number;
  status: 'ok' | 'skipped' | 'error';
  message?: string;
};

type SyncResponse = {
  inserted: number;
  scannedSources: number;
  details: SyncDetail[];
};

const emptySource = { name: '', source_url: '', feed_url: '' };

export default function Home() {
  const [sources, setSources] = useState<Source[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [keyword, setKeyword] = useState('');
  const [createdAfter, setCreatedAfter] = useState('');
  const [newSource, setNewSource] = useState(emptySource);
  const [loading, setLoading] = useState(false);
  const [syncSummary, setSyncSummary] = useState<SyncResponse | null>(null);

  async function loadSources() {
    const res = await fetch('/api/sources');
    setSources(await res.json());
  }

  async function loadJobs(term = keyword, created = createdAfter) {
    const params = new URLSearchParams();
    if (term) params.set('keyword', term);
    if (created) params.set('createdAfter', created);
    const query = params.toString() ? `?${params.toString()}` : '';
    const res = await fetch(`/api/jobs${query}`);
    setJobs(await res.json());
  }

  useEffect(() => {
    loadSources();
    loadJobs('', '');
  }, []);

  async function addSource(e: FormEvent) {
    e.preventDefault();
    await fetch('/api/sources', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...newSource, enabled: true })
    });
    setNewSource(emptySource);
    loadSources();
  }

  async function toggleSource(source: Source) {
    await fetch(`/api/sources/${source.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: !source.enabled })
    });
    loadSources();
  }

  async function syncJobs() {
    setLoading(true);
    const response = await fetch('/api/jobs/fetch', { method: 'POST' });
    const summary = (await response.json()) as SyncResponse;
    setSyncSummary(summary);
    await loadJobs();
    setLoading(false);
  }

  return (
    <main className="container grid" style={{ gridTemplateColumns: '360px 1fr' }}>
      <section className="card grid" style={{ alignContent: 'start' }}>
        <h2>Job Sources</h2>
        <p style={{ marginTop: -10, opacity: 0.8 }}>
          Enable/disable and add sources. Use `json:https://...` for JSON APIs or regular URL for RSS.
        </p>

        <form onSubmit={addSource} className="grid">
          <input
            placeholder="Source name"
            required
            value={newSource.name}
            onChange={(e) => setNewSource((prev) => ({ ...prev, name: e.target.value }))}
          />
          <input
            placeholder="Career page URL"
            required
            value={newSource.source_url}
            onChange={(e) => setNewSource((prev) => ({ ...prev, source_url: e.target.value }))}
          />
          <input
            placeholder="Feed URL (RSS) or json:https://api..."
            value={newSource.feed_url}
            onChange={(e) => setNewSource((prev) => ({ ...prev, feed_url: e.target.value }))}
          />
          <button type="submit">Add Source</button>
        </form>

        <div style={{ maxHeight: 420, overflowY: 'auto' }}>
          {sources.map((source) => (
            <div key={source.id} style={{ padding: '8px 0', borderBottom: '1px solid #1f2a44' }}>
              <strong>{source.name}</strong>
              <div style={{ fontSize: 12, opacity: 0.8 }}>{source.feed_url ?? 'Manual source (no feed)'}</div>
              <button onClick={() => toggleSource(source)} style={{ marginTop: 6 }}>
                {source.enabled ? 'Disable' : 'Enable'}
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className="card grid" style={{ alignContent: 'start' }}>
        <h1 style={{ marginBottom: 4 }}>Job Dashboard</h1>
        <p style={{ marginTop: 0, opacity: 0.8 }}>
          Pulls recent jobs from enabled sources. Click Apply to jump to the original posting.
        </p>

        <div style={{ display: 'flex', gap: 10 }}>
          <input
            style={{ flex: 1 }}
            placeholder="Filter by keyword, company, location"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
          />
          <input type="date" value={createdAfter} onChange={(e) => setCreatedAfter(e.target.value)} />
          <button onClick={() => loadJobs(keyword, createdAfter)}>Search</button>
          <button onClick={syncJobs}>{loading ? 'Syncing...' : 'Sync Jobs'}</button>
        </div>

        {syncSummary ? (
          <div className="card" style={{ padding: 12 }}>
            <strong>
              Sync result: {syncSummary.inserted} new jobs from {syncSummary.scannedSources} enabled sources
            </strong>
            <ul style={{ margin: '8px 0 0 20px' }}>
              {syncSummary.details.map((detail) => (
                <li key={detail.source}>
                  {detail.source}: {detail.status} ({detail.inserted})
                  {detail.message ? ` - ${detail.message}` : ''}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <table>
          <thead>
            <tr>
              <th>Title</th>
              <th>Company/Source</th>
              <th>Location</th>
              <th>Posted</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((job) => (
              <tr key={job.id}>
                <td>{job.title}</td>
                <td>{job.company ?? job.source_name}</td>
                <td>{job.location ?? '-'}</td>
                <td>{job.posted_at ? dayjs(job.posted_at).format('YYYY-MM-DD') : '-'}</td>
                <td>
                  <a href={job.apply_url} target="_blank" rel="noreferrer">
                    <button>Apply ↗</button>
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
