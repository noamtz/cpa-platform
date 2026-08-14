import React, { useRef, useEffect, forwardRef, useImperativeHandle, useState } from "react";

/**
 * LightweightSignaturePad
 *
 * A minimal canvas-based signature pad (~60 lines, no library).
 * Exposes via ref:
 *   - isEmpty()        → boolean
 *   - getDataUrl()     → "data:image/png;base64,..." or null if empty
 *   - clear()          → clears the canvas
 *
 * Props:
 *   width?   (default: parent width)
 *   height?  (default: 180)
 *   className?
 */
const LightweightSignaturePad = forwardRef(function LightweightSignaturePad(
  { height = 180, className = "" },
  ref
) {
  const canvasRef = useRef(null);
  const drawing = useRef(false);
  const hasDrawn = useRef(false);
  const [empty, setEmpty] = useState(true);

  // ─── Expose API via ref ───────────────────────────────────────────────────
  useImperativeHandle(ref, () => ({
    isEmpty: () => !hasDrawn.current,
    getDataUrl: () => {
      if (!hasDrawn.current) return null;
      return canvasRef.current?.toDataURL("image/png") ?? null;
    },
    clear: () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      hasDrawn.current = false;
      setEmpty(true);
    },
  }));

  // ─── Resize canvas to match display size ─────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      const ctx = canvas.getContext("2d");
      ctx.scale(dpr, dpr);
      ctx.strokeStyle = "#1a1a1a";
      ctx.lineWidth = 2.5;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, []);

  // ─── Pointer helpers ──────────────────────────────────────────────────────
  const getPos = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const src = e.touches ? e.touches[0] : e;
    return { x: src.clientX - rect.left, y: src.clientY - rect.top };
  };

  const startDraw = (e) => {
    e.preventDefault();
    drawing.current = true;
    const ctx = canvasRef.current.getContext("2d");
    const { x, y } = getPos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const draw = (e) => {
    if (!drawing.current) return;
    e.preventDefault();
    const ctx = canvasRef.current.getContext("2d");
    const { x, y } = getPos(e);
    ctx.lineTo(x, y);
    ctx.stroke();
    if (!hasDrawn.current) {
      hasDrawn.current = true;
      setEmpty(false);
    }
  };

  const stopDraw = (e) => {
    e?.preventDefault();
    drawing.current = false;
  };

  return (
    <div className={`relative ${className}`} style={{ direction: "ltr" }}>
      <canvas
        ref={canvasRef}
        onMouseDown={startDraw}
        onMouseMove={draw}
        onMouseUp={stopDraw}
        onMouseLeave={stopDraw}
        onTouchStart={startDraw}
        onTouchMove={draw}
        onTouchEnd={stopDraw}
        style={{
          width: "100%",
          height,
          display: "block",
          cursor: "crosshair",
          touchAction: "none",
          border: "1.5px dashed #d1d5db",
          borderRadius: "12px",
          background: "#fafafa",
        }}
      />
      {/* Placeholder text when empty */}
      {empty && (
        <div
          className="absolute inset-0 flex items-center justify-center pointer-events-none"
          style={{ height }}
        >
          <span className="text-sm text-gray-400 select-none">חתמו כאן</span>
        </div>
      )}
    </div>
  );
});

export default LightweightSignaturePad;
