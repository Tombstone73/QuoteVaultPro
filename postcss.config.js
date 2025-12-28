export default {
  plugins: {
    // TODO(postcss): Upstream warning source is TailwindCSS v3 calling `postcss.parse()` without `{ from }`.
    // Evidence (local install): tailwindcss/src/lib/generateRules.js calls `postcss.parse(...)` without options.
    // This warning is non-fatal in our builds; a real fix likely requires a TailwindCSS upgrade/fix upstream.
    tailwindcss: {},
    autoprefixer: {},
  },
}
