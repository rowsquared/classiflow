import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const eslintConfig = [
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
      "lib/generated/**",
      "playwright-report/**",
      "test-results/**",
    ],
  },
  {
    // React Compiler rules (eslint-plugin-react-hooks 7). Components that break
    // them are skipped by the compiler, not miscompiled. The remaining cases
    // (state synced in effects, refs read during render) sit in the queue,
    // labelling and taxonomy browser components that the modernization plan
    // (M06) splits up; fix them there and then make these errors again.
    rules: {
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/purity": "warn",
    },
  },
];

export default eslintConfig;
