import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    // twinchain-ml es Python: su .venv trae archivos JS de terceros (sklearn) que no son nuestros.
    ignores: [".next/**", "out/**", "build/**", "next-env.d.ts", "twinchain-ml/**"],
  },
];

export default eslintConfig;
