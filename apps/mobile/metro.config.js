const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
// The Bun app deliberately has its own React/native dependency tree.
config.resolver.disableHierarchicalLookup = true;
config.resolver.nodeModulesPaths = [require('path').join(__dirname, 'node_modules')];
module.exports = config;
