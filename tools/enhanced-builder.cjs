// Separate identity, install location, user data and artifacts; never publish upstream.
const base = require('../package.json').build;
module.exports = {
  ...base,
  appId: 'org.upscayl.jm.Enhanced',
  productName: 'Upscayl Enhanced',
  extraMetadata: { version: '2.15.0-jm.3', productName: 'Upscayl Enhanced' },
  directories: { output: 'dist-enhanced' },
  artifactName: 'Upscayl-Enhanced-${version}-${arch}.${ext}',
  afterSign: undefined,
  publish: null,
  asarUnpack: ['**/node_modules/sharp/**/*','**/node_modules/@img/**/*'],
  win: { ...base.win, target: [{target:'nsis',arch:['x64']},{target:'zip',arch:['x64']}] },
  nsis: { ...base.nsis, perMachine:false, shortcutName:'Upscayl Enhanced', uninstallDisplayName:'Upscayl Enhanced' },
};
