export const money = (x: number, signed = false): string => {
  const abs = Math.abs(x).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (signed) return `${x < 0 ? "-" : "+"}$${abs}`;
  return `${x < 0 ? "-" : ""}$${abs}`;
};

export const bigMoney = (x: number): string =>
  `${x < 0 ? "-" : ""}$${Math.abs(x).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const pct = (x: number, signed = true): string =>
  `${signed ? (x > 0 ? "+" : x < 0 ? "-" : "") : ""}${Math.abs(x).toFixed(2)}%`;

export const px = (x: number, dec: number): string =>
  x.toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec });

export const rFmt = (r: number): string => `${r >= 0 ? "+" : ""}${r.toFixed(2)}R`;

export const qty = (q: number): string =>
  q >= 1000
    ? `${(q / 1000).toFixed(1)}k`
    : q.toLocaleString("en-US", { maximumFractionDigits: 2 });

export const tone = (v: number): string =>
  v > 0.0000001 ? "text-phos" : v < -0.0000001 ? "text-crim" : "text-fog";
