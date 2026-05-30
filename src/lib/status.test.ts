import { describe, expect, it } from 'vitest';
import { labelForResumeStatus, mergeDashboardTotals } from './status';

describe('labelForResumeStatus', () => {
  it('maps known statuses to readable labels', () => {
    expect(labelForResumeStatus('queued')).toBe('Queued for processing');
    expect(labelForResumeStatus('needs_review')).toBe('Needs review');
  });

  it('falls back to a humanized label for unknown statuses', () => {
    expect(labelForResumeStatus('awaiting_parser')).toBe('Awaiting Parser');
  });
});

describe('mergeDashboardTotals', () => {
  it('adds incoming event counts into the live totals', () => {
    expect(
      mergeDashboardTotals(
        { uploaded: 2, processing: 1, indexed: 7, failed: 0, review: 1 },
        { kind: 'background_job.updated', status: 'processing', delta: 1 }
      )
    ).toEqual({ uploaded: 2, processing: 2, indexed: 7, failed: 0, review: 1 });
  });

  it('ignores unknown event kinds without breaking the totals', () => {
    expect(
      mergeDashboardTotals(
        { uploaded: 2, processing: 1, indexed: 7, failed: 0, review: 1 },
        { kind: 'workflow.ping', status: 'idle', delta: 99 }
      )
    ).toEqual({ uploaded: 2, processing: 1, indexed: 7, failed: 0, review: 1 });
  });
});
