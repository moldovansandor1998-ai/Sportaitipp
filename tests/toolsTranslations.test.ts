import { describe, expect, it } from 'vitest';
import { toolsMessages } from '@/lib/app-i18n/sections/tools';
import { APP_LOCALES } from '@/lib/app-i18n';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const dictionary = toolsMessages as Record<string, Record<string, string>>;
const files = ['src/app/(app)/tools/page.tsx', 'src/components/VideoRedub.tsx'];
const placeholders = (text: string) => [...text.matchAll(/\{([a-zA-Z_]\w*)\}/g)].map(match => match[1]).sort();
describe('Tools and voice workflow translations', () => {
  it('has complete seven-language dictionaries with unchanged interpolation fields', () => {
    const keys = Object.keys(dictionary.en).sort();
    expect(keys.length).toBe(324);
    for (const locale of APP_LOCALES.filter(locale => locale !== 'hu')) {
      expect(Object.keys(dictionary[locale]).sort()).toEqual(keys);
      for (const key of keys) {
        expect(dictionary[locale][key].trim()).not.toBe('');
        expect(placeholders(dictionary[locale][key])).toEqual(placeholders(key));
      }
    }
    expect(dictionary.hu).toEqual({});
  });
  it('covers every literal translation call without importing unrelated dictionary sections', () => {
    for (const file of files) {
      const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const inspect = (node: ts.Node) => {
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 't' && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
          expect(dictionary.en[node.arguments[0].text], `${file}: ${node.arguments[0].text}`).toBeDefined();
        }
        ts.forEachChild(node, inspect);
      };
      inspect(source);
    }
  });
  it('preserves model identifiers, user speech, upload limits and paid action guards', () => {
    const tools = readFileSync(files[0], 'utf8');
    const voice = readFileSync(files[1], 'utf8');
    for (const value of ['seedream-v4.5','nano-banana','nureta','kling','720p','480p','/api/jobs/estimate','/api/nureta/video-prompt']) expect(tools).toContain(`"${value}"`);
    expect(tools).toContain('const [sceneText, setSceneText] = useState("Nekem is van egy másik');
    expect(voice).toContain('setText(TALKING_COMMENT_SCRIPT)');
    expect(voice).toContain('text: text.trim(), delivery');
    expect(voice).toContain('event.target.value as RedubDelivery');
    expect(voice).toContain('speechQuote?.key === signature');
    expect(voice).toContain('videoQuote?.key === videoKey');
    expect(tools).toContain('toLocaleString(locale)');
  });
});
