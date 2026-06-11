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
        // 배경/표면 — kombai 다크 (녹색 끼 도는 near-black)
        bg: "#151615",
        surface: "#1e201e",
        surface2: "#2a2c2a",
        border: "#ffffff1a",        // 흰색 10% — kombai subtle border
        "border-soft": "#ffffff0d", // 흰색 5%

        // 텍스트 — 다크 위 light ink scale (kombai cool grey)
        ink: {
          DEFAULT: "#ededed",
          2: "#b8c4cc",
          3: "#8a96a0",
          4: "#6e8090",
        },

        // 액센트 — kombai 민트 브랜드
        accent: "#48de94",
        "accent-soft": "#48de941a",  // 민트 10% on dark
        "accent-line": "#48de9440",  // 민트 25%

        // 상태 — 다크 위에서 또렷한 톤 (밝은 변형)
        ok: "#34d399",
        "ok-soft": "#34d3991a",
        warn: "#fbbf24",
        "warn-soft": "#fbbf241a",
        fail: "#f87171",
        "fail-soft": "#f871711a",
        standby: "#fbbf24",
        "standby-soft": "#fbbf241a",
      },
      fontFamily: {
        sans: [
          "Geist",
          "Pretendard Variable",
          "Pretendard",
          "Apple SD Gothic Neo",
          "sans-serif",
        ],
        mono: ["Geist Mono", "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      borderRadius: {
        DEFAULT: "8px",
      },
    },
  },
  plugins: [],
};

export default config;
