import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: ["./client/index.html", "./client/src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      borderRadius: {
        lg: ".5625rem", /* 9px */
        md: ".375rem", /* 6px */
        sm: ".1875rem", /* 3px */
        // TitanOS radii
        "titan-sm": "0.25rem",
        "titan-md": "0.5rem",
        "titan-lg": "0.75rem",
        "titan-xl": "1rem",
        "titan-2xl": "1.25rem",
      },
      fontSize: {
        // TitanOS typography scale
        "titan-xs": ["0.6875rem", { lineHeight: "1rem" }],
        "titan-sm": ["0.75rem", { lineHeight: "1.125rem" }],
        "titan-base": ["0.8125rem", { lineHeight: "1.25rem" }],
        "titan-md": ["0.875rem", { lineHeight: "1.375rem" }],
        "titan-lg": ["1rem", { lineHeight: "1.5rem" }],
        "titan-xl": ["1.125rem", { lineHeight: "1.625rem" }],
        "titan-2xl": ["1.5rem", { lineHeight: "2rem" }],
      },
      boxShadow: {
        // TitanOS shadows
        "titan-card": "0 4px 12px -2px hsl(220 40% 2% / 0.25), 0 2px 4px -1px hsl(220 40% 2% / 0.15)",
        "titan-sm": "0 1px 2px 0 hsl(220 40% 2% / 0.2)",
        "titan-md": "0 4px 8px -2px hsl(220 40% 2% / 0.3)",
        "titan-lg": "0 8px 16px -4px hsl(220 40% 2% / 0.35)",
        "titan-glow-blue": "0 0 20px hsl(221 83% 60% / 0.25)",
      },
      colors: {
        // TitanOS design system tokens
        titan: {
          bg: {
            app: "hsl(var(--background))",
            sidebar: "hsl(var(--sidebar))",
            card: "hsl(var(--card))",
            "card-elevated": "hsl(var(--muted))",
            "card-highlight": "hsl(var(--accent))",
            input: "hsl(var(--input))",
            "table-row": "hsl(var(--muted) / 0.3)",
          },
          border: {
            DEFAULT: "hsl(var(--border))",
            subtle: "hsl(var(--border) / 0.6)",
          },
          text: {
            primary: "hsl(var(--foreground))",
            secondary: "hsl(var(--muted-foreground))",
            muted: "hsl(var(--muted-foreground) / 0.7)",
          },
          accent: {
            DEFAULT: "hsl(var(--primary))",
            hover: "hsl(var(--primary) / 0.9)",
          },
          success: {
            DEFAULT: "hsl(142 76% 45%)",
            bg: "hsl(142 76% 45% / 0.15)",
          },
          warning: {
            DEFAULT: "hsl(32 95% 55%)",
            bg: "hsl(32 95% 55% / 0.15)",
          },
          error: {
            DEFAULT: "hsl(0 78% 55%)",
            bg: "hsl(0 78% 55% / 0.15)",
          },
        },
        // Flat / base colors (regular buttons)
        background: "hsl(var(--background) / <alpha-value>)",
        foreground: "hsl(var(--foreground) / <alpha-value>)",
        border: "hsl(var(--border) / <alpha-value>)",
        input: "hsl(var(--input) / <alpha-value>)",
        card: {
          DEFAULT: "hsl(var(--card) / <alpha-value>)",
          foreground: "hsl(var(--card-foreground) / <alpha-value>)",
          border: "hsl(var(--card-border) / <alpha-value>)",
        },
        popover: {
          DEFAULT: "hsl(var(--popover) / <alpha-value>)",
          foreground: "hsl(var(--popover-foreground) / <alpha-value>)",
          border: "hsl(var(--popover-border) / <alpha-value>)",
        },
        primary: {
          DEFAULT: "hsl(var(--primary) / <alpha-value>)",
          foreground: "hsl(var(--primary-foreground) / <alpha-value>)",
          border: "var(--primary-border)",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary) / <alpha-value>)",
          foreground: "hsl(var(--secondary-foreground) / <alpha-value>)",
          border: "var(--secondary-border)",
        },
        muted: {
          DEFAULT: "hsl(var(--muted) / <alpha-value>)",
          foreground: "hsl(var(--muted-foreground) / <alpha-value>)",
          border: "var(--muted-border)",
        },
        accent: {
          DEFAULT: "hsl(var(--accent) / <alpha-value>)",
          foreground: "hsl(var(--accent-foreground) / <alpha-value>)",
          border: "var(--accent-border)",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive) / <alpha-value>)",
          foreground: "hsl(var(--destructive-foreground) / <alpha-value>)",
          border: "var(--destructive-border)",
        },
        ring: "hsl(var(--ring) / <alpha-value>)",
        chart: {
          "1": "hsl(var(--chart-1) / <alpha-value>)",
          "2": "hsl(var(--chart-2) / <alpha-value>)",
          "3": "hsl(var(--chart-3) / <alpha-value>)",
          "4": "hsl(var(--chart-4) / <alpha-value>)",
          "5": "hsl(var(--chart-5) / <alpha-value>)",
        },
        sidebar: {
          ring: "hsl(var(--sidebar-ring) / <alpha-value>)",
          DEFAULT: "hsl(var(--sidebar) / <alpha-value>)",
          foreground: "hsl(var(--sidebar-foreground) / <alpha-value>)",
          border: "hsl(var(--sidebar-border) / <alpha-value>)",
        },
        "sidebar-primary": {
          DEFAULT: "hsl(var(--sidebar-primary) / <alpha-value>)",
          foreground: "hsl(var(--sidebar-primary-foreground) / <alpha-value>)",
          border: "var(--sidebar-primary-border)",
        },
        "sidebar-accent": {
          DEFAULT: "hsl(var(--sidebar-accent) / <alpha-value>)",
          foreground: "hsl(var(--sidebar-accent-foreground) / <alpha-value>)",
          border: "var(--sidebar-accent-border)"
        },
        status: {
          online: "rgb(34 197 94)",
          away: "rgb(245 158 11)",
          busy: "rgb(239 68 68)",
          offline: "rgb(156 163 175)",
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)"],
        serif: ["var(--font-serif)"],
        mono: ["var(--font-mono)"],
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  plugins: [require("tailwindcss-animate"), require("@tailwindcss/typography")],
} satisfies Config;
