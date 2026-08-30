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
import { FileCode } from "lucide-react";
import { cn } from "@/lib/utils";

interface MarkdownRendererProps {
  content: string;
  className?: string;
  onOpenArtifact?: (content: string, language: string) => void;
}

function normalizeLatexDelimiters(content: string): string {
  return content
    .replace(/\\\((.+?)\\\)/gs, (_, math) => `$${math}$`)
    .replace(/\\\[(.+?)\\\]/gs, (_, math) => `$$${math}$$`);
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

function MermaidBlock({ code }: { code: string }) {
  const rawId = useId();
  const id = useMemo(() => `mermaid-${rawId.replace(/[^a-zA-Z0-9]/g, "")}`, [rawId]);
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { default: mermaid } = await import("mermaid");
        mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: "neutral" });
        const rendered = await mermaid.render(id, code);
        if (!cancelled) setSvg(rendered.svg);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
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
    <div
      className="my-2 overflow-x-auto rounded-lg bg-white p-3 [&_svg]:max-w-full"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

function VegaBlock({ spec }: { spec: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let finalize: (() => void) | undefined;
    (async () => {
      try {
        const parsed = JSON.parse(spec);
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
    return () => {
      cancelled = true;
      finalize?.();
    };
  }, [spec]);

  if (error) return <FallbackBlock label="Chart failed to render" code={spec} error={error} />;
  return (
    <div className="my-2 overflow-x-auto rounded-lg bg-white p-3">
      <div ref={ref} className={done ? undefined : "hidden"} />
      {!done && <div className="text-xs text-muted-foreground">Rendering chart…</div>}
    </div>
  );
}

function SvgBlock({ svg }: { svg: string }) {
  const doc = useMemo(() => {
    const cleaned = svg
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, "");
    return `<!DOCTYPE html><html><head><style>html,body{margin:0;height:100%}body{display:flex;align-items:center;justify-content:center;background:#fff}svg{max-width:100%;max-height:100%}</style></head><body>${cleaned}</body></html>`;
  }, [svg]);
  return (
    <iframe
      title="Inline SVG"
      sandbox=""
      srcDoc={doc}
      className="my-2 w-full rounded-lg bg-white"
      style={{ height: 360 }}
    />
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
        "prose-chat max-w-none text-[15px] leading-[1.7] tracking-[0.01em]",
        "[&_p]:my-2.5 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0",
        "[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5",
        "[&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5",
        "[&_li]:my-1",
        "[&_h1]:mt-3 [&_h1]:mb-2 [&_h1]:text-xl [&_h1]:font-semibold",
        "[&_h2]:mt-3 [&_h2]:mb-2 [&_h2]:text-lg [&_h2]:font-semibold",
        "[&_h3]:mt-2 [&_h3]:mb-1.5 [&_h3]:text-base [&_h3]:font-semibold",
        "[&_h4]:mt-2 [&_h4]:mb-1 [&_h4]:text-[15px] [&_h4]:font-semibold",
        "[&_h5]:mt-2 [&_h5]:mb-1 [&_h5]:text-[15px] [&_h5]:font-semibold",
        "[&_h6]:mt-2 [&_h6]:mb-1 [&_h6]:text-[15px] [&_h6]:font-semibold",
        "[&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground",
        "[&_table]:my-2 [&_table]:w-full [&_table]:border-collapse",
        "[&_th]:border [&_th]:border-border [&_th]:px-2 [&_th]:py-1 [&_th]:font-medium [&_th]:bg-muted",
        "[&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1",
        "[&_hr]:my-3 [&_hr]:border-border",
        "[&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[13px] [&_code]:before:content-none [&_code]:after:content-none",
        "[&_pre_code]:bg-transparent [&_pre_code]:p-0",
        "[&_img]:max-w-full [&_img]:rounded-lg",
        "[&_strong]:font-semibold",
        "[&_em]:italic",
        "[&_del]:line-through",
        className,
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={components}
      >
        {normalizedContent}
      </ReactMarkdown>
    </div>
  );
});
