import esbuild from "esbuild";

await esbuild.build({
    entryPoints: ["src/content.ts"],
    outfile: "dist/content.js",
    bundle: true,
    format: "iife",      // 打成 IIFE，让内容脚本直接运行
    platform: "browser",
    sourcemap: false,
    minify: false,
    logLevel: "info"
});
