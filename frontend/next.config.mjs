// next.config.mjs — Next.js 14 設定
/** @type {import('next').NextConfig} */
const nextConfig = {
  // ── onnxruntime-web：解決 ESM .mjs 與 Terser/Webpack 5 相容問題 ─────
  webpack: (config, { isServer }) => {
    // 讓 webpack 正確處理 node_modules 中的 .mjs ESM 模組
    config.module.rules.push({
      test: /\.mjs$/,
      include: /node_modules/,
      type: "javascript/auto",
      resolve: { fullySpecified: false },
    });

    if (!isServer) {
      // 瀏覽器端：排除 Node.js 專用模組
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false, path: false, crypto: false,
      };
    }
    return config;
  },

  // 允許將 live-vlm-webui 嵌入 iframe
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options",        value: "SAMEORIGIN" },
          { key: "X-Content-Type-Options",  value: "nosniff" },
        ],
      },
    ];
  },

  // 反向代理
  async rewrites() {
    return [
      {
        source:      "/vlm-api/:path*",
        destination: `${process.env.LLAMA_BASE_URL || "http://localhost:8080"}/:path*`,
      },
      {
        source:      "/backend-api/:path*",
        destination: `${process.env.BACKEND_URL || "http://localhost:8000"}/:path*`,
      },
    ];
  },

  images: {
    remotePatterns: [
      { protocol: "https", hostname: "avatars.githubusercontent.com", pathname: "/**" },
      { protocol: "https", hostname: "lh3.googleusercontent.com",    pathname: "/**" },
      { protocol: "https", hostname: "*.googleusercontent.com",       pathname: "/**" },
    ],
  },

  reactStrictMode: false,
  output: "standalone",
};

export default nextConfig;
