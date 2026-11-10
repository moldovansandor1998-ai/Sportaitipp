/** Open a single-file picker while keeping its input attached until it settles. */
export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.hidden = true;

    const cleanup = () => {
      input.removeEventListener("change", onChange);
      input.removeEventListener("cancel", onCancel);
      input.remove();
    };
    const finish = (file: File | null) => {
      cleanup();
      resolve(file);
    };
    const onChange = () => finish(input.files?.[0] ?? null);
    const onCancel = () => finish(null);
    input.addEventListener("change", onChange);
    input.addEventListener("cancel", onCancel);

    // Detached inputs cannot be populated reliably by every browser/file chooser.
    // Keep click synchronous so the browser still has the user's activation.
    try {
      document.body.appendChild(input);
      input.click();
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}
