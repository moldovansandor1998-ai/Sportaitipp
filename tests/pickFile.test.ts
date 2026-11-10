import { afterEach, describe, expect, it, vi } from "vitest";
import { pickFile } from "@/lib/pickFile";

class FileInput extends EventTarget {
  type = "";
  accept = "";
  hidden = false;
  files: File[] | null = null;
  isConnected = false;
  click = vi.fn(() => expect(this.isConnected).toBe(true));
  remove = vi.fn(() => { this.isConnected = false; });
}

function mockDocument() {
  const inputs: FileInput[] = [];
  vi.stubGlobal("document", {
    createElement: vi.fn((tag: string) => {
      expect(tag).toBe("input");
      const input = new FileInput();
      inputs.push(input);
      return input;
    }),
    body: { appendChild: vi.fn((input: FileInput) => { input.isConnected = true; }) },
  });
  return inputs;
}

afterEach(() => vi.unstubAllGlobals());

describe("Tools file picker", () => {
  it("attaches before opening synchronously, preserves accept, then removes after selection", async () => {
    const inputs = mockDocument();
    const selected = pickFile("image/*");
    const input = inputs[0];
    expect(input.type).toBe("file");
    expect(input.accept).toBe("image/*");
    expect(input.hidden).toBe(true);
    expect(input.click).toHaveBeenCalledOnce();
    expect(input.isConnected).toBe(true);
    const file = new File(["image"], "photo.jpg", { type: "image/jpeg" });
    input.files = [file];
    input.dispatchEvent(new Event("change"));
    expect(await selected).toBe(file);
    expect(input.isConnected).toBe(false);
    input.dispatchEvent(new Event("cancel"));
    expect(input.remove).toHaveBeenCalledOnce();
  });

  it("settles cancellation and allows choosing the same file on a later attempt", async () => {
    const inputs = mockDocument();
    const cancelled = pickFile("video/mp4,.mp4");
    expect(inputs[0].accept).toBe("video/mp4,.mp4");
    inputs[0].dispatchEvent(new Event("cancel"));
    expect(await cancelled).toBeNull();
    expect(inputs[0].isConnected).toBe(false);

    const file = new File(["video"], "clip.mp4", { type: "video/mp4" });
    for (let attempt = 1; attempt <= 2; attempt++) {
      const selected = pickFile("video/mp4,.mp4");
      inputs[attempt].files = [file];
      inputs[attempt].dispatchEvent(new Event("change"));
      expect(await selected).toBe(file);
      expect(inputs[attempt].isConnected).toBe(false);
    }
    expect(inputs).toHaveLength(3);
  });

  it("treats a change with no file as cancellation", async () => {
    const inputs = mockDocument();
    const selected = pickFile("image/*");
    inputs[0].dispatchEvent(new Event("change"));
    expect(await selected).toBeNull();
    expect(inputs[0].isConnected).toBe(false);
  });

  it("removes the input and listeners if opening the chooser throws", async () => {
    const inputs = mockDocument();
    document.body.appendChild = vi.fn((input: FileInput) => {
      input.isConnected = true;
      input.click.mockImplementation(() => { throw new Error("Picker failed"); });
      return input;
    }) as typeof document.body.appendChild;
    await expect(pickFile("image/*")).rejects.toThrow("Picker failed");
    expect(inputs[0].isConnected).toBe(false);
    inputs[0].dispatchEvent(new Event("change"));
    inputs[0].dispatchEvent(new Event("cancel"));
    expect(inputs[0].remove).toHaveBeenCalledOnce();
  });
});
