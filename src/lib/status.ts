export type ResumeStatus =
  | 'uploaded'
  | 'queued'
  | 'extracting_text'
  | 'structuring'
  | 'chunking'
  | 'embedding'
  | 'indexed'
  | 'failed'
  | 'needs_review'
  | (string & {});

export type DashboardTotals = {
  uploaded: number;
  processing: number;
  indexed: number;
  failed: number;
  review: number;
};

export type DashboardEvent =
  | {
      kind: 'background_job.updated';
      status: keyof DashboardTotals;
      delta: number;
    }
  | {
      kind: 'resume.status.updated';
      status: ResumeStatus;
      delta?: number;
    }
  | {
      kind: string;
      status: string;
      delta?: number;
    };

const STATUS_LABELS: Record<string, string> = {
  uploaded: 'Uploaded',
  queued: 'Queued for processing',
  extracting_text: 'Extracting text',
  structuring: 'Structuring',
  chunking: 'Chunking',
  embedding: 'Embedding',
  indexed: 'Indexed',
  failed: 'Failed',
  needs_review: 'Needs review'
};

export function labelForResumeStatus(status: string): string {
  return STATUS_LABELS[status] ?? humanize(status);
}

export function humanize(value: string): string {
  return value
    .replace(/[._-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function clampTotal(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

export function mergeDashboardTotals(
  totals: DashboardTotals,
  event: DashboardEvent
): DashboardTotals {
  if (event.kind !== 'background_job.updated' && event.kind !== 'resume.status.updated') {
    return totals;
  }

  const next = { ...totals };
  if (event.kind === 'background_job.updated') {
    const statusKey = event.status as keyof DashboardTotals;
    if (statusKey in next) {
      next[statusKey] = clampTotal(next[statusKey] + (event.delta ?? 1));
    }
    return next;
  }

  const delta = event.delta ?? 1;
  if (event.status === 'uploaded') {
    next.uploaded = clampTotal(next.uploaded + delta);
  }
  if (['queued', 'extracting_text', 'structuring', 'chunking', 'embedding'].includes(event.status)) {
    next.processing = clampTotal(next.processing + delta);
  }
  if (event.status === 'indexed') {
    next.indexed = clampTotal(next.indexed + delta);
  }
  if (event.status === 'failed') {
    next.failed = clampTotal(next.failed + delta);
  }
  if (event.status === 'needs_review') {
    next.review = clampTotal(next.review + delta);
  }
  return next;
}

const RESUME_FLOW = [
  'uploaded',
  'queued',
  'extracting_text',
  'structuring',
  'chunking',
  'embedding',
  'indexed'
] as const;

export function progressResumeStatus(status: string): string {
  if (status === 'failed' || status === 'needs_review') {
    return status;
  }

  const index = RESUME_FLOW.indexOf(status as (typeof RESUME_FLOW)[number]);
  if (index === -1) {
    return 'queued';
  }
  return RESUME_FLOW[Math.min(index + 1, RESUME_FLOW.length - 1)];
}

export function isActiveResumeStatus(status: string): boolean {
  return ['uploaded', 'queued', 'extracting_text', 'structuring', 'chunking', 'embedding'].includes(status);
}
