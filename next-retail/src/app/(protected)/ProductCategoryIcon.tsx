import type { ReactNode } from "react";

const artwork: Record<string, ReactNode> = {
  all: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1.4" />
      <rect x="14" y="3" width="7" height="7" rx="1.4" />
      <rect x="3" y="14" width="7" height="7" rx="1.4" />
      <rect x="14" y="14" width="7" height="7" rx="1.4" />
    </>
  ),
  bottle: (
    <>
      <rect x="9" y="3" width="6" height="4" rx="1" />
      <path d="M9 7v2L5 11v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-8l-4-2V7" />
      <path d="m12 12 2.5 3-2.5 3-2.5-3Z" />
    </>
  ),
  volumes: (
    <>
      <path d="M6 7V4h6v3m-6 0L3 10v9a2 2 0 0 0 2 2h8m-1-14 3 3v3M6 12h3m-3 4h3" />
      <path d="M17.5 12c-2 3-4 4.6-4 6.4a4 4 0 0 0 8 0c0-1.8-2-3.4-4-6.4Z" />
    </>
  ),
  decant: (
    <>
      <path d="M4 3h6v4H4zm10 4h6v4h-6zM4 7v13a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1V7m4 4v9a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1v-9M4 12h6m-6 5h6m4-3h6m-6 4h6" />
    </>
  ),
  atom: (
    <>
      <rect x="8" y="3" width="8" height="18" rx="2" />
      <path d="M8 8h8m-5-2h2" />
    </>
  ),
  miniatures: (
    <>
      <path d="M5 8h4v3l2 2v6H3v-6l2-2zm10-3h4v3l2 2v9h-8v-9l2-2zM6 15h2m8-2h2" />
    </>
  ),
  cosmetics: (
    <>
      <path d="M8 12V6l7-4v10m-8 0h10v4H7zm1 4h8v5H8z" />
    </>
  ),
  "shower-gels": (
    <>
      <path d="M10 7V4h7m-3 0v3M9 8h6l3 4v7a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2v-7z" />
      <path d="M9 13h6v4H9z" />
    </>
  ),
  soap: (
    <>
      <rect x="3" y="10" width="18" height="10" rx="4" />
      <path d="M8 15h8" />
      <circle cx="7" cy="5" r="1" />
      <circle cx="14" cy="4" r="1.5" />
    </>
  ),
  diffusers: (
    <>
      <path d="M9 11h6v3l3 2v3a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2v-3l3-2zm1 0L6 3m6 8V2m2 9 4-8M9 17h6" />
    </>
  ),
  "car-perfume": (
    <>
      <path d="M9 8c-1-3 .8-6 3-6s4 3 3 6m-6 0h6v4H9zm0 4-3 2v5a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-5l-3-2m-5 5h4" />
    </>
  ),
  candles: (
    <>
      <path d="M5 11h14l-1 8a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2zm2 4h10m-5-4v-1" />
      <path d="M12 2c-1 2-3 3.6-3 5a3 3 0 0 0 6 0c0-1.4-2-3-3-5Z" />
    </>
  ),
  import: (
    <>
      <path d="M13 3H5v18h14V9zM13 3v6h6m-7 2v6m-3-3 3 3 3-3" />
    </>
  ),
};

export default function ProductCategoryIcon({ category }: { category: string }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.55"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {artwork[category]}
    </svg>
  );
}
