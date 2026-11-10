import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync, existsSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { APP_LOCALES, translateApp, type AppLocale } from '@/lib/app-i18n';
const state = vi.hoisted(() => ({ locale: 'en' as AppLocale, owner: false }));
vi.mock('@/components/i18n/AppLanguageProvider', () => ({ useAppTranslation: () => ({ locale: state.locale, t: (s: string) => translateApp(state.locale, s) }) }));
vi.mock('@/components/AppPreferences', () => ({ useAppPreferences: () => ({ isAdmin: state.owner }) }));
import Dashboard from '@/app/(app)/dashboard/page';
import VideoShowcase from '@/components/marketing/VideoShowcase';
import JobProgress from '@/components/jobs/JobProgress';
Object.assign(globalThis, { React });
describe('studio redesign safety and content', () => {
  it.each(APP_LOCALES)('renders customer studio and own promotional videos in %s', locale => {
    state.locale = locale; state.owner = false;
    const html = renderToStaticMarkup(React.createElement(Dashboard));
    expect(html).toContain('studio-welcome'); expect(html).toContain('/characters/new'); expect(html).toContain('/gallery');
    const media = renderToStaticMarkup(React.createElement(VideoShowcase, { locale }));
    expect(media.match(/<video/g)).toHaveLength(2); expect(media).toContain('preload="none"'); expect(media).not.toContain('autoplay');
    expect(media).not.toContain('youtube'); expect(media).not.toContain('supabase'); expect(media).not.toContain('token=');
  });
  it('preserves the original owner dashboard', () => {
    state.owner = true; state.locale = 'hu';
    const html = renderToStaticMarkup(React.createElement(Dashboard));
    expect(html).not.toContain('studio-welcome'); expect(html).toContain('Az első mérföldkő célja');
    expect(readFileSync('src/app/globals.css','utf8')).not.toContain('.owner-workspace {');
  });
  it('provides accessible estimated progress and hides false completion after failure', () => {
    state.locale = 'en'; state.owner = false;
    const processing = renderToStaticMarkup(React.createElement(JobProgress, { job: { status: 'processing' } }));
    expect(processing).toContain('Estimated'); expect(processing).toContain('role="progressbar"'); expect(processing).toContain('aria-valuenow="12"');
    const failed = renderToStaticMarkup(React.createElement(JobProgress, { job: { status: 'failed' } }));
    expect(failed).not.toContain('progressbar'); expect(failed).not.toContain('100%');
  });
  it('keeps original owner status markup without progress meters', () => {
    state.owner = true;
    const html = renderToStaticMarkup(React.createElement(JobProgress, { job: { status: 'processing' }, ownerFallback: React.createElement('span', { className: 'badge' }, 'processing') }));
    expect(html).toBe('<span class="badge">processing</span>');
  });
  it('ships only the approved promotional media paths, without customer assets', () => {
    for (const file of ['cinematic-models','product-studio']) for (const ext of ['mp4','jpg']) expect(existsSync(`public/media/showcase/${file}.${ext}`)).toBe(true);
    expect(readFileSync('src/components/marketing/VideoShowcase.tsx','utf8')).not.toContain('generation_jobs');
  });
});
