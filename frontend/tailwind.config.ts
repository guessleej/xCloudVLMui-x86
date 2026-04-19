import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#fff4eb",
          100: "#ffe4cd",
          200: "#ffc795",
          300: "#ffab5d",
          400: "#ff8d32",
          500: "#ff7616",
          600: "#ea620a",
          700: "#c24c08",
          800: "#9a3c0b",
          900: "#7c330f",
        },
        accent: {
          50: "#ecfeff",
          100: "#cffafe",
          200: "#a5f3fc",
          300: "#67e8f9",
          400: "#31cfe7",
          500: "#18b4d1",
          600: "#0f8faa",
          700: "#136f85",
          800: "#17596c",
          900: "#174a59",
        },
        surface: {
          DEFAULT: "#07111c",
          card: "#0d1d2d",
          raised: "#11263a",
          muted: "#17334b",
          border: "#274561",
        },
        success: "#3fd18b",
        warning: "#f3b64e",
        danger: "#ff6b6b",
      },
      fontFamily: {
        sans: ["IBM Plex Sans TC", "Noto Sans TC", "sans-serif"],
        display: ["Oxanium", "IBM Plex Sans TC", "sans-serif"],
        mono: ["JetBrains Mono", "Fira Code", "monospace"],
      },
      boxShadow: {
        panel: "0 24px 80px rgba(2, 8, 20, 0.45)",
        glow: "0 0 0 1px rgba(49, 207, 231, 0.18), 0 0 30px rgba(49, 207, 231, 0.16)",
        alarm: "0 0 0 1px rgba(255, 107, 107, 0.22), 0 0 32px rgba(255, 107, 107, 0.14)",
      },
      backgroundImage: {
        "panel-fade":
          "linear-gradient(180deg, rgba(16, 35, 54, 0.9) 0%, rgba(7, 17, 28, 0.96) 100%)",
        "hero-grid":
          "radial-gradient(circle at top left, rgba(49, 207, 231, 0.2), transparent 35%), radial-gradient(circle at top right, rgba(255, 118, 22, 0.16), transparent 32%), linear-gradient(180deg, rgba(10, 24, 39, 0.96), rgba(5, 12, 21, 0.96))",
      },
      animation: {
        "pulse-slow": "pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        "fade-in": "fadeIn 0.35s ease-out",
        "slide-up": "slideUp 0.45s ease-out",
        "scan-line": "scanLine 6s linear infinite",
      },
      keyframes: {
        fadeIn: {
          from: { opacity: "0", transform: "translateY(6px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        slideUp: {
          from: { transform: "translateY(16px)", opacity: "0" },
          to: { transform: "translateY(0)", opacity: "1" },
        },
        scanLine: {
          "0%": { transform: "translateY(-120%)" },
          "100%": { transform: "translateY(220%)" },
        },
      },
    },
  },
  plugins: [],
};

export default config;
