import { describe, expect, it } from 'vitest';
import { progressForJob } from '@/lib/jobs/progress';
import { JOB_STATUSES } from '@/lib/jobs/states';
import { studioCopy } from '@/lib/studio-copy';
import { APP_LOCALES } from '@/lib/app-i18n';
const now = Date.parse('2026-11-09T10:00:00Z');
const job = { status: 'processing', type: 'image_generation', started_at: new Date(now - 90_000).toISOString(), checked_at: now };
describe('truthful job progress', () => {
  it('labels time-based progress as estimated', () => {
    const result = progressForJob(job, now);
    expect(result.source).toBe('estimated'); expect(result.percent).toBeGreaterThan(12); expect(result.percent).toBeLessThan(95);
  });
  it.each(JOB_STATUSES.filter(status => status !== 'completed'))('never reports 100 for %s, even after days', status => {
    const result = progressForJob({ ...job, status }, now + 86_400_000);
    expect(result.percent).not.toBe(100);
  });
  it('confirms 100 only from the completed status', () => expect(progressForJob({ ...job, status: 'completed' }, now).percent).toBe(100));
  it.each(['failed', 'cancelled', 'refunded', 'submission_uncertain', 'unknown'])('does not render progress for %s', status => {
    expect(progressForJob({ ...job, status }, now).percent).toBeNull();
  });
  it('hides a stale estimate after polling disconnects instead of pretending to work', () => {
    expect(progressForJob(job, now + 46_000)).toMatchObject({ percent: null, stale: true, source: 'unavailable' });
  });
  it('returns to a fresh estimate after reconnection', () => {
    expect(progressForJob({ ...job, checked_at: now + 30_000 }, now + 30_000)).toMatchObject({ stale: false, source: 'estimated' });
  });
  it('measures saved motion segments from the explicit persisted contract', () => {
    expect(progressForJob({ ...job, provider_meta: { motionSequence: true, segments: [1,2,3], parts: [1,2] } }, now)).toMatchObject({ percent: 66, source: 'segments', parts: 2, total: 3 });
  });
  it('waits for final completion even when all motion segments are saved', () => {
    expect(progressForJob({ ...job, provider_meta: { motionSequence: true, segments: [1], parts: [1] } }, now).percent).toBe(99);
  });
  it('does not fabricate provider progress from arbitrary metadata', () => {
    expect(progressForJob({ ...job, provider_meta: { progress: 100, percentage: 100 } }, now).source).toBe('estimated');
  });
  it('handles malformed dates, empty segments, future dates and missing timestamps', () => {
    for (const started_at of ['bad', undefined, new Date(now + 90_000).toISOString()]) {
      expect(progressForJob({ ...job, started_at, provider_meta: { motionSequence: true, parts: [], segments: [] } }, now).percent).toBe(12);
    }
  });
  it('warns when the expected time is exceeded but still remains below completion', () => {
    const result = progressForJob({ ...job, checked_at: now + 400_000 }, now + 400_000);
    expect(result.delayed).toBe(true); expect(result.percent).toBeLessThan(95);
  });
  it('bases reload progress on persisted start time rather than component lifetime', () => {
    expect(progressForJob(job, now)).toEqual(progressForJob({ ...job }, now));
  });
  it.each(APP_LOCALES)('has honest progress and studio text in %s', locale => {
    for (const value of Object.values(studioCopy[locale])) expect(value.length).toBeGreaterThan(2);
    expect(studioCopy[locale].estimateNote).toContain('100%');
  });
});
