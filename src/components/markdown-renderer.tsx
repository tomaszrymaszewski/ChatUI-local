import {
  Children,
  isValidElement,
  memo,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import remarkGfm from "remark-gfm";
import rehypeKatex from "rehype-katex";
import { Highlight, Prism, themes } from "prism-react-renderer";
import { useTheme } from "next-themes";
import { FileCode, Loader2, MoreHorizontal } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { makeChartResponsive, parseChartSpec } from "@/lib/chart-spec";
import {
  copyDiagramPng,
  downloadDiagramPng,
  downloadDiagramSvg,
} from "@/lib/diagram-export";

interface MarkdownRendererProps {
  content: string;
  className?: string;
  onOpenArtifact?: (content: string, language: string) => void;
}

function normalizeLatexDelimiters(content: string): string {
  return content
    .replace(/\\\((.+?)\\\)/gs, (_, math) => `$$${math}$$`)
    .replace(/\\\[(.+?)\\\]/gs, (_, math) => `$$${math}$$`);
}

interface MathNode {
  type?: string;
  value?: unknown;
  children?: MathNode[];
}

/**
 * Render inline math in display style (like ChatGPT): TeX's text style packs
 * \frac numerator/denominator at script size, which reads as squished in
 * flowing text. \displaystyle keeps fractions and nested constructs full-size.
 * Single-dollar math is enabled below, so both $$…$$ and $…$ reach this
 * point; remark-math's pandoc-style guards keep prices like "$5 and $10"
 * literal (a closing $ followed by a digit never closes math).
 */
function remarkDisplayStyleMath() {
  const walk = (node: MathNode) => {
    if (
      node.type === "inlineMath" &&
      typeof node.value === "string" &&
      !/^\s*\\displaystyle\b/.test(node.value)
    ) {
      node.value = `\\displaystyle ${node.value}`;
    }
    node.children?.forEach(walk);
  };
  return (tree: MathNode) => walk(tree);
}

function processCitations(content: string): string {
  const headerMatch = content.match(/^(#{2,3}\s+Sources)\s*$/m);
  if (!headerMatch || headerMatch.index === undefined) return content;

  const body = content.slice(0, headerMatch.index);
  const sourcesSection = content.slice(headerMatch.index);

  const sources: Record<number, { title: string; url: string }> = {};
  for (const line of sourcesSection.split("\n")) {
    const m = line.match(/^\[(\d+)\]\s*(.+):\s+(https?:\/\/\S+)\s*$/);
    if (m) {
      sources[Number(m[1])] = { title: m[2].trim(), url: m[3].trim() };
      continue;
    }
    const urlOnly = line.match(/^\[(\d+)\]\s+(https?:\/\/\S+)\s*$/);
    if (urlOnly) {
      sources[Number(urlOnly[1])] = { title: urlOnly[2].trim(), url: urlOnly[2].trim() };
    }
  }

  if (Object.keys(sources).length === 0) return content;

  const processed = body.replace(
    /\[(\d+(?:,\s*\d+)*)\](?![(:])/g,
    (_match, nums: string) => {
      const parts = nums.split(/,\s*/).map((n) => {
        const num = Number(n);
        const src = sources[num];
        if (!src) return `[${n}]`;
        return `[[${n}]](${src.url} "${src.title.replace(/"/g, "'")}")`;
      });
      return parts.join(" ");
    },
  );

  return processed + sourcesSection;
}

function extractText(node: React.ReactNode): string {
  if (node == null) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (isValidElement(node)) {
    return extractText((node.props as { children?: React.ReactNode }).children);
  }
  return "";
}

function getCodeChild(
  children: React.ReactNode,
): { lang: string | null; text: string } | null {
  let found: { lang: string | null; text: string } | null = null;
  Children.forEach(children, (child) => {
    if (found || !isValidElement(child)) return;
    const props = child.props as { className?: string; children?: React.ReactNode };
    const langMatch =
      typeof props.className === "string"
        ? /language-([\w+-]+)/.exec(props.className)
        : null;
    found = {
      lang: langMatch ? langMatch[1].toLowerCase() : null,
      text: extractText(props.children),
    };
  });
  return found;
}

function FallbackBlock({
  code,
  error,
  label,
}: {
  code: string;
  error?: string | null;
  label: string;
}) {
  return (
    <div className="my-2 rounded-lg border bg-muted/30 p-3 text-[13px]">
      <div className="mb-1 font-medium text-destructive">
        {label}
        {error ? `: ${error.split("\n")[0].slice(0, 200)}` : ""}
      </div>
      <pre className="overflow-x-auto whitespace-pre-wrap text-muted-foreground">{code}</pre>
    </div>
  );
}

/** Three-dot menu in a diagram's top-right corner: save SVG/PNG, copy as image. */
function DiagramMenu({
  name,
  getSvg,
}: {
  name: string;
  getSvg: () => Promise<string> | string;
}) {
  const [busy, setBusy] = useState(false);

  const run = async (action: (svg: string) => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await action(await getSvg());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Diagram export failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="absolute right-1.5 top-1.5 z-10 flex size-7 items-center justify-center rounded-md border border-border bg-background opacity-0 shadow-lg transition-opacity hover:bg-accent focus-visible:opacity-100 group-hover/diagram:opacity-100 data-[state=open]:opacity-100"
          title="Save or copy diagram"
          aria-label="Save or copy diagram"
        >
          {busy ? (
            <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
          ) : (
            <MoreHorizontal className="size-3.5 text-muted-foreground" />
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => run(async (svg) => downloadDiagramSvg(svg, name))}>
          Save as SVG
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => run((svg) => downloadDiagramPng(svg, name))}>
          Save as PNG
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() =>
            run(async (svg) => {
              await copyDiagramPng(svg);
              toast.success("Copied to clipboard as PNG");
            })
          }
        >
          Copy as PNG
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

let mermaidExportSeq = 0;

async function renderMermaidSvg(
  id: string,
  code: string,
  htmlLabels: boolean,
): Promise<string> {
  const { default: mermaid } = await import("mermaid");
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: "neutral",
    // htmlLabels measure in the DOM (accurate widths) for the on-screen
    // diagram; export re-renders without them because foreignObject markup
    // taints the raster canvas ("Tainted canvases may not be exported").
    htmlLabels,
    // wrap keeps long labels inside their node boxes instead of clipping the
    // endings; padding adds breathing room around measured text.
    wrap: true,
    flowchart: { padding: 12 },
  });
  const rendered = await mermaid.render(id, code);
  return rendered.svg;
}

function MermaidBlock({ code }: { code: string }) {
  const rawId = useId();
  const id = useMemo(() => `mermaid-${rawId.replace(/[^a-zA-Z0-9]/g, "")}`, [rawId]);
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Debounced: while a ```mermaid fence is still streaming in, the code
  // changes on every tick and each change would otherwise re-run mermaid's
  // synchronous main-thread layout on partial source. The timer resets with
  // every code change, so rendering only starts once the source is stable.
  useEffect(() => {
    // A render attempted during a streaming pause can fail on partial source;
    // that transient error must not stick once the full code arrives.
    setError(null);
    let cancelled = false;
    const timer = setTimeout(() => {
      (async () => {
        try {
          const rendered = await renderMermaidSvg(id, code, true);
          if (!cancelled) setSvg(rendered);
        } catch (err) {
          if (!cancelled) setError(err instanceof Error ? err.message : String(err));
        }
      })();
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [code, id]);

  if (error) return <FallbackBlock label="Diagram failed to render" code={code} error={error} />;
  if (!svg) {
    return (
      <div className="my-2 rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
        Rendering diagram…
      </div>
    );
  }
  return (
    <div className="group/diagram relative my-2 overflow-x-auto rounded-lg bg-white p-3">
      {/* w-full + max-w-none! scale the diagram into the full block width
          (mermaid caps its SVG at the natural size with an inline max-width). */}
      <div
        className="[&_svg]:w-full [&_svg]:max-w-none!"
        dangerouslySetInnerHTML={{ __html: svg }}
      />
      <DiagramMenu
        name="diagram"
        getSvg={() => renderMermaidSvg(`${id}-export-${++mermaidExportSeq}`, code, false)}
      />
    </div>
  );
}

function VegaBlock({ spec }: { spec: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // Debounced like MermaidBlock: while a ```chart fence streams in, every tick
  // holds partial JSON and parsing it can only fail ("Unterminated string").
  // The timer resets with every change so embedding starts once stable, and a
  // transient failure never sticks past the next tick.
  useEffect(() => {
    setError(null);
    setDone(false);
    let cancelled = false;
    let finalize: (() => void) | undefined;
    const timer = setTimeout(() => {
      (async () => {
        try {
          const parsed = makeChartResponsive(parseChartSpec(spec));
          const { default: embed } = await import("vega-embed");
          if (cancelled || !ref.current) return;
          const result = await embed(ref.current, parsed, {
            actions: false,
            renderer: "svg",
          });
          if (cancelled) {
            result.finalize();
            return;
          }
          finalize = () => result.finalize();
          setDone(true);
        } catch (err) {
          if (!cancelled) setError(err instanceof Error ? err.message : String(err));
        }
      })();
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      finalize?.();
    };
  }, [spec]);

  if (error) return <FallbackBlock label="Chart failed to render" code={spec} error={error} />;
  return (
    <div className="group/diagram relative my-2 overflow-x-auto rounded-lg bg-white p-3">
      {/* display:block defeats vega-embed's injected `.vega-embed{display:inline-block}`:
          an inline-block wrapper shrink-wraps to 0 while the chart is still
          embedding, and width:"container" charts measure exactly that. Kept in
          layout (invisible, not display:none) so the measurement is real. */}
      <div ref={ref} style={{ display: "block" }} className={done ? undefined : "invisible"} />
      {!done && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
          Rendering chart…
        </div>
      )}
      <DiagramMenu
        name="chart"
        getSvg={() => {
          const svgEl = ref.current?.querySelector("svg");
          if (!svgEl) throw new Error("The chart is still rendering");
          return new XMLSerializer().serializeToString(svgEl);
        }}
      />
    </div>
  );
}

function SvgBlock({ svg }: { svg: string }) {
  const { resolvedTheme } = useTheme();
  const dark = resolvedTheme === "dark";
  const cleaned = useMemo(
    () =>
      svg
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, ""),
    [svg],
  );
  const doc = useMemo(() => {
    // Dark mode flips the diagram at the CSS layer (the LLM keeps drawing for
    // a light background): invert swaps black↔white and hue-rotate puts the
    // hues back, so dark colors become their light counterparts (a black line
    // turns white on the chat background, dark blue becomes light blue). The
    // document background stays transparent so the iframe element's
    // bg-background (the chat background, not black) shows through.
    const style = dark
      ? "html,body{margin:0;height:100%}body{display:flex;align-items:center;justify-content:center;background:transparent}svg{max-width:100%;max-height:100%;filter:invert(1) hue-rotate(180deg)}"
      : "html,body{margin:0;height:100%}body{display:flex;align-items:center;justify-content:center;background:transparent}svg{max-width:100%;max-height:100%}";
    return `<!DOCTYPE html><html><head><style>${style}</style></head><body>${cleaned}</body></html>`;
  }, [cleaned, dark]);
  return (
    <div className="group/diagram relative my-2">
      <iframe
        title="Inline SVG"
        sandbox=""
        srcDoc={doc}
        className="w-full rounded-lg bg-background"
        style={{ height: 360 }}
      />
      <DiagramMenu name="diagram" getSvg={() => cleaned} />
    </div>
  );
}

const LANG_ALIASES: Record<string, string> = {
  js: "javascript",
  jsx: "jsx",
  ts: "typescript",
  tsx: "tsx",
  py: "python",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  html: "markup",
  xml: "markup",
  yml: "yaml",
  "c++": "cpp",
  "vega-lite": "json",
  vega: "json",
  chart: "json",
};

function normalizeLang(lang: string): string {
  return LANG_ALIASES[lang] ?? lang;
}

function HighlightedCode({ code, language }: { code: string; language: string }) {
  const { resolvedTheme } = useTheme();
  const theme = resolvedTheme === "dark" ? themes.vsDark : themes.oneLight;
  const supported = Boolean(
    (Prism.languages as Record<string, unknown>)[language],
  );
  if (!supported) {
    return (
      <pre className="my-2 overflow-x-auto rounded-lg border bg-muted/50 p-3 text-[13px]">
        <code>{code}</code>
      </pre>
    );
  }
  return (
    <Highlight code={code} language={language} theme={theme}>
      {({ tokens, getLineProps, getTokenProps }) => (
        <pre className="my-2 overflow-x-auto rounded-lg border bg-muted/50 p-3 text-[13px]">
          {tokens.map((line, i) => (
            <div key={i} {...getLineProps({ line })}>
              {line.map((token, key) => (
                <span key={key} {...getTokenProps({ token })} />
              ))}
            </div>
          ))}
        </pre>
      )}
    </Highlight>
  );
}

function CodeBlock({ children, className }: { children?: React.ReactNode; className?: string }) {
  return (
    <pre className={cn("my-2 overflow-x-auto rounded-lg border bg-muted/50 p-3 text-[13px]", className)}>
      <code>{children}</code>
    </pre>
  );
}

function Anchor({ href, children }: { href?: string; children?: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-primary underline underline-offset-2 hover:text-primary/80"
    >
      {children}
    </a>
  );
}

function BlockWrapper({
  children,
  onOpen,
}: {
  children: React.ReactNode;
  onOpen?: () => void;
}) {
  if (!onOpen) return <>{children}</>;
  return (
    <div className="group relative">
      {children}
      <button
        onClick={(e) => { e.stopPropagation(); onOpen(); }}
        className="absolute right-1.5 top-1.5 z-10 flex size-7 items-center justify-center rounded-md border border-border bg-background opacity-0 shadow-lg transition-opacity group-hover:opacity-100 hover:bg-accent"
        title="Open in artifact panel"
      >
        <FileCode className="size-3.5 text-muted-foreground" />
      </button>
    </div>
  );
}

export const MarkdownRenderer = memo(function MarkdownRenderer({
  content,
  className,
  onOpenArtifact,
}: MarkdownRendererProps) {
  const normalizedContent = useMemo(
    () => processCitations(normalizeLatexDelimiters(content)),
    [content],
  );

  const onOpenArtifactRef = useRef(onOpenArtifact);
  onOpenArtifactRef.current = onOpenArtifact;

  const components = useMemo(
    () => ({
      pre: ({ children }: React.ComponentProps<"pre">) => {
        const info = getCodeChild(children);
        if (info) {
          const text = info.text.replace(/\n$/, "");
          const open = onOpenArtifactRef.current;
          if (info.lang === "mermaid") return <MermaidBlock code={text} />;
          if (
            info.lang === "chart" ||
            info.lang === "vega" ||
            info.lang === "vega-lite" ||
            info.lang === "vegalite"
          ) {
            return <VegaBlock spec={text} />;
          }
          if (info.lang === "svg") return <SvgBlock svg={text} />;
          if (info.lang) {
            const normLang = normalizeLang(info.lang);
            return <BlockWrapper onOpen={open ? () => open(text, normLang) : undefined}><HighlightedCode code={text} language={normLang} /></BlockWrapper>;
          }
          return (
            <BlockWrapper onOpen={open ? () => open(text, "text") : undefined}>
              <CodeBlock>
                <code>{info.text}</code>
              </CodeBlock>
            </BlockWrapper>
          );
        }
        return <CodeBlock>{children}</CodeBlock>;
      },
      a: (props: React.ComponentProps<"a">) => {
        const text = extractText(props.children);
        if (/^\[\d+\]$/.test(text)) {
          return (
            <a
              href={props.href}
              target="_blank"
              rel="noopener noreferrer"
              title={props.title}
              className="inline-flex items-center rounded bg-blue-500/10 px-1 text-[0.75em] font-medium text-blue-600 no-underline transition-colors hover:bg-blue-500/20 hover:text-blue-700"
            >
              {props.children}
            </a>
          );
        }
        return <Anchor {...props} />;
      },
    }),
    [],
  );

  return (
    <div
      className={cn(
        "prose-chat max-w-none text-[15px] leading-[1.7] tracking-[0.02em]",
        "[&_p]:my-2.5 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0",
        "[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5",
        "[&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5",
        "[&_li]:my-1",
        "[&_h1]:mt-3 [&_h1]:mb-2 [&_h1]:text-xl [&_h1]:font-medium",
        "[&_h2]:mt-3 [&_h2]:mb-2 [&_h2]:text-lg [&_h2]:font-medium",
        "[&_h3]:mt-2 [&_h3]:mb-1.5 [&_h3]:text-base [&_h3]:font-medium",
        "[&_h4]:mt-2 [&_h4]:mb-1 [&_h4]:text-[15px] [&_h4]:font-medium",
        "[&_h5]:mt-2 [&_h5]:mb-1 [&_h5]:text-[15px] [&_h5]:font-medium",
        "[&_h6]:mt-2 [&_h6]:mb-1 [&_h6]:text-[15px] [&_h6]:font-medium",
        "[&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground",
        "[&_table]:my-2 [&_table]:w-full [&_table]:border-collapse",
        "[&_th]:border [&_th]:border-border [&_th]:px-2 [&_th]:py-1 [&_th]:font-medium [&_th]:bg-muted",
        "[&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1",
        "[&_hr]:my-3 [&_hr]:border-border",
        "[&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[13px] [&_code]:before:content-none [&_code]:after:content-none",
        "[&_pre_code]:bg-transparent [&_pre_code]:p-0",
        "[&_img]:max-w-full [&_img]:rounded-lg",
        "[&_strong]:font-medium",
        "[&_em]:italic",
        "[&_del]:line-through",
        className,
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm, [remarkMath, { singleDollarTextMath: true }], remarkDisplayStyleMath]}
        rehypePlugins={[rehypeKatex]}
        components={components}
      >
        {normalizedContent}
      </ReactMarkdown>
    </div>
  );
});
