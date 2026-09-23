import { useEffect } from "react";

import { refreshSession } from "../api/client";
import { useSession } from "../auth/session";
import { toast } from "../toasts";
import type { TableAction } from "./reducer";
import { useTable } from "./store";

const FATAL: Record<number, string> = {
  4403: "Você não faz parte desta mesa.",
  4404: "Mesa não encontrada.",
  4410: "Esta mesa foi arquivada.",
};

export function socketUrl(pin: string, location: Pick<Location, "protocol" | "host"> = window.location): string {
  const scheme = location.protocol === "https:" ? "wss" : "ws";
  return `${scheme}://${location.host}/ws/rooms/${pin}`;
}

/** Tempo de espera antes de reconectar: 0,5 s, 1 s, 2 s... até 10 s. */
export function backoff(attempt: number): number {
  return Math.min(10_000, 500 * 2 ** attempt);
}

/** Conecta na mesa pelo WebSocket, autentica, entrega os eventos ao store e reconecta sozinho. */
export function useRoomSocket(pin: string | undefined): void {
  useEffect(() => {
    if (!pin) return;
    const { dispatch, setStatus, setSender, reset } = useTable.getState();
    reset();
    let socket: WebSocket | null = null;
    let stopped = false;
    let attempt = 0;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    const scheduleRetry = () => {
      setStatus("offline", "Reconectando…");
      retryTimer = setTimeout(connect, backoff(attempt++));
    };

    function connect() {
      if (stopped) return;
      setStatus("connecting");
      const ws = new WebSocket(socketUrl(pin as string));
      socket = ws;
      ws.onopen = () => ws.send(JSON.stringify({ type: "auth", token: useSession.getState().access ?? "" }));
      ws.onmessage = (event) => {
        const message = JSON.parse(String(event.data)) as { type: string; message?: string };
        if (message.type === "welcome") {
          attempt = 0;
          setStatus("online");
        } else if (message.type === "error") {
          toast.error(message.message ?? "Erro na mesa.");
          return;
        } else if (message.type === "room.closed") {
          setStatus("closed", FATAL[4410]);
        }
        dispatch(message as TableAction);
      };
      ws.onclose = (event) => {
        if (stopped || socket !== ws) return;
        if (event.code in FATAL) {
          setStatus("closed", FATAL[event.code]);
          return;
        }
        if (event.code === 4401) {
          // Token de acesso venceu: renova e tenta de novo na hora.
          void refreshSession().then((ok) => {
            if (stopped) return;
            if (ok) connect();
            else setStatus("closed", "Sessão expirada. Entre novamente.");
          });
          return;
        }
        scheduleRetry();
      };
    }

    connect();
    setSender((message) => {
      if (socket?.readyState !== WebSocket.OPEN) return false;
      socket.send(JSON.stringify(message));
      return true;
    });
    const ping = setInterval(() => {
      if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "ping" }));
    }, 25_000);

    return () => {
      stopped = true;
      clearTimeout(retryTimer);
      clearInterval(ping);
      setSender(null);
      socket?.close();
    };
  }, [pin]);
}
