import path from "node:path";

/** @type {import('next').NextConfig} */
export default {
  // the Grounded SDK is linked from a sibling repo, so Turbopack's root must cover both
  turbopack: { root: path.resolve(import.meta.dirname, "../../..") },
  transpilePackages: ["@sajalydv/grounded-sdk"],
};
