// React Router's browser build needs the Web Encoding API that jsdom omits.
const { TextEncoder, TextDecoder } = require('node:util');
Object.assign(globalThis, { TextEncoder, TextDecoder });
