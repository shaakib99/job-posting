import { NextResponse } from 'next/server';
import { fetchAndStoreJobs } from '@/lib/jobs';

export async function POST() {
  const result = await fetchAndStoreJobs();
  return NextResponse.json(result);
}
