/**
 * Profiling panel — canvas-based waterfall chart.
 *
 * Activated by the `?profile` query parameter. Shows every instrumented
 * wallet / PXE / simulator / oracle / node / RPC / WASM span as a
 * horizontal bar on a scrollable time axis.
 *
 * Nesting is derived from timing containment (parent spans fully enclose
 * child spans). Click a bar to expand/collapse its subtree.
 *
 * Interaction:
 *   - Click bar or label triangle: expand / collapse subtree
 *   - Horizontal scroll: pan the timeline
 *   - +/- buttons: zoom in / out (preserves scroll center)
 *   - Hover: tooltip with timing details
 *   - Min-duration slider: hide short spans
 */

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
import { Box, Button, Chip, Paper, Slider, Tooltip, Typography } from "@mui/material";
import { profiler, type ProfileReport, type ProfileRecord, type Category } from "../profiling";
import { useWallet } from "../contexts/wallet";

// ─── Constants ───────────────────────────────────────────────────────────────

const ROW_H = 22;
const ROW_GAP = 1;
const ROW_STEP = ROW_H + ROW_GAP;
const LABEL_W = 220;
const INDENT_PX = 14;
const FONT = "11px monospace";
const MIN_BAR_PX = 2;
const MAX_ZOOM = 64;

const CATEGORY_COLORS: Record<Category, string> = {
  wallet: "#5c7cfa",
  pxe: "#ce93d8",
  sim: "#ffd54f",
  oracle: "#ffab40",
  store: "#a5d6a7",
  node: "#66bb6a",
  rpc: "#4fc3f7",
  wasm: "#ff7043",
};

/** Format milliseconds as human-readable duration. */
const fmt = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${ms.toFixed(1)}ms`);

// ─── Tree model ──────────────────────────────────────────────────────────────

interface TreeNode {
  id: string;
  record: ProfileRecord;
  children: TreeNode[];
  depth: number;
}

/**
 * Build a tree from flat records using explicit parent IDs.
 *
 * Each record's `parentId` comes from async-context tracking (zone.js) and
 * reflects the real causal chain — no timing heuristics, no peer rules,
 * no category hierarchies needed. A parallel call to the same method
 * produces a sibling, not a coincidentally-nested child.
 *
 * Records whose `parentId` isn't present in the set (e.g. the parent was
 * filtered out, or the profile started mid-operation) become roots.
 */
function buildTree(records: ProfileRecord[]): TreeNode[] {
  if (records.length === 0) return [];

  const byId = new Map<string, TreeNode>();
  for (const r of records) {
    byId.set(r.id, { id: r.id, record: r, children: [], depth: 0 });
  }

  const roots: TreeNode[] = [];
  for (const node of byId.values()) {
    const parent = node.record.parentId ? byId.get(node.record.parentId) : undefined;
    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  // Depth-first fill in `depth` for rendering.
  function assignDepth(node: TreeNode, d: number) {
    node.depth = d;
    for (const child of node.children) assignDepth(child, d + 1);
  }
  for (const root of roots) assignDepth(root, 0);

  return roots;
}

// ─── Layout ──────────────────────────────────────────────────────────────────

interface LayoutItem {
  record: ProfileRecord;
  nodeId: string;
  depth: number;
  row: number;
  hasChildren: boolean;
}

/**
 * Flatten the tree into row assignments, respecting the expanded set.
 *
 * Children are grouped into temporal clusters (overlapping children form a
 * group). Each group is rendered in chronological order:
 *   - All-leaf groups are lane-packed for compactness.
 *   - Mixed / block groups render each child in time order.
 */
function layoutTree(
  roots: TreeNode[],
  expanded: Set<string>,
): { items: LayoutItem[]; expandableIds: Set<string> } {
  const items: LayoutItem[] = [];
  const expandableIds = new Set<string>();
  let nextRow = 0;

  function isLeafLike(node: TreeNode): boolean {
    return node.children.length === 0;
  }

  function visitNode(node: TreeNode) {
    if (node.children.length > 0) expandableIds.add(node.id);

    items.push({
      record: node.record,
      nodeId: node.id,
      depth: node.depth,
      row: nextRow,
      hasChildren: node.children.length > 0,
    });
    nextRow++;

    if (!expanded.has(node.id) || node.children.length === 0) return;

    const children = [...node.children].sort((a, b) => a.record.start - b.record.start);

    // Group children into temporal clusters so parallel calls stay adjacent.
    type Group = { nodes: TreeNode[]; end: number };
    const groups: Group[] = [];
    for (const child of children) {
      const childEnd = child.record.start + child.record.duration;
      const last = groups[groups.length - 1];
      if (last && child.record.start < last.end) {
        last.nodes.push(child);
        last.end = Math.max(last.end, childEnd);
      } else {
        groups.push({ nodes: [child], end: childEnd });
      }
    }

    for (const group of groups) {
      const allLeafLike = group.nodes.every((c) => isLeafLike(c));

      if (allLeafLike) {
        // Lane-pack leaves for compactness.
        const laneEnds: number[] = [];
        const baseRow = nextRow;
        for (const child of group.nodes) {
          const end = child.record.start + child.record.duration;
          let lane = laneEnds.findIndex((e) => child.record.start >= e);
          if (lane === -1) {
            lane = laneEnds.length;
            laneEnds.push(0);
          }
          laneEnds[lane] = end;
          items.push({
            record: child.record,
            nodeId: child.id,
            depth: child.depth,
            row: baseRow + lane,
            hasChildren: false,
          });
        }
        nextRow += Math.max(1, laneEnds.length);
      } else {
        // Mixed group — each child in time order.
        for (const child of group.nodes) {
          if (isLeafLike(child)) {
            items.push({
              record: child.record,
              nodeId: child.id,
              depth: child.depth,
              row: nextRow,
              hasChildren: false,
            });
            nextRow++;
          } else {
            visitNode(child);
          }
        }
      }
    }
  }

  const sorted = [...roots].sort((a, b) => a.record.start - b.record.start);
  for (const root of sorted) visitNode(root);
  return { items, expandableIds };
}

// ─── Waterfall chart ─────────────────────────────────────────────────────────

interface HoverInfo {
  item: LayoutItem;
  x: number;
  y: number;
}

/**
 * Waterfall chart with virtual rendering.
 *
 * The chart canvases are always viewport-sized — never exceeding browser
 * canvas limits (~16k px per side). Panning and zooming translate the
 * drawing offsets rather than resizing the canvas. This means there is
 * effectively no limit on zoom level or number of visible rows.
 */
const CHART_HEIGHT = 600; // fixed chart viewport height

function WaterfallChart({ report, minDuration }: { report: ProfileReport; minDuration: number }) {
  const labelCanvasRef = useRef<HTMLCanvasElement>(null);
  const chartCanvasRef = useRef<HTMLCanvasElement>(null);
  const outerRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const [viewportW, setViewportW] = useState(800);
  const [zoom, setZoom] = useState(1);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [scrollLeft, setScrollLeft] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const dragRef = useRef<{
    clientX0: number;
    clientY0: number;
    scrollLeft0: number;
    scrollTop0: number;
    dragStartX: number; // canvas-space x where drag started
    shiftKey: boolean;
    moved: boolean;
  } | null>(null);
  const [dragX, setDragX] = useState<{ x0: number; x1: number } | null>(null);

  // ── Data pipeline ──────────────────────────────────────────────────────────

  const filtered = useMemo(
    () => report.records.filter((r) => r.duration >= minDuration),
    [report, minDuration],
  );

  const tree = useMemo(() => buildTree(filtered), [filtered]);

  const childrenMap = useMemo(() => {
    const cMap = new Map<string, string[]>();
    function walk(node: TreeNode) {
      cMap.set(
        node.id,
        node.children.map((c) => c.id),
      );
      for (const child of node.children) walk(child);
    }
    for (const root of tree) walk(root);
    return cMap;
  }, [tree]);

  const toggleExpand = useCallback(
    (nodeId: string) => {
      setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(nodeId)) {
          // Collapse this node and all its descendants.
          next.delete(nodeId);
          const removeDesc = (id: string) => {
            for (const child of childrenMap.get(id) ?? []) {
              next.delete(child);
              removeDesc(child);
            }
          };
          removeDesc(nodeId);
        } else {
          next.add(nodeId);
        }
        return next;
      });
    },
    [childrenMap],
  );

  const { items: layout, expandableIds } = useMemo(
    () => layoutTree(tree, expanded),
    [tree, expanded],
  );
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  // ── Dimensions ─────────────────────────────────────────────────────────────
  //
  // virtualContentH: total logical height of all rows (not the canvas height)
  // virtualContentW: total logical width at current zoom (not the canvas width)
  // chartViewportW:  visible chart area width (canvas width)
  // CHART_HEIGHT:    visible chart area height (canvas height)

  const numRows = layout.length > 0 ? Math.max(...layout.map((l) => l.row)) + 1 : 1;
  const virtualContentH = numRows * ROW_STEP + 4;
  const totalMs = report.durationMs;
  const chartViewportW = Math.max(1, viewportW - LABEL_W);
  const virtualContentW = chartViewportW * zoom;
  const maxScrollLeft = Math.max(0, virtualContentW - chartViewportW);
  const maxScrollTop = Math.max(0, virtualContentH - CHART_HEIGHT);

  // ── Resize observer ────────────────────────────────────────────────────────

  useEffect(() => {
    const el = outerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => setViewportW(entries[0].contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Clamp scroll offsets when content/viewport changes.
  useEffect(() => {
    setScrollLeft((s) => Math.min(s, maxScrollLeft));
    setScrollTop((s) => Math.min(s, maxScrollTop));
  }, [maxScrollLeft, maxScrollTop]);

  // ── Zoom with scroll-center preservation ───────────────────────────────────

  const doZoom = useCallback(
    (nextZoom: number) => {
      // Preserve the center of the current viewport.
      const centerRatio =
        virtualContentW > 0 ? (scrollLeft + chartViewportW / 2) / virtualContentW : 0.5;
      const newVirtualW = chartViewportW * nextZoom;
      const newScrollLeft = centerRatio * newVirtualW - chartViewportW / 2;
      const clamped = Math.max(0, Math.min(newVirtualW - chartViewportW, newScrollLeft));
      setZoom(nextZoom);
      setScrollLeft(clamped);
    },
    [scrollLeft, virtualContentW, chartViewportW],
  );

  // ── Draw label canvas (virtualized: vertical scroll offset applied) ───────

  useEffect(() => {
    const canvas = labelCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = LABEL_W * dpr;
    canvas.height = CHART_HEIGHT * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, LABEL_W, CHART_HEIGHT);
    ctx.font = FONT;

    // Only draw rows visible in the current viewport.
    const firstRow = Math.floor(scrollTop / ROW_STEP);
    const lastRow = Math.min(numRows, Math.ceil((scrollTop + CHART_HEIGHT) / ROW_STEP));

    // Row backgrounds
    for (let r = firstRow; r < lastRow; r++) {
      const y = r * ROW_STEP - scrollTop;
      ctx.fillStyle = r % 2 === 0 ? "rgba(255,255,255,0.02)" : "rgba(0,0,0,0)";
      ctx.fillRect(0, y, LABEL_W, ROW_STEP);
    }

    // Separator
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(LABEL_W - 0.5, 0);
    ctx.lineTo(LABEL_W - 0.5, CHART_HEIGHT);
    ctx.stroke();

    // Labels (only visible rows)
    const drawnRows = new Set<number>();
    for (const item of layout) {
      if (item.row < firstRow || item.row >= lastRow) continue;
      if (drawnRows.has(item.row)) continue;
      drawnRows.add(item.row);

      const y = item.row * ROW_STEP + 1 - scrollTop;
      const indent = item.depth * INDENT_PX;
      const labelX = 4 + indent;
      const cy = y + ROW_H / 2;

      // Expand/collapse triangle — bright so it's clearly clickable.
      if (item.hasChildren) {
        const isExp = expanded.has(item.nodeId);
        ctx.fillStyle = isExp ? "rgba(212,255,40,0.85)" : "rgba(255,255,255,0.75)";
        ctx.beginPath();
        if (isExp) {
          // ▼ expanded
          ctx.moveTo(labelX, cy - 3);
          ctx.lineTo(labelX + 8, cy - 3);
          ctx.lineTo(labelX + 4, cy + 4);
        } else {
          // ▶ collapsed
          ctx.moveTo(labelX, cy - 4);
          ctx.lineTo(labelX, cy + 4);
          ctx.lineTo(labelX + 7, cy);
        }
        ctx.closePath();
        ctx.fill();
      }

      // Category-colored swatch before the label name.
      const swatchX = labelX + (item.hasChildren ? 11 : 0);
      const swatchColor = item.record.error ? "#e53935" : CATEGORY_COLORS[item.record.category];
      ctx.fillStyle = swatchColor;
      ctx.fillRect(swatchX, y + ROW_H / 2 - 3, 6, 6);

      const textX = swatchX + 10;
      ctx.fillStyle = "rgba(255,255,255,0.65)";
      ctx.save();
      ctx.beginPath();
      ctx.rect(textX, y + 2, LABEL_W - textX - 6, ROW_H - 2);
      ctx.clip();
      ctx.fillText(item.record.name, textX, y + ROW_H - 6);
      ctx.restore();
    }
  }, [layout, numRows, expanded, scrollTop]);

  // ── Draw chart canvas (virtualized: viewport-sized, drawing translated) ──

  useEffect(() => {
    const canvas = chartCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = chartViewportW * dpr;
    canvas.height = CHART_HEIGHT * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, chartViewportW, CHART_HEIGHT);
    ctx.font = FONT;

    // Map ms to virtual x, then subtract scrollLeft to get canvas x.
    const msToX = (ms: number) => (ms / totalMs) * virtualContentW - scrollLeft;

    // Only draw rows visible in the current vertical viewport.
    const firstRow = Math.floor(scrollTop / ROW_STEP);
    const lastRow = Math.min(numRows, Math.ceil((scrollTop + CHART_HEIGHT) / ROW_STEP));

    // Row backgrounds
    for (let r = firstRow; r < lastRow; r++) {
      const y = r * ROW_STEP - scrollTop;
      ctx.fillStyle = r % 2 === 0 ? "rgba(255,255,255,0.02)" : "rgba(0,0,0,0)";
      ctx.fillRect(0, y, chartViewportW, ROW_STEP);
    }

    // Grid lines + time labels.
    // Only draw grid within the visible time window.
    const visibleMsStart = (scrollLeft / virtualContentW) * totalMs;
    const visibleMsEnd = ((scrollLeft + chartViewportW) / virtualContentW) * totalMs;
    const visibleMs = visibleMsEnd - visibleMsStart;
    const rawStep = visibleMs / 6;
    const mag = Math.pow(10, Math.floor(Math.log10(rawStep || 1)));
    const step = [1, 2, 5, 10].map((n) => n * mag).find((s) => visibleMs / s <= 8) ?? mag;
    const firstTick = Math.ceil(visibleMsStart / step) * step;
    ctx.strokeStyle = "rgba(255,255,255,0.05)";
    ctx.lineWidth = 1;
    for (let t = firstTick; t <= visibleMsEnd; t += step) {
      const x = Math.round(msToX(t)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, CHART_HEIGHT);
      ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,0.25)";
      ctx.fillText(fmt(t), x + 3, 10);
    }

    // Bars — skip those outside the visible time and row ranges.
    for (const item of layout) {
      if (item.row < firstRow || item.row >= lastRow) continue;
      const r = item.record;
      const x = msToX(r.start);
      const w = Math.max(MIN_BAR_PX, msToX(r.start + r.duration) - x);
      if (x + w < 0 || x > chartViewportW) continue;
      const y = item.row * ROW_STEP + 1 - scrollTop;
      const color = CATEGORY_COLORS[r.category];

      ctx.fillStyle = r.error ? "#e53935" : color;
      ctx.globalAlpha = r.category === "wasm" ? 0.7 : 0.85;
      ctx.fillRect(x, y, w, ROW_H - 1);
      ctx.globalAlpha = 1;

      // Expand indicator on the bar: small ▶/▼ at the left edge for expandable spans.
      if (item.hasChildren && w > 12) {
        const isExp = expanded.has(item.nodeId);
        const ix = Math.max(0, x) + 3;
        const iy = y + ROW_H / 2;
        ctx.fillStyle = "rgba(0,0,0,0.6)";
        ctx.beginPath();
        if (isExp) {
          ctx.moveTo(ix, iy - 2);
          ctx.lineTo(ix + 5, iy - 2);
          ctx.lineTo(ix + 2.5, iy + 3);
        } else {
          ctx.moveTo(ix, iy - 3);
          ctx.lineTo(ix, iy + 3);
          ctx.lineTo(ix + 4, iy);
        }
        ctx.closePath();
        ctx.fill();
      }

      if (w > 50) {
        const textOffset = item.hasChildren ? 10 : 3;
        ctx.fillStyle = "rgba(0,0,0,0.85)";
        ctx.save();
        ctx.beginPath();
        ctx.rect(
          Math.max(0, x) + textOffset,
          y,
          Math.min(chartViewportW, x + w) - Math.max(0, x) - textOffset - 2,
          ROW_H,
        );
        ctx.clip();
        ctx.fillText(`${r.name} ${fmt(r.duration)}`, Math.max(0, x) + textOffset, y + ROW_H - 6);
        ctx.restore();
      }
    }
  }, [layout, numRows, chartViewportW, virtualContentW, totalMs, zoom, scrollLeft, scrollTop]);

  // ── Hit test helpers ───────────────────────────────────────────────────────
  //
  // Coordinate systems:
  //   client: browser viewport coordinates (from mouse events)
  //   canvas: chart canvas coordinates (0 to chartViewportW × CHART_HEIGHT)
  //   virtual: full logical chart coordinates (0 to virtualContentW × virtualContentH)
  //
  // canvas_x = virtual_x - scrollLeft
  // canvas_y = virtual_y - scrollTop

  /** Convert a mouse event to a virtual (logical) x coordinate in the chart. */
  const toVirtualX = useCallback(
    (e: React.MouseEvent): number => {
      const canvas = chartCanvasRef.current;
      if (!canvas) return 0;
      const rect = canvas.getBoundingClientRect();
      const canvasX = (e.clientX - rect.left) * (chartViewportW / rect.width);
      return canvasX + scrollLeft;
    },
    [chartViewportW, scrollLeft],
  );

  const chartHitTest = useCallback(
    (e: React.MouseEvent): LayoutItem | null => {
      const canvas = chartCanvasRef.current;
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      const canvasX = (e.clientX - rect.left) * (chartViewportW / rect.width);
      const canvasY = e.clientY - rect.top;
      const virtualX = canvasX + scrollLeft;
      const virtualY = canvasY + scrollTop;
      const ms = (virtualX / virtualContentW) * totalMs;
      const row = Math.floor(virtualY / ROW_STEP);
      let best: LayoutItem | null = null;
      for (const item of layoutRef.current) {
        if (item.row !== row) continue;
        const r = item.record;
        if (ms >= r.start && ms <= r.start + r.duration) {
          if (!best || r.duration < best.record.duration) best = item;
        }
      }
      return best;
    },
    [chartViewportW, virtualContentW, totalMs, scrollLeft, scrollTop],
  );

  const labelHitTest = useCallback(
    (e: React.MouseEvent): LayoutItem | null => {
      const canvas = labelCanvasRef.current;
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      const canvasY = e.clientY - rect.top;
      const virtualY = canvasY + scrollTop;
      const row = Math.floor(virtualY / ROW_STEP);
      for (const item of layoutRef.current) {
        if (item.row === row && item.hasChildren) return item;
      }
      return null;
    },
    [scrollTop],
  );

  // ── Event handlers ─────────────────────────────────────────────────────────

  const onLabelClick = useCallback(
    (e: React.MouseEvent) => {
      const item = labelHitTest(e);
      if (item) toggleExpand(item.nodeId);
    },
    [labelHitTest, toggleExpand],
  );

  const onLabelMouseMove = useCallback(
    (e: React.MouseEvent) => {
      const canvas = labelCanvasRef.current;
      if (!canvas) return;
      const item = labelHitTest(e);
      canvas.style.cursor = item ? "pointer" : "default";
    },
    [labelHitTest],
  );

  const onChartMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      dragRef.current = {
        clientX0: e.clientX,
        clientY0: e.clientY,
        scrollLeft0: scrollLeft,
        scrollTop0: scrollTop,
        dragStartX: toVirtualX(e),
        shiftKey: e.shiftKey,
        moved: false,
      };
      setDragX(null);
      setHover(null);
    },
    [scrollLeft, scrollTop, toVirtualX],
  );

  const onChartMouseMove = useCallback(
    (e: React.MouseEvent) => {
      const canvas = chartCanvasRef.current;
      if (!canvas) return;

      if (dragRef.current) {
        const dx = e.clientX - dragRef.current.clientX0;
        const dy = e.clientY - dragRef.current.clientY0;
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) dragRef.current.moved = true;

        if (dragRef.current.shiftKey) {
          // Shift+drag: zoom selection. Paint overlay in canvas coords.
          if (dragRef.current.moved) {
            const rect = canvas.getBoundingClientRect();
            const x0Canvas = dragRef.current.dragStartX - scrollLeft;
            const x1Canvas = (e.clientX - rect.left) * (chartViewportW / rect.width);
            setDragX({ x0: x0Canvas, x1: x1Canvas });
          }
          canvas.style.cursor = "col-resize";
        } else {
          // Plain drag: pan both axes via virtual scroll state.
          const newScrollLeft = Math.max(
            0,
            Math.min(maxScrollLeft, dragRef.current.scrollLeft0 - dx),
          );
          const newScrollTop = Math.max(0, Math.min(maxScrollTop, dragRef.current.scrollTop0 - dy));
          setScrollLeft(newScrollLeft);
          setScrollTop(newScrollTop);
          canvas.style.cursor = "grabbing";
        }
        return;
      }

      const item = chartHitTest(e);
      canvas.style.cursor = item ? "pointer" : "grab";
      if (item) {
        setHover({ item, x: e.clientX, y: e.clientY });
      } else {
        setHover(null);
      }
    },
    [chartHitTest, chartViewportW, scrollLeft, maxScrollLeft, maxScrollTop],
  );

  const onChartMouseUp = useCallback(
    (e: React.MouseEvent) => {
      if (!dragRef.current) return;
      const { dragStartX, moved, shiftKey } = dragRef.current;
      const endVirtualX = toVirtualX(e);
      dragRef.current = null;
      setDragX(null);

      if (!moved) {
        // Single click → expand/collapse
        const item = chartHitTest(e);
        if (item?.hasChildren) toggleExpand(item.nodeId);
        return;
      }

      if (!shiftKey) return; // plain drag (pan) — nothing to finalize

      // Shift+drag-to-zoom: compute ms range from virtual coordinates.
      const lo = Math.min(dragStartX, endVirtualX);
      const hi = Math.max(dragStartX, endVirtualX);
      const msStart = (lo / virtualContentW) * totalMs;
      const msEnd = (hi / virtualContentW) * totalMs;
      const msRange = msEnd - msStart;
      if (msRange <= 0) return;

      const newZoom = Math.max(1, totalMs / msRange);
      const newVirtualW = chartViewportW * newZoom;
      const newScrollLeft = Math.max(0, (msStart / totalMs) * newVirtualW);
      setZoom(newZoom);
      setScrollLeft(newScrollLeft);
    },
    [toVirtualX, chartHitTest, toggleExpand, chartViewportW, virtualContentW, totalMs],
  );

  const onChartMouseLeave = useCallback(() => {
    if (dragRef.current) {
      dragRef.current = null;
      setDragX(null);
    }
    setHover(null);
  }, []);

  // Wheel: horizontal → scroll horizontal; vertical → scroll vertical.
  // Ctrl/Cmd+wheel → zoom in/out at cursor position.
  const onChartWheel = useCallback(
    (e: React.WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const factor = e.deltaY < 0 ? 1.25 : 1 / 1.25;
        const rect = chartCanvasRef.current!.getBoundingClientRect();
        const cursorCanvasX = (e.clientX - rect.left) * (chartViewportW / rect.width);
        const cursorVirtualX = cursorCanvasX + scrollLeft;
        const cursorRatio = virtualContentW > 0 ? cursorVirtualX / virtualContentW : 0;

        const newZoom = Math.max(1, zoom * factor);
        const newVirtualW = chartViewportW * newZoom;
        // Keep the point under the cursor stationary.
        const newScrollLeft = cursorRatio * newVirtualW - cursorCanvasX;
        setZoom(newZoom);
        setScrollLeft(Math.max(0, Math.min(newVirtualW - chartViewportW, newScrollLeft)));
        return;
      }
      // Pan
      setScrollLeft((s) => Math.max(0, Math.min(maxScrollLeft, s + e.deltaX)));
      setScrollTop((s) => Math.max(0, Math.min(maxScrollTop, s + e.deltaY)));
    },
    [zoom, chartViewportW, virtualContentW, scrollLeft, maxScrollLeft, maxScrollTop],
  );

  // ── Render ─────────────────────────────────────────────────────────────────

  const btnSx = { fontSize: 9, py: 0, px: 0.5, minWidth: 0, color: "rgba(255,255,255,0.5)" };

  return (
    <Box ref={outerRef} sx={{ fontFamily: "monospace", userSelect: "none" }}>
      {/* Toolbar */}
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.5 }}>
        <Typography sx={{ fontSize: 9, color: "rgba(255,255,255,0.4)", flexGrow: 1 }}>
          {fmt(totalMs)} total &middot; {filtered.length} spans
          {zoom > 1 ? ` \u00b7 ${zoom}x zoom` : ""}
          &nbsp;&middot; drag to pan &middot; wheel to scroll &middot; ctrl+wheel or shift+drag to
          zoom
        </Typography>
        <Button
          size="small"
          variant="text"
          sx={btnSx}
          disabled={zoom <= 1}
          onClick={() => doZoom(Math.max(1, zoom / 2))}
        >
          -
        </Button>
        <Button
          size="small"
          variant="text"
          sx={btnSx}
          disabled={zoom >= MAX_ZOOM}
          onClick={() => doZoom(Math.min(MAX_ZOOM, zoom * 2))}
        >
          +
        </Button>
        {zoom > 1 && (
          <Button size="small" variant="text" sx={btnSx} onClick={() => doZoom(1)}>
            fit
          </Button>
        )}
        {expanded.size > 0 && (
          <Button size="small" variant="text" sx={btnSx} onClick={() => setExpanded(new Set())}>
            collapse all
          </Button>
        )}
        {expanded.size < expandableIds.size && expandableIds.size > 0 && (
          <Button
            size="small"
            variant="text"
            sx={btnSx}
            onClick={() => setExpanded(new Set(expandableIds))}
          >
            expand all
          </Button>
        )}
      </Box>

      {/* Chart: fixed viewport with virtual rendering — no native scrollbars. */}
      <Box sx={{ display: "flex", position: "relative", height: CHART_HEIGHT }}>
        {/* Label column */}
        <Box sx={{ width: LABEL_W, flexShrink: 0, height: CHART_HEIGHT, overflow: "hidden" }}>
          <canvas
            ref={labelCanvasRef}
            style={{ display: "block", width: LABEL_W, height: CHART_HEIGHT }}
            onClick={onLabelClick}
            onMouseMove={onLabelMouseMove}
          />
        </Box>
        {/* Chart viewport */}
        <Box sx={{ flex: 1, position: "relative", height: CHART_HEIGHT, overflow: "hidden" }}>
          <canvas
            ref={chartCanvasRef}
            style={{ display: "block", width: "100%", height: CHART_HEIGHT, cursor: "grab" }}
            onMouseDown={onChartMouseDown}
            onMouseMove={onChartMouseMove}
            onMouseUp={onChartMouseUp}
            onMouseLeave={onChartMouseLeave}
            onWheel={onChartWheel}
          />
          {dragX &&
            (() => {
              const left = Math.min(dragX.x0, dragX.x1);
              const width = Math.abs(dragX.x1 - dragX.x0);
              return (
                <Box
                  sx={{
                    position: "absolute",
                    top: 0,
                    bottom: 0,
                    left,
                    width,
                    backgroundColor: "rgba(212,255,40,0.12)",
                    border: "1px solid rgba(212,255,40,0.5)",
                    pointerEvents: "none",
                  }}
                />
              );
            })()}
        </Box>
      </Box>

      {/* Legend */}
      <Box sx={{ display: "flex", gap: 1.5, mt: 1.5, flexWrap: "wrap", alignItems: "center" }}>
        {(Object.entries(CATEGORY_COLORS) as [Category, string][]).map(([cat, color]) => (
          <Box key={cat} sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
            <Box sx={{ width: 10, height: 10, backgroundColor: color, borderRadius: "2px" }} />
            <Typography
              sx={{ fontSize: 9, color: "rgba(255,255,255,0.4)", fontFamily: "monospace" }}
            >
              {cat}
            </Typography>
          </Box>
        ))}
      </Box>

      {/* Tooltip */}
      {hover && <SpanTooltip info={hover} totalMs={totalMs} />}
    </Box>
  );
}

// ─── Tooltip ─────────────────────────────────────────────────────────────────

function SpanTooltip({ info, totalMs }: { info: HoverInfo; totalMs: number }) {
  const { record } = info.item;
  const color = record.error ? "#e53935" : CATEGORY_COLORS[record.category];
  return (
    <Paper
      elevation={12}
      sx={{
        position: "fixed",
        left: Math.min(info.x + 14, window.innerWidth - 320),
        top: Math.min(info.y + 14, window.innerHeight - 200),
        zIndex: 99999,
        p: 1.5,
        maxWidth: 300,
        maxHeight: 250,
        overflow: "auto",
        backgroundColor: "rgba(18,18,28,0.98)",
        border: `1px solid ${color}`,
        pointerEvents: "none",
      }}
    >
      <Typography
        sx={{
          fontFamily: "monospace",
          fontSize: 11,
          fontWeight: 700,
          color,
          mb: 0.5,
          wordBreak: "break-all",
        }}
      >
        {record.name}
      </Typography>
      <Typography sx={{ fontSize: 10, color: "rgba(255,255,255,0.65)" }}>
        {record.category} &middot; {fmt(record.start)} &rarr; {fmt(record.start + record.duration)}{" "}
        &middot; {fmt(record.duration)} &middot; {((record.duration / totalMs) * 100).toFixed(1)}%
      </Typography>
      {record.detail && (
        <Typography sx={{ fontSize: 9, color: "rgba(255,255,255,0.45)", mt: 0.5 }}>
          {record.detail}
        </Typography>
      )}
    </Paper>
  );
}

// ─── Summary table ───────────────────────────────────────────────────────────

/** Aggregate records by name within a category. */
function aggregateByName(records: ProfileRecord[], category: Category) {
  const agg = new Map<string, { count: number; totalMs: number; maxMs: number }>();
  for (const r of records) {
    if (r.category !== category) continue;
    const entry = agg.get(r.name) ?? { count: 0, totalMs: 0, maxMs: 0 };
    entry.count++;
    entry.totalMs += r.duration;
    if (r.duration > entry.maxMs) entry.maxMs = r.duration;
    agg.set(r.name, entry);
  }
  return [...agg.entries()].sort((a, b) => b[1].totalMs - a[1].totalMs);
}

function SummaryTable({ report, minDuration }: { report: ProfileReport; minDuration: number }) {
  const filtered = report.records.filter((r) => r.duration >= minDuration);

  const byCat = new Map<Category, { count: number; totalMs: number }>();
  for (const r of filtered) {
    const entry = byCat.get(r.category) ?? { count: 0, totalMs: 0 };
    entry.count++;
    entry.totalMs += r.duration;
    byCat.set(r.category, entry);
  }

  const allSim = aggregateByName(report.records, "sim");
  const topWasm = aggregateByName(report.records, "wasm").slice(0, 15);
  const topRpc = aggregateByName(report.records, "rpc").slice(0, 15);

  const td = {
    fontSize: 10,
    color: "rgba(255,255,255,0.6)",
    fontFamily: "monospace",
    py: 0.25,
    px: 1,
  };
  const tdR = { ...td, textAlign: "right" as const };
  const tdDim = { ...tdR, color: "rgba(255,255,255,0.35)" };

  const AggTable = ({
    rows,
    color,
    max = 15,
  }: {
    rows: [string, { count: number; totalMs: number; maxMs: number }][];
    color?: string;
    max?: number;
  }) => (
    <Box component="table" sx={{ borderCollapse: "collapse" }}>
      <tbody>
        {rows.slice(0, max).map(([name, { count, totalMs, maxMs }]) => (
          <tr key={name}>
            <Box
              component="td"
              sx={{
                ...td,
                color: color ?? td.color,
                maxWidth: 240,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {name}
            </Box>
            <Box component="td" sx={tdR}>
              &times;{count}
            </Box>
            <Box component="td" sx={tdR}>
              {fmt(totalMs)}
            </Box>
            <Box component="td" sx={tdDim}>
              max {fmt(maxMs)}
            </Box>
          </tr>
        ))}
      </tbody>
    </Box>
  );

  const SectionTitle = ({ children }: { children: string }) => (
    <Typography sx={{ fontSize: 10, color: "rgba(255,255,255,0.35)", mb: 0.5, fontWeight: 700 }}>
      {children}
    </Typography>
  );

  return (
    <Box sx={{ display: "flex", gap: 3, flexWrap: "wrap", mt: 2 }}>
      <Box>
        <SectionTitle>BY CATEGORY</SectionTitle>
        <Box component="table" sx={{ borderCollapse: "collapse" }}>
          <tbody>
            {([...byCat.entries()] as [Category, { count: number; totalMs: number }][])
              .sort((a, b) => b[1].totalMs - a[1].totalMs)
              .map(([cat, { count, totalMs }]) => (
                <tr key={cat}>
                  <Box component="td" sx={{ ...td, color: CATEGORY_COLORS[cat], fontWeight: 700 }}>
                    {cat}
                  </Box>
                  <Box component="td" sx={tdR}>
                    {count}
                  </Box>
                  <Box component="td" sx={tdR}>
                    {fmt(totalMs)}
                  </Box>
                </tr>
              ))}
          </tbody>
        </Box>
      </Box>

      {allSim.length > 0 && (
        <Box>
          <SectionTitle>CIRCUIT EXECUTIONS</SectionTitle>
          <AggTable rows={allSim} color={CATEGORY_COLORS.sim} max={30} />
        </Box>
      )}

      {topWasm.length > 0 && (
        <Box>
          <SectionTitle>TOP WASM</SectionTitle>
          <AggTable rows={topWasm} />
        </Box>
      )}

      {topRpc.length > 0 && (
        <Box>
          <SectionTitle>TOP RPC</SectionTitle>
          <AggTable rows={topRpc} />
        </Box>
      )}
    </Box>
  );
}

// ─── Full-screen profile page ────────────────────────────────────────────────

function ProfilePage({ report, onClose }: { report: ProfileReport; onClose: () => void }) {
  const [minDuration, setMinDuration] = useState(0.5);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return createPortal(
    <Box
      sx={{
        position: "fixed",
        inset: 0,
        zIndex: 99998,
        backgroundColor: "rgba(8,8,14,0.98)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Header */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1.5,
          px: 2,
          py: 1,
          flexShrink: 0,
          borderBottom: "1px solid rgba(212,255,40,0.15)",
          backgroundColor: "rgba(10,10,18,0.98)",
        }}
      >
        <Typography
          sx={{
            color: "rgba(212,255,40,0.9)",
            fontWeight: 700,
            fontSize: 12,
            fontFamily: "monospace",
          }}
        >
          PROFILE &mdash; {report.name} &mdash; {fmt(report.durationMs)}
        </Typography>
        <Chip
          label={`${report.records.length} spans`}
          size="small"
          sx={{
            fontSize: 9,
            height: 16,
            backgroundColor: "rgba(255,255,255,0.08)",
            color: "rgba(255,255,255,0.5)",
          }}
        />
        <Box sx={{ flexGrow: 1 }} />

        <Typography
          sx={{ fontSize: 9, color: "rgba(255,255,255,0.4)", fontFamily: "monospace", mr: 0.5 }}
        >
          min {fmt(minDuration)}
        </Typography>
        <Slider
          size="small"
          min={0}
          max={50}
          step={0.5}
          value={minDuration}
          onChange={(_, v) => setMinDuration(v as number)}
          sx={{
            width: 100,
            color: "rgba(212,255,40,0.5)",
            "& .MuiSlider-thumb": { width: 10, height: 10 },
          }}
        />

        <Button
          size="small"
          variant="text"
          onClick={() => profiler.download(report)}
          sx={{ fontSize: 10, py: 0.25, minWidth: 0, color: "rgba(255,255,255,0.5)" }}
        >
          JSON
        </Button>
        <Button
          size="small"
          variant="outlined"
          onClick={onClose}
          sx={{ fontSize: 10, py: 0.25, minWidth: 0, ml: 1 }}
        >
          Close
        </Button>
      </Box>

      {/* Body */}
      <Box sx={{ flex: 1, overflow: "auto", p: 2 }}>
        <WaterfallChart report={report} minDuration={minDuration} />
        <SummaryTable report={report} minDuration={minDuration} />
      </Box>
    </Box>,
    document.body,
  );
}

// ─── Main panel — compact pill ──────────────────────────────────────────────

export function ProfilePanel() {
  const [recording, setRecording] = useState(false);
  const [report, setReport] = useState<ProfileReport | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const instrumentedRef = useRef(false);
  const { wallet } = useWallet();

  useEffect(() => {
    profiler.install();
  }, []);

  useEffect(() => {
    if (!wallet || instrumentedRef.current) return;
    profiler.instrumentWallet(wallet);
    instrumentedRef.current = true;
    console.info("[profiler] Wallet instrumented");
  }, [wallet]);

  const handleToggle = useCallback(() => {
    if (recording) {
      const r = profiler.stop();
      setReport(r);
      setRecording(false);
      setFullscreen(true);
    } else {
      profiler.start("profile");
      setRecording(true);
      setReport(null);
    }
  }, [recording]);

  return (
    <>
      <Paper
        elevation={8}
        sx={{
          position: "fixed",
          bottom: 16,
          left: 16,
          zIndex: 9999,
          display: "flex",
          alignItems: "center",
          gap: 0.75,
          px: 1.25,
          py: 0.75,
          backgroundColor: "rgba(14,14,20,0.97)",
          border: "1px solid rgba(212,255,40,0.25)",
          borderRadius: "20px",
          userSelect: "none",
        }}
      >
        <Box
          sx={{
            width: 7,
            height: 7,
            borderRadius: "50%",
            flexShrink: 0,
            backgroundColor: recording ? "#f44336" : "#4caf50",
            ...(recording && {
              animation: "pp 1s infinite",
              "@keyframes pp": { "0%,100%": { opacity: 1 }, "50%": { opacity: 0.3 } },
            }),
          }}
        />
        <Typography
          sx={{
            fontFamily: "monospace",
            color: "rgba(212,255,40,0.9)",
            fontWeight: 700,
            fontSize: 10,
          }}
        >
          PROF
        </Typography>
        <Button
          size="small"
          variant={recording ? "outlined" : "contained"}
          color={recording ? "error" : "primary"}
          onClick={handleToggle}
          sx={{ fontSize: 9, py: 0.1, px: 1, minWidth: 0, borderRadius: "12px" }}
        >
          {recording ? "Stop" : "Rec"}
        </Button>
        {report && !recording && (
          <>
            <Chip
              label={fmt(report.durationMs)}
              size="small"
              onClick={() => setFullscreen(true)}
              sx={{
                fontSize: 9,
                height: 18,
                cursor: "pointer",
                backgroundColor: "rgba(212,255,40,0.15)",
                color: "rgba(212,255,40,0.9)",
                "&:hover": { backgroundColor: "rgba(212,255,40,0.25)" },
              }}
            />
            <Tooltip title="Open profile">
              <Button
                size="small"
                variant="text"
                onClick={() => setFullscreen(true)}
                sx={{ fontSize: 9, py: 0, px: 0.5, minWidth: 0, color: "rgba(255,255,255,0.5)" }}
              >
                view
              </Button>
            </Tooltip>
            <Tooltip title="Download JSON">
              <Button
                size="small"
                variant="text"
                onClick={() => profiler.download(report)}
                sx={{ fontSize: 9, py: 0, px: 0.5, minWidth: 0, color: "rgba(255,255,255,0.5)" }}
              >
                JSON
              </Button>
            </Tooltip>
          </>
        )}
      </Paper>

      {fullscreen && report && <ProfilePage report={report} onClose={() => setFullscreen(false)} />}
    </>
  );
}
