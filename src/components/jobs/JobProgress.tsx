"use client";
import { useEffect, useState, type ReactNode } from 'react';
import { useAppPreferences } from '@/components/AppPreferences';
import { useAppTranslation } from '@/components/i18n/AppLanguageProvider';
import { progressForJob, type ProgressInput } from '@/lib/jobs/progress';
import { studioCopy } from '@/lib/studio-copy';
import styles from './JobProgress.module.css';
export default function JobProgress({ job, compact = false, ownerFallback = null }: { job: ProgressInput; compact?: boolean; ownerFallback?: ReactNode }) {
  const { isAdmin } = useAppPreferences();
  const { t, locale } = useAppTranslation();
  const c = studioCopy[locale];
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (isAdmin || ['completed', 'failed', 'cancelled', 'refunded'].includes(job.status)) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [job.status, isAdmin]);
  if (isAdmin) return ownerFallback;
  const progress = progressForJob(job, now);
  const label = progress.source === 'estimated' ? c.estimated : progress.source === 'segments' ? c.measured : c.complete;
  const status = progress.stale ? c.waiting : t(job.status);
  return <span className={`${styles.root} ${compact ? styles.compact : ''}`} data-progress-source={progress.source}>
    <span className={styles.heading}><span role="status" aria-live="polite">{status}</span>{progress.percent !== null && <strong>{label} · {progress.percent}%</strong>}</span>
    {progress.percent !== null && <span role="progressbar" aria-label={`${label}: ${status}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.percent} className={styles.track}><span style={{ width: `${progress.percent}%` }} /></span>}
    {progress.source === 'estimated' && <span className={styles.note}>{progress.delayed ? c.delayed : c.estimateNote}</span>}
    {progress.source === 'segments' && <span className={styles.note}>{progress.parts}/{progress.total} {c.clips}</span>}
  </span>;
}
