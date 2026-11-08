import { describe, it, expect } from "vitest";
import { APP_LOCALES, appMessages, translateApp, isAppLocale } from "@/lib/app-i18n";
import { readFileSync } from "node:fs";
import ts from "typescript";
const pages = ["(auth)/login", "(auth)/register", "auth/reset", "(app)/settings", "(app)/projects", "(app)/calendar", "(app)/jobs", "(app)/characters", "(app)/characters/new", "(app)/dashboard", "(app)/plans"];
function placeholders(value: string) { return [...value.matchAll(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g)].map(v => v[1]).sort(); }
describe("application localization", () => {
  it("supports exactly the eight requested languages", () => { expect(APP_LOCALES).toEqual(["en", "hu", "ro", "it", "de", "fr", "sk", "pl"]); expect(isAppLocale("zh")).toBe(false); expect(isAppLocale("../en")).toBe(false); });
  it("keeps all non-Hungarian dictionaries complete and preserves placeholders", () => {
    const keys = Object.keys(appMessages.en ?? {}); expect(keys.length).toBeGreaterThan(100);
    for (const locale of APP_LOCALES.filter(l => l !== "hu")) for (const key of keys) {
      const value = appMessages[locale]?.[key]; expect(value, `${locale}: ${key}`).toBeTruthy();
      expect(placeholders(value!), `${locale}: ${key}`).toEqual(placeholders(key));
    }
  });
  it("covers every literal translation key used by common customer pages", () => {
    for (const page of [...pages.map(page => `src/app/${page}/page.tsx`), "src/components/AppShell.tsx", "src/components/billing/CardSubscriptionPlans.tsx"]) {
      const source = readFileSync(page, "utf8");
      const file = ts.createSourceFile(page, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const check = (node: ts.Node) => {
        if (ts.isCallExpression(node) && node.expression.getText(file) === "t" && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
          const key = node.arguments[0].text;
          for (const locale of APP_LOCALES.filter(l => l !== "hu")) expect(appMessages[locale]?.[key], `${page} ${locale}: ${key}`).toBeTruthy();
        }
        if (ts.isPropertyAssignment(node) && node.name.getText(file) === "label" && ts.isStringLiteral(node.initializer)) {
          for (const locale of APP_LOCALES.filter(l => l !== "hu")) expect(appMessages[locale]?.[node.initializer.text], `${page} ${locale}: ${node.initializer.text}`).toBeTruthy();
        }
        ts.forEachChild(node, check);
      }; check(file);
    }
  });
  it("interpolates known values while preserving unrecognized text and tokens", () => {
    expect(translateApp("hu", "Model {name}", { name: "Zoë" })).toBe("Model Zoë");
    expect(translateApp("hu", "Model {name}")).toBe("Model {name}");
    expect(translateApp("pl", "user supplied text")).toBe("user supplied text");
  });
});
