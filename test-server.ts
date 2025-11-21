console.log('1. Starting test server...');

import "dotenv/config";
console.log('2. Loaded dotenv');

import express from "express";
console.log('3. Loaded express');

import { registerRoutes } from "./server/routes.js";
console.log('4. Loaded routes');

const app = express();
console.log('5. Created express app');

app.use(express.json());
console.log('6. Added middleware');

(async () => {
  console.log('7. Starting async function');
  try {
    console.log('8. About to register routes...');
    const server = await registerRoutes(app);
    console.log('9. Routes registered!');
    
    const port = 5000;
    server.listen(port, '0.0.0.0', () => {
      console.log(`10. Server listening on port ${port}`);
    });
  } catch (error) {
    console.error('ERROR:', error);
    process.exit(1);
  }
})();

