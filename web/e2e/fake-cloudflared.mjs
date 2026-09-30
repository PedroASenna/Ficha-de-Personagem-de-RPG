#!/usr/bin/env node
// cloudflared falso para o teste ponta a ponta: escreve o link no stderr, como o de verdade, e fica rodando
// até o servidor desligar o túnel.
process.stderr.write("INF Requesting new quick Tunnel on trycloudflare.com...\n");
process.stderr.write("INF |  https://e2e-mesa.trycloudflare.com  |\n");
setInterval(() => {}, 1 << 30);
