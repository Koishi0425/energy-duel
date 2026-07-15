import server from './app.config.js';

const port = Number(process.env.PORT ?? 2567);

await server.listen(port);
console.log(`[server] 娇斯拉大战贡刚 listening on http://localhost:${port}`);
