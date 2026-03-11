import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';

export async function GET(request: NextRequest) {
  const keyword = request.nextUrl.searchParams.get('keyword')?.trim();
  const createdAfter = request.nextUrl.searchParams.get('createdAfter')?.trim();

  const where: string[] = [];
  const params: unknown[] = [];

  if (keyword) {
    where.push("(jobs.title LIKE ? OR IFNULL(jobs.company, '') LIKE ? OR IFNULL(jobs.location, '') LIKE ?)");
    params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
  }

  if (createdAfter) {
    where.push('date(COALESCE(jobs.posted_at, jobs.created_at)) >= date(?)');
    params.push(createdAfter);
  }

  const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

  const jobs = db
    .prepare(
      `SELECT jobs.*, sources.name as source_name
       FROM jobs JOIN sources ON jobs.source_id = sources.id
       ${whereClause}
       ORDER BY COALESCE(jobs.posted_at, jobs.created_at) DESC
       LIMIT 500`
    )
    .all(...params);

  return NextResponse.json(jobs);
}
