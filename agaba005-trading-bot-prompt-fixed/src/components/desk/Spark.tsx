"use client";

import { useId } from "react";

export default function Spark({
  data,
  width = 96,
  height = 30,
  positive,
}: {
  data: number[];
  width?: number;
  height?: number;
  positive: boolean;
}) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  if (data.length < 2) return <div style={{ width, height }} />;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const stepX = width / (data.length - 1);
  const pts = data.map((v, i) => [i * stepX, height - 3 - ((v - min) / span) * (height - 6)] as const);
  const d = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(2)},${p[1].toFixed(2)}`).join(" ");
  const area = `${d} L${width},${height} L0,${height} Z`;
  const stroke = positive ? "#35f2a7" : "#ff4d6d";
  const last = pts[pts.length - 1];
  return (
    <svg width={width} height={height} className="shrink-0" aria-hidden>
      <defs>
        <linearGradient id={`sg${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.28" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#sg${id})`} />
      <path d={d} fill="none" stroke={stroke} strokeWidth="1.4" strokeOpacity="0.9" />
      <circle cx={last[0]} cy={last[1]} r="2" fill={stroke} />
    </svg>
  );
}
