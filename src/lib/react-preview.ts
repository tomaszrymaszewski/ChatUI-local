import esbuildWasmUrl from "esbuild-wasm/esbuild.wasm?url";

let esbuildPromise: Promise<typeof import("esbuild-wasm")> | null = null;

async function getEsbuild(): Promise<typeof import("esbuild-wasm")> {
  if (!esbuildPromise) {
    esbuildPromise = (async () => {
      const esbuild = await import("esbuild-wasm");
      await esbuild.initialize({ wasmURL: esbuildWasmUrl });
      return esbuild;
    })();
  }
  return esbuildPromise;
}

const REACT_VERSION = "18.3.1";

const IMPORT_MAP = {
  imports: {
    react: `https://esm.sh/react@${REACT_VERSION}`,
    "react/jsx-runtime": `https://esm.sh/react@${REACT_VERSION}/jsx-runtime`,
    "react-dom": `https://esm.sh/react-dom@${REACT_VERSION}?external=react`,
    "react-dom/client": `https://esm.sh/react-dom@${REACT_VERSION}/client?external=react`,
  },
};

/**
 * Compile a JSX/TSX artifact with esbuild-wasm and wrap it in a standalone
 * HTML document. React is pulled from esm.sh via an import map; the compiled
 * module is loaded from a blob URL, which requires the embedding iframe to be
 * sandboxed with allow-scripts + allow-same-origin.
 */
export async function buildReactPreviewDoc(
  code: string,
  loader: "jsx" | "tsx",
): Promise<{ doc: string; blobUrl: string }> {
  const esbuild = await getEsbuild();
  const result = await esbuild.transform(code, {
    loader,
    format: "esm",
    jsx: "automatic",
    target: "es2020",
  });

  const blobUrl = URL.createObjectURL(
    new Blob([result.code], { type: "text/javascript" }),
  );

  const doc = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<style>
  body { margin: 0; padding: 1rem; font-family: system-ui, -apple-system, sans-serif; background: #fff; color: #111; }
  pre.err { color: #b91c1c; white-space: pre-wrap; font-size: 12px; }
</style>
<script type="importmap">${JSON.stringify(IMPORT_MAP)}</script>
</head>
<body>
<div id="root"></div>
<script type="module">
  const rootEl = document.getElementById("root");
  try {
    const ReactMod = await import("react");
    const React = ReactMod.default ?? ReactMod;
    const { createRoot } = await import("react-dom/client");
    const mod = await import(${JSON.stringify(blobUrl)});
    const Component = mod.default;
    if (typeof Component !== "function") {
      throw new Error("The component has no default export.");
    }
    createRoot(rootEl).render(React.createElement(Component));
  } catch (err) {
    const pre = document.createElement("pre");
    pre.className = "err";
    pre.textContent = String((err && err.message) || err);
    rootEl.replaceChildren(pre);
  }
</script>
</body>
</html>`;

  return { doc, blobUrl };
}
