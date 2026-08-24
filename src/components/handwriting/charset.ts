import type { Charset } from "@/types";

export const CHARSET_OPTIONS: {
  value: Charset;
  label: string;
}[] = [
  { value: "lowercase", label: "Lowercase (a-z)" },
  { value: "letters", label: "Letters (a-z, A-Z)" },
  { value: "alphanumeric", label: "Alphanumeric (a-z, A-Z, 0-9)" },
];

export const CHARSET_CHARS: Record<Charset, string[]> = {
  lowercase: Array.from({ length: 26 }, (_, i) =>
    String.fromCharCode("a".charCodeAt(0) + i),
  ),
  letters: [
    ...Array.from({ length: 26 }, (_, i) =>
      String.fromCharCode("a".charCodeAt(0) + i),
    ),
    ...Array.from({ length: 26 }, (_, i) =>
      String.fromCharCode("A".charCodeAt(0) + i),
    ),
  ],
  alphanumeric: [
    ...Array.from({ length: 26 }, (_, i) =>
      String.fromCharCode("a".charCodeAt(0) + i),
    ),
    ...Array.from({ length: 26 }, (_, i) =>
      String.fromCharCode("A".charCodeAt(0) + i),
    ),
    ...Array.from({ length: 10 }, (_, i) => String(i)),
  ],
};

export const CHARSET_TOTAL: Record<Charset, number> = {
  lowercase: 26,
  letters: 52,
  alphanumeric: 62,
};
