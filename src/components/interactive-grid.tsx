import { useEffect, useRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  BookOpen,
  Brain,
  Bug,
  Boxes,
  Braces,
  Cloud,
  Code,
  Compass,
  Cpu,
  Database,
  FileCode,
  FileText,
  FolderGit2,
  GitBranch,
  GitCommit,
  Globe,
  GraduationCap,
  Hash,
  Image,
  KeyRound,
  Lightbulb,
  MessageSquare,
  Music,
  Network,
  Paperclip,
  PenLine,
  Search,
  Server,
  Sparkles,
  SquareTerminal,
  Star,
  Telescope,
  Terminal,
  Webhook,
  Workflow,
  Wrench,
  Zap,
} from "lucide-react";

const CHAT_ICONS = [
  Brain, GraduationCap, Lightbulb, Search, Globe, FileText,
  MessageSquare, Sparkles, Star, Compass, Telescope, Hash,
  Music, Zap, Paperclip, Image, PenLine, BookOpen,
];

const AGENT_ICONS = [
  Code, Wrench, SquareTerminal, GitBranch, Bug, Cpu,
  Database, Cloud, Braces, Boxes, Server, Network,
  Webhook, Workflow, KeyRound, Hash, Sparkles, Zap,
  Terminal, FileCode, FolderGit2, GitCommit,
];

const SPACING = 36;
const ICON_PX = 14;
const WAVE_DURATION = 1800;
const WAVE_WAVELENGTH = 220;

const spriteCache = new Map<string, HTMLCanvasElement[]>();

async function generateSprites(mode: string): Promise<HTMLCanvasElement[]> {
  const cached = spriteCache.get(mode);
  if (cached) return cached;

  const icons = mode === "agent" ? AGENT_ICONS : CHAT_ICONS;
  const dpr = window.devicePixelRatio || 1;
  const px = Math.ceil(ICON_PX * dpr);

  const sprites = await Promise.all(
    icons.map(
      (Icon) =>
        new Promise<HTMLCanvasElement>((resolve, reject) => {
          const svg = renderToStaticMarkup(
            <Icon size={ICON_PX} strokeWidth={1.5} color="white" />,
          );
          const dataUrl = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
          const img = document.createElement("img");
          img.onload = () => {
            const c = document.createElement("canvas");
            c.width = px;
            c.height = px;
            const ictx = c.getContext("2d")!;
            ictx.drawImage(img, 0, 0, px, px);
            resolve(c);
          };
          img.onerror = reject;
          img.src = dataUrl;
        }),
    ),
  );

  spriteCache.set(mode, sprites);
  return sprites;
}

export function InteractiveGrid({
  className,
  mode = "chat",
  origin,
}: {
  className?: string;
  mode?: "chat" | "agent";
  origin?: { x: number; y: number };
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;

    let sprites: HTMLCanvasElement[] = [];
    let cellsX = new Float32Array(0);
    let cellsY = new Float32Array(0);
    let iconIdx = new Uint8Array(0);
    let cols = 0;
    let rows = 0;
    let cw = 0;
    let ch = 0;
    let raf = 0;
    let disposed = false;
    let waveStart = 0;

    const computeCells = () => {
      const rect = canvas.getBoundingClientRect();
      cw = rect.width;
      ch = rect.height;
      if (cw === 0 || ch === 0) return;

      canvas.width = Math.round(cw * dpr);
      canvas.height = Math.round(ch * dpr);

      cols = Math.ceil(cw / SPACING);
      rows = Math.ceil(ch / SPACING);
      const total = cols * rows;
      cellsX = new Float32Array(total);
      cellsY = new Float32Array(total);
      iconIdx = new Uint8Array(total);

      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const i = r * cols + c;
          cellsX[i] = c * SPACING + SPACING / 2;
          cellsY[i] = r * SPACING + SPACING / 2;
          iconIdx[i] = i % sprites.length;
        }
      }
    };

    const drawWave = () => {
      if (disposed || !sprites.length || cw === 0) return;
      const elapsed = performance.now() - waveStart;

      if (elapsed >= WAVE_DURATION) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        raf = 0;
        return;
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const progress = elapsed / WAVE_DURATION;
      const iconPx = ICON_PX * dpr;
      const total = cols * rows;

      if (mode === "agent" && !origin) {
        const eased = 1 - Math.pow(1 - progress, 2.5);
        const wavePos = eased * (ch + 120);

        for (let i = 0; i < total; i++) {
          const cellY = cellsY[i];
          const cellX = cellsX[i];
          const diff = wavePos - cellY;

          if (diff > 0 && diff < WAVE_WAVELENGTH) {
            const t = 1 - diff / WAVE_WAVELENGTH;
            const ts = t * t * (3 - 2 * t);
            const sz = iconPx * (0.7 + ts * 0.6);
            const sprite = sprites[iconIdx[i]];
            if (sprite) {
              ctx.globalAlpha = ts * 0.5 * (1 - progress * 0.3);
              ctx.drawImage(
                sprite,
                cellX * dpr - sz / 2,
                cellY * dpr - sz / 2,
                sz,
                sz,
              );
            }
          }
        }
      } else {
        const cx0 = origin ? origin.x * cw : cw / 2;
        const cy0 = origin ? origin.y * ch : ch / 2;
        const maxDist = Math.sqrt(
          Math.max(cx0, cw - cx0) ** 2 + Math.max(cy0, ch - cy0) ** 2
        );
        const eased = 1 - Math.pow(1 - progress, 2.5);
        const wavePos = eased * (maxDist + 120);

        for (let i = 0; i < total; i++) {
          const cellX = cellsX[i];
          const cellY = cellsY[i];
          const dx = cellX - cx0;
          const dy = cellY - cy0;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const diff = wavePos - dist;

          if (diff > 0 && diff < WAVE_WAVELENGTH) {
            const t = 1 - diff / WAVE_WAVELENGTH;
            const ts = t * t * (3 - 2 * t);
            const sz = iconPx * (0.7 + ts * 0.6);
            const sprite = sprites[iconIdx[i]];
            if (sprite) {
              ctx.globalAlpha = ts * 0.5 * (1 - progress * 0.3);
              ctx.drawImage(
                sprite,
                cellX * dpr - sz / 2,
                cellY * dpr - sz / 2,
                sz,
                sz,
              );
            }
          }
        }
      }
      ctx.globalAlpha = 1;

      raf = requestAnimationFrame(drawWave);
    };

    const onResize = () => computeCells();

    const ro = new ResizeObserver(onResize);
    ro.observe(canvas);

    (async () => {
      try {
        sprites = await generateSprites(mode);
        if (disposed) return;
        computeCells();
        if (cw === 0 || ch === 0) return;
        waveStart = performance.now();
        raf = requestAnimationFrame(drawWave);
      } catch {
        // sprites failed — canvas stays empty
      }
    })();

    return () => {
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [mode]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ display: "block", pointerEvents: "none", width: "100%", height: "100%" }}
    />
  );
}
