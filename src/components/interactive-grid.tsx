import { useEffect, useRef, useState, useCallback } from "react";
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
  FileText,
  GitBranch,
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
];

const SPACING = 36;
const RADIUS = 140;

export function InteractiveGrid({
  className,
  mode = "chat",
}: {
  className?: string;
  mode?: "chat" | "agent";
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ cols: 0, rows: 0 });

  const icons = mode === "agent" ? AGENT_ICONS : CHAT_ICONS;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const measure = () => {
      const rect = container.getBoundingClientRect();
      setDims({
        cols: Math.ceil(rect.width / SPACING),
        rows: Math.ceil(rect.height / SPACING),
      });
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  const cells = [];
  for (let row = 0; row < dims.rows; row++) {
    for (let col = 0; col < dims.cols; col++) {
      const Icon = icons[(row * dims.cols + col) % icons.length];
      cells.push(
        <div
          key={`${row}-${col}`}
          data-grid-cell
          className="flex items-center justify-center text-white/60"
          style={{ opacity: 0, transition: "opacity 0.2s ease, transform 0.2s ease" }}
        >
          <Icon className="size-3.5" strokeWidth={1.5} />
        </div>,
      );
    }
  }

  const onMove = useCallback(() => {
    const container = containerRef.current;
    const grid = gridRef.current;
    if (!container || !grid) return;

    let raf = 0;
    let mx = -9999;
    let my = -9999;

    const update = () => {
      raf = 0;
      const cellEls = grid.querySelectorAll<HTMLElement>("[data-grid-cell]");
      cellEls.forEach((el) => {
        const cx = el.offsetLeft + el.offsetWidth / 2;
        const cy = el.offsetTop + el.offsetHeight / 2;
        const dx = cx - mx;
        const dy = cy - my;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < RADIUS) {
          const t = 1 - dist / RADIUS;
          el.style.opacity = String(t * 0.55);
          el.style.transform = `scale(${0.7 + t * 0.5})`;
        } else {
          el.style.opacity = "0";
          el.style.transform = "scale(0.7)";
        }
      });
    };

    const handler = (e: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      mx = e.clientX - rect.left;
      my = e.clientY - rect.top;
      if (!raf) raf = requestAnimationFrame(update);
    };

    const leaveHandler = () => {
      mx = -9999;
      my = -9999;
      if (!raf) raf = requestAnimationFrame(update);
    };

    window.addEventListener("mousemove", handler);
    window.addEventListener("blur", leaveHandler);
    return () => {
      window.removeEventListener("mousemove", handler);
      window.removeEventListener("blur", leaveHandler);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  useEffect(() => {
    const cleanup = onMove();
    return cleanup;
  }, [onMove, dims]);

  return (
    <div ref={containerRef} className={className}>
      <div
        ref={gridRef}
        className="absolute inset-0"
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${dims.cols}, 1fr)`,
          gridTemplateRows: `repeat(${dims.rows}, 1fr)`,
        }}
      >
        {cells}
      </div>
    </div>
  );
}
