import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { workspaceMessages } from "@/lib/app-i18n/sections/workspace";
import { appMessages, APP_LOCALES, translateApp } from "@/lib/app-i18n";
import { EASY_FIELDS } from "@/lib/promptBuilder";
const files = ["gallery/page.tsx", "gallery/GalleryVideo.tsx", "characters/[id]/page.tsx", "generate/page.tsx", "model-studio/page.tsx", "x-comments/page.tsx", "admin/page.tsx", "content/page.tsx"];
const locales = APP_LOCALES.filter(locale => locale !== "hu");
function placeholders(text: string) { return [...text.matchAll(/\{([a-zA-Z_]\w*)\}/g)].map(match => match[1]).sort(); }
describe("workspace localization", () => {
  it.each(locales)("provides full %s copy and preserves interpolation tokens", locale => {
    const reference = workspaceMessages.en!;
    const dictionary = workspaceMessages[locale]!;
    expect(Object.keys(reference).length).toBeGreaterThan(370);
    expect(Object.keys(dictionary).sort()).toEqual(Object.keys(reference).sort());
    for (const [key, value] of Object.entries(dictionary)) {
      expect(value.trim(), key).not.toBe("");
      expect(placeholders(value), key).toEqual(placeholders(key));
    }
    for (const field of EASY_FIELDS) {
      expect(dictionary[field.label], field.label).toBeTruthy();
      expect(dictionary[field.placeholder], field.placeholder).toBeTruthy();
    }
  });
  it.each(files)("covers all translation calls in %s", relative => {
    const text = readFileSync(`src/app/(app)/${relative}`, "utf8");
    const source = ts.createSourceFile(relative, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && node.expression.getText(source) === "t" && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
        const key = node.arguments[0].text;
        for (const locale of locales) expect(appMessages[locale]?.[key], `${relative}: ${locale}: ${key}`).toBeTruthy();
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  });
  it("preserves identity names, prompt values, account IDs and audit reasons", () => {
    const comments = readFileSync("src/app/(app)/x-comments/page.tsx", "utf8");
    expect(comments).toContain('["Zsófia", "Petra", "Dorika", "Laura", "Dorina"].includes(c.name)');
    const content = readFileSync("src/app/(app)/content/page.tsx", "utf8");
    expect(content).toContain('useState("energetic")');
    expect(content).toContain('value="energetic"');
    expect(content).toContain("{ topic, audience, tone, cta }");
    const admin = readFileSync("src/app/(app)/admin/page.tsx", "utf8");
    expect(admin).toContain('reason: "admin UI megerősítéssel: nem fut provideroldali munka"');
    expect(admin).not.toContain('reason: t(');
    for (const locale of APP_LOCALES) {
      expect(translateApp(locale, "User's unchanged content: Zoë 123")).toBe("User's unchanged content: Zoë 123");
      expect(translateApp(locale, "{p0}: {p1}", { p0: "my-file.png", p1: "Provider diagnostic" })).toContain("Provider diagnostic");
    }
  });
});
