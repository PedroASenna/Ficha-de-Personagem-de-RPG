import dgram from "node:dgram";
import type os from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import {
  broadcastAddresses,
  httpScan,
  intToIpv4,
  ipv4ToInt,
  MAGIC,
  normalizeServerUrl,
  parseReply,
  probe,
  scanCandidates,
  udpDiscover,
} from "./discovery";

const iface = (address: string, netmask: string, internal = false) =>
  ({ address, netmask, family: "IPv4", internal, mac: "", cidr: null }) as unknown as os.NetworkInterfaceInfo;

const interfaces = {
  lo: [iface("127.0.0.1", "255.0.0.0", true)],
  wlan0: [iface("192.168.0.37", "255.255.255.0")],
  eth0: [iface("10.1.2.3", "255.255.0.0")],
} as unknown as ReturnType<typeof os.networkInterfaces>;

describe("endereços", () => {
  it("normaliza o que o Mestre digita", () => {
    expect(normalizeServerUrl("192.168.0.20")).toBe("http://192.168.0.20:8080");
    expect(normalizeServerUrl(" 192.168.0.20:9000 ")).toBe("http://192.168.0.20:9000");
    expect(normalizeServerUrl("http://casa.local:8080/mestre/")).toBe("http://casa.local:8080");
    expect(normalizeServerUrl("https://mesa.exemplo")).toBe("https://mesa.exemplo");
    expect(normalizeServerUrl("ftp://x")).toBeNull();
    expect(normalizeServerUrl("")).toBeNull();
    expect(normalizeServerUrl("http://")).toBeNull();
  });

  it("converte IPv4", () => {
    expect(ipv4ToInt("192.168.0.1")).toBe(3232235521);
    expect(intToIpv4(3232235521)).toBe("192.168.0.1");
    expect(intToIpv4(ipv4ToInt("255.255.255.255"))).toBe("255.255.255.255");
  });

  it("calcula os broadcasts de cada rede", () => {
    expect(broadcastAddresses(interfaces)).toEqual(["192.168.0.255", "10.1.255.255", "255.255.255.255", "127.0.0.1"]);
  });

  it("varre só a faixa /24 de cada rede", () => {
    const hosts = scanCandidates(interfaces);
    expect(hosts).toHaveLength(1 + 254 * 2);
    expect(hosts).toContain("192.168.0.1");
    expect(hosts).toContain("192.168.0.254");
    expect(hosts).toContain("10.1.2.200");
    expect(hosts).not.toContain("10.1.3.1");
  });

  it("interpreta a resposta UDP", () => {
    const reply = JSON.stringify({ app: "rpgplay", name: "Casa", version: "0.2.0", server_id: "abc", port: 8080 });
    expect(parseReply(reply, "192.168.0.20")).toEqual({
      url: "http://192.168.0.20:8080",
      name: "Casa",
      version: "0.2.0",
      serverId: "abc",
    });
    expect(parseReply(JSON.stringify({ app: "outro", name: "x" }), "1.2.3.4")).toBeNull();
    expect(parseReply("lixo", "1.2.3.4")).toBeNull();
  });
});

describe("rede", () => {
  let responder: dgram.Socket | null = null;
  afterEach(() => {
    responder?.close();
    responder = null;
  });

  it("acha o servidor pelo broadcast UDP (respondedor falso)", async () => {
    responder = dgram.createSocket("udp4");
    responder.on("message", (message, rinfo) => {
      if (!message.toString().startsWith(MAGIC)) return;
      const reply = JSON.stringify({
        app: "rpgplay",
        name: "Mesa Teste",
        version: "0.2.0",
        server_id: "s1",
        port: 8123,
      });
      responder?.send(reply, rinfo.port, rinfo.address);
    });
    await new Promise<void>((resolve) => responder?.bind(0, "127.0.0.1", resolve));
    const port = responder.address().port;
    const found = await udpDiscover(port, 400, ["127.0.0.1", "127.0.0.1"]);
    expect(found).toEqual([{ url: "http://127.0.0.1:8123", name: "Mesa Teste", version: "0.2.0", serverId: "s1" }]);
  });

  it("varredura HTTP com respostas simuladas, sem duplicar servidores", async () => {
    const answers: Record<string, unknown> = {
      "http://10.0.0.5:8080/api/v1/discovery": { app: "rpgplay", name: "Casa", version: "0.2.0", server_id: "s1" },
      "http://10.0.0.9:8080/api/v1/discovery": { app: "outro-app" },
    };
    const fetchImpl = async (url: string) => {
      if (!(url in answers)) throw new Error("recusado");
      return { ok: true, json: async () => answers[url] };
    };
    const hosts = ["10.0.0.1", "10.0.0.5", "10.0.0.9", "127.0.0.1"];
    const found = await httpScan(hosts, 8080, { fetchImpl, concurrency: 2 });
    expect(found.map((s) => s.url)).toEqual(["http://10.0.0.5:8080"]);
  });

  it("probe desiste quando o endereço não responde a tempo", async () => {
    const never = (_url: string, init?: { signal?: AbortSignal }) =>
      new Promise<never>((_, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("timeout"))));
    await expect(probe("http://10.0.0.99:8080", 50, never)).resolves.toBeNull();
  });
});
