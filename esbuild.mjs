import * as esbuild from 'esbuild';

const watch = process.argv.includes('--watch');
const production = process.argv.includes('--production');

const common = {
  bundle: true,
  minify: production,
  sourcemap: production ? false : 'linked',
  logLevel: 'info',
  legalComments: production ? 'linked' : 'none',
};

// KaTeX ships .woff2, .woff and .ttf for every font; webviews only need .woff2.
const dropKatexFallbackFonts = {
  name: 'drop-katex-fallback-fonts',
  setup(build) {
    build.onResolve({ filter: /fonts\/KaTeX_.*\.(ttf|woff)$/ }, (args) => ({ path: args.path, namespace: 'empty-font' }));
    build.onLoad({ filter: /.*/, namespace: 'empty-font' }, () => ({ contents: '', loader: 'text' }));
  },
};

const builds = [
  {
    ...common,
    entryPoints: ['src/extension/extension.ts'],
    outfile: 'dist/extension.js',
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    external: ['vscode'],
  },
  {
    ...common,
    entryPoints: { main: 'src/webview/main.ts', styles: 'src/webview/styles/index.css' },
    outdir: 'dist/webview',
    platform: 'browser',
    format: 'esm',
    splitting: true,
    target: 'chrome120',
    chunkNames: 'chunks/[name]-[hash]',
    assetNames: 'assets/[name]-[hash]',
    loader: { '.woff2': 'file', '.ttf': 'file' },
    plugins: [dropKatexFallbackFonts],
  },
];

if (!production) {
  builds.push({
    ...common,
    entryPoints: ['dev/harness.ts'],
    outfile: 'dist/dev/harness.js',
    platform: 'browser',
    format: 'esm',
    target: 'chrome120',
  });
}

if (watch) {
  for (const b of builds) (await esbuild.context(b)).watch();
} else {
  await Promise.all(builds.map((b) => esbuild.build(b)));
}
