// Separate, standalone webpack config for the local UI render-performance test harness
// (ui/test/perfHarness.tsx). Deliberately NOT referenced by webpack.config.js, package.json's
// `build`/`build:ui` scripts, or build.ps1 -- it must never be able to affect the real extension
// build. Invoked only by ui/test/measureRenderPerf.js.
const CopyWebpackPlugin = require('copy-webpack-plugin');
const path = require('path');

module.exports = {
  target: 'web',
  // Matches the real build:ui script (production React is markedly faster than the dev build --
  // see build.ps1/package.json history for the measured before/after). Testing against dev mode
  // here would measure a bundle real users never actually get.
  mode: 'production',
  entry: {
    'perf-harness': path.resolve(__dirname, 'test/perfHarness.tsx'),
  },
  output: {
    path: path.resolve(__dirname, 'test', '.generated', 'dist-perf'),
  },
  module: {
    rules: [
      { test: /\.tsx?$/i, loader: 'ts-loader' },
      { test: /\.s[ac]ss$/i, use: ['style-loader', 'css-loader', 'sass-loader'] },
      { test: /\.css$/i, use: ['style-loader', 'css-loader'] },
      { test: /\.(woff|woff2|eot|ttf|otf)$/i, type: 'asset/inline' },
    ],
  },
  resolve: {
    extensions: ['.ts', '.tsx', '.js'],
    fallback: {
      path: require.resolve('path-browserify'),
    },
  },
  devtool: false,
  plugins: [
    new CopyWebpackPlugin({
      patterns: [{ from: path.resolve(__dirname, 'test/perfHarness.html'), to: 'perfHarness.html' }],
    }),
  ],
  stats: {
    warnings: false,
  },
};
