import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // 배경/표면 — 따뜻한 중립
        bg: "#faf9f7",
        surface: "#ffffff",
        surface2: "#f5f3ef",
        border: "#e8e4dc",
        "border-soft": "#efece6",

        // 텍스트 — warm ink scale
        ink: {
          DEFAULT: "#1a1916",
          2: "#43413c",
          3: "#78746c",
          4: "#a8a49a",
        },

        // 액센트 — 잉크 블루 (oklch)
        accent: "oklch(55% 0.11 255)",
        "accent-soft": "oklch(96% 0.02 255)",
        "accent-line": "oklch(90% 0.04 255)",

        // 상태
        ok: "oklch(55% 0.11 150)",
        "ok-soft": "oklch(96% 0.02 150)",
        warn: "oklch(62% 0.12 70)",
        "warn-soft": "oklch(96% 0.03 70)",
        fail: "oklch(55% 0.15 25)",
        "fail-soft": "oklch(96% 0.02 25)",
        standby: "oklch(65% 0.11 60)",
        "standby-soft": "oklch(97% 0.02 60)",
      },
      fontFamily: {
        sans: [
          "Pretendard Variable",
          "Pretendard",
          "Apple SD Gothic Neo",
          "sans-serif",
        ],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      borderRadius: {
        DEFAULT: "6px",
      },
    },
  },
  plugins: [],
};

export default config;
