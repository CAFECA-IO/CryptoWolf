const webpack = require('webpack');
const fs = require('fs');
const path = require('path');

function getExternals()
{
  const nodeModules = fs.readdirSync(path.join(process.cwd(), 'node_modules'));
  return nodeModules.reduce((ext, mod) => {
    ext[mod] = `commonjs ${mod}`;
    return ext;
  }, {});
}

const frontend = {
  mode: 'none',
  entry: path.resolve(__dirname, 'src/frontend/main.js'),
  output: {
    path: path.resolve(__dirname, 'build/frontend'),
    filename: 'main.js',
    chunkFilename: '[id].js'
  },
  module: {
  },
  plugins: [
    new webpack.HotModuleReplacementPlugin(),
    new webpack.NoEmitOnErrorsPlugin()
  ]
};

const backend = {
  mode: 'none',
  target: 'node',
  entry: path.resolve(__dirname, 'src/backend/main.js'),
  output: {
    path: path.resolve(__dirname, 'build/backend'),
    filename: 'main.js',
    chunkFilename: '[id].js'
  },
  externals: getExternals(),
  node: {
    __filename: true,
    __dirname: true
  },
  module: {
    rules: [{
      test: /\.js$/,
      loader: 'babel-loader',
      exclude: /(node_modules)/
    }],
    exprContextCritical: false
  },
  plugins: [
    new webpack.IgnorePlugin(/\.(css|less|scss|svg|png|jpe?g|png)$/),
    new webpack.LoaderOptionsPlugin({
      minimize: true,
      debug: false
    })
  ]
}

module.exports = [
  frontend
];