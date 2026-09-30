import { describe, expect, it } from "vitest";
import { looksHungarian } from "../src/server/x/hungarianText";

describe("Hungarian post filter", () => {
  it("accepts natural Hungarian text with and without accents", () => {
    expect(looksHungarian("Szerintem ez nagyon jó kép, te mit gondolsz róla?" )).toBe(true);
    expect(looksHungarian("na ez az abszolut filmszinhaz XDD https://t.co/x")).toBe(true);
  });
  it("rejects falsely labeled English and non-Hungarian posts", () => {
    expect(looksHungarian("HASEK-ESQUE #Canucks https://t.co/x")).toBe(false);
    expect(looksHungarian("[TikTok] Sakurazaka46 has uploaded a new TikTok! #Sakurazaka46")).toBe(false);
    expect(looksHungarian("Tapu ne Masti ki hogii. 👽 https://t.co/x")).toBe(false);
    expect(looksHungarian("Update on Ajni CSB, Nagpur. https://t.co/x")).toBe(false);
  });
});
