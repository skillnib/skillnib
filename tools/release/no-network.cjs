// Preloaded into the smoke-test processes: any attempt to open a network connection throws.
const net = require('node:net');
const fail = () => { throw new Error('network access attempted during the release check'); };
net.Socket.prototype.connect = fail;
require('node:dns').lookup = fail;
