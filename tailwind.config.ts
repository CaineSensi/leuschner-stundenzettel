import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Hochkontrast-Theme · Schwarz / Weiß / Orange-Akzent
        // Outdoor-Lesbarkeit hat Priorität — keine Wärme, nur Funktion.
        bg: {
          DEFAULT: "#FFFFFF",
          deep:    "#000000",
          2:       "#F4F4F5",
          3:       "#E5E7EB",
          4:       "#D1D5DB"
        },
        paper: {
          DEFAULT: "#000000",
          2:       "#1F2937",
          3:       "#374151"
        },
        ink: {
          DEFAULT: "#000000",
          soft:    "#1F2937",
          mute:    "#6B7280"
        },
        moss: {
          DEFAULT: "#15803D",
          deep:    "#14532D",
          bright:  "#22C55E"
        },
        bronze: "#A0522D",
        copper: {
          DEFAULT: "#DC6E2D",
          bright:  "#F08A4D"
        },
        rust: "#B91C1C",
        good: "#15803D"
      },
      fontFamily: {
        sans: [
          '"Atkinson Hyperlegible"',
          "-apple-system", "BlinkMacSystemFont", '"Segoe UI"',
          "Roboto", '"Helvetica Neue"', "Arial", "system-ui", "sans-serif"
        ],
        display: ['"Big Shoulders Display"', "Impact", "sans-serif"],
        mono: ['"JetBrains Mono"', "ui-monospace", "monospace"]
      },
      letterSpacing: {
        "wide-x": "0.18em",
        "wide-xx": "0.22em"
      }
    }
  },
  plugins: []
} satisfies Config;
