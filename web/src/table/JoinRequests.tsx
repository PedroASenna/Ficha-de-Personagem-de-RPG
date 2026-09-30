import PublicIcon from "@mui/icons-material/Public";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import { useEffect, useRef, useState } from "react";

import { api } from "../api/client";
import type { JoinRequest } from "../api/types";
import { toast } from "../toasts";
import { useTable } from "./store";

/** Quem pediu para entrar (mesa com "Aprovar entrada"): o Mestre aceita ou recusa aqui mesmo. */
export function JoinRequests({ roomId }: { roomId: string }) {
  const requests = useTable((s) => s.requests);
  const status = useTable((s) => s.status);
  const dispatch = useTable((s) => s.dispatch);
  const [busy, setBusy] = useState<string | null>(null);
  const known = useRef<Set<string> | null>(null);

  const reload = () =>
    api<JoinRequest[]>(`/rooms/${roomId}/requests`)
      .then((list) => dispatch({ type: "join.requests", requests: list }))
      .catch(() => undefined);

  // A cada (re)conexão busca a lista inteira: pedidos feitos com o painel desconectado também aparecem.
  useEffect(() => {
    if (status === "online") void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, roomId]);

  useEffect(() => {
    const ids = new Set(requests.map((r) => r.user_id));
    if (known.current) {
      const fresh = requests.filter((r) => !known.current?.has(r.user_id));
      if (fresh.length === 1) toast.info(`${fresh[0].display_name} pediu para entrar na mesa.`);
      else if (fresh.length > 1) toast.info(`${fresh.length} pessoas pediram para entrar na mesa.`);
    }
    known.current = ids;
  }, [requests]);

  const decide = async (request: JoinRequest, action: "approve" | "deny") => {
    setBusy(request.user_id);
    try {
      await api(`/rooms/${roomId}/requests/${request.user_id}/${action}`, { method: "POST" });
      toast.success(action === "approve" ? `${request.display_name} entrou na mesa.` : "Entrada recusada.");
    } catch (error) {
      toast.error(error);
    } finally {
      setBusy(null);
      void reload();
    }
  };

  if (requests.length === 0) return null;
  return (
    <Stack spacing={0.5} sx={{ px: 2, py: 1, borderBottom: 1, borderColor: "divider" }} data-testid="join-requests">
      {requests.map((request) => (
        <Alert
          key={request.user_id}
          severity="warning"
          variant="outlined"
          icon={
            request.remote ? (
              <Tooltip title="Pediu pela internet">
                <PublicIcon fontSize="inherit" />
              </Tooltip>
            ) : undefined
          }
          action={
            <Stack direction="row" spacing={1}>
              <Button
                size="small"
                variant="contained"
                loading={busy === request.user_id}
                onClick={() => void decide(request, "approve")}
              >
                Aceitar
              </Button>
              <Button
                size="small"
                color="inherit"
                disabled={busy === request.user_id}
                onClick={() => void decide(request, "deny")}
              >
                Recusar
              </Button>
            </Stack>
          }
        >
          <b>{request.display_name}</b> (@{request.username})
          {request.character_name ? ` com ${request.character_name}` : ""} quer entrar na mesa
          {request.remote ? " pela internet" : ""}.
        </Alert>
      ))}
    </Stack>
  );
}
