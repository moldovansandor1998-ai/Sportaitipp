// Böngészős E2E füsttesztek (auth-mentes oldalak). A teljes auth-/generálós E2E-hez
// futó alkalmazás + Supabase kell (E2E_BASE_URL + INTEGRATION) – CI-ban fut.
import { test, expect } from "@playwright/test";

test.describe("nyilvános oldalak", () => {
  test("login oldal betöltődik", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByText("Bejelentkezés")).toBeVisible();
  });
  test("register oldal betöltődik, 18+ nyilatkozattal", async ({ page }) => {
    await page.goto("/register");
    await expect(page.getByText(/18 éves/)).toBeVisible();
  });
  test("terms és privacy elérhető", async ({ page }) => {
    await page.goto("/terms");
    await expect(page.getByText("Felhasználási feltételek")).toBeVisible();
    await page.goto("/privacy");
    await expect(page.getByText("Adatkezelési tájékoztató")).toBeVisible();
  });
  test("védett route átirányít loginra", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login/);
  });
});
