import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { APP_LOCALES, translateApp, type AppLocale } from '@/lib/app-i18n';
import { toolsMessages } from '@/lib/app-i18n/sections/tools';
const state = vi.hoisted(() => ({ locale: 'en' }));
vi.mock('@/components/i18n/AppLanguageProvider', () => ({
  useAppTranslation: () => ({ locale: state.locale, setLocale: () => {}, t: (source: string, vars?: Record<string, string | number>) => translateApp(state.locale as AppLocale, source, vars) }),
}));
import ToolsPage from '@/app/(app)/tools/page';
// The baseline test transform uses classic JSX while Next handles the app's automatic JSX runtime.
Object.assign(globalThis, { React });
describe('Tools initial render', () => {
  it.each(APP_LOCALES)('renders real labels in %s without altering the sample speech', locale => {
    state.locale = locale;
    const html = renderToStaticMarkup(React.createElement(ToolsPage));
    const expected = locale === 'hu' ? 'AI eszközök' : toolsMessages[locale]['AI eszközök'];
    expect(html).toContain(expected);
    expect(html).toContain('Nekem is van egy másik, vadabb énem.');
    expect(html).not.toMatch(/\{p\d+\}/);
    if (locale !== 'hu') {
      expect(html).not.toContain('Jelenetkép jóváhagyása');
      expect(html).not.toContain('Hangulat és előadásmód');
      expect(html).not.toContain('Válassz modellt');
    }
  });
});
