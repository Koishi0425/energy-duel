import server from './app.config.js';

const port = Number(process.env.PORT ?? 2567);

await server.listen(port);
console.log(`[server] Energy Duel listening on http://localhost:${port}`);
