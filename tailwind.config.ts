import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      // Zusatz-Breakpoints für große Monitore (4K zuhause): mehr Spalten/Platz
      screens: {
        "3xl": "1920px",
        "4xl": "2560px",
      },
      colors: {
        // Stahl & Beton · Betongrau / gebürsteter Stahl / Orange als Schweißnaht
        // Outdoor-Lesbarkeit hat Priorität — robust, wertig, kein Lifestyle.
        bg: {
          DEFAULT: "#CDD1D5",  // Beton (Body-Gradient liegt in index.css drüber)
          deep:    "#1A1C1E",  // gebürsteter Stahl, dunkle Oberfläche
          2:       "#EDEFF1",  // Karten-Fläche hell
          3:       "#DBDEE1",
          4:       "#C7CBCF"
        },
        paper: {
          DEFAULT: "#1A1C1E",  // Primärtext + dunkle Oberfläche
          2:       "#2B2E31",
          3:       "#3A3E42"
        },
        ink: {
          DEFAULT: "#15171A",  // Kanten, starke Linien
          soft:    "#2B2E31",
          mute:    "#6A6E72",  // Tertiär/gedämpft, solide (nie als Opacity)
          2:       "#4A4F54",  // Sekundärtext solide (ersetzt text-paper/XX)
          body:    "#33373B"   // Fließtext auf hellen Karten, solide
        },
        moss: {
          DEFAULT: "#1F7A3D",
          deep:    "#14532D",
          bright:  "#22C55E"
        },
        bronze: "#8C6E45",     // Feiertag, gedämpftes Messing (kollidiert nicht mit Kupfer)
        copper: {
          DEFAULT: "#DC6E2D",  // Schweißnaht-Akzent (unverändert aus Marke)
          bright:  "#E8853F"
        },
        amber: {
          DEFAULT: "#C9852F",  // Bernstein-Akzent (Warnung/Hinweis)
          bright:  "#F5B45A",  // Heller Variant für dunkle Hintergründe
          deep:    "#8A5A1A"
        },
        rust: "#B91C1C",
        good: "#1F7A3D",
        steel: {
          DEFAULT: "#A9AEB3",  // gebürsteter-Stahl-Rand
          line:    "#8B9197"
        }
      },
      fontFamily: {
        sans: [
          '"Atkinson Hyperlegible"',
          "-apple-system", "BlinkMacSystemFont", '"Segoe UI"',
          "Roboto", '"Helvetica Neue"', "Arial", "system-ui", "sans-serif"
        ],
        display: ['"Archivo"', "Impact", "Haettenschweiler", "sans-serif"],
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
