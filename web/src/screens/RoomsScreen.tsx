import AddIcon from "@mui/icons-material/Add";
import ArchiveIcon from "@mui/icons-material/Inventory2Outlined";
import LogoutIcon from "@mui/icons-material/Logout";
import ManageAccountsIcon from "@mui/icons-material/ManageAccounts";
import KeyIcon from "@mui/icons-material/Key";
import PlayIcon from "@mui/icons-material/PlayArrow";
import ReplayIcon from "@mui/icons-material/Replay";
import AppBar from "@mui/material/AppBar";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardActions from "@mui/material/CardActions";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import Container from "@mui/material/Container";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import Toolbar from "@mui/material/Toolbar";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { api } from "../api/client";
import type { Discovery, Room } from "../api/types";
import { useSession } from "../auth/session";
import { useRouter } from "../router";
import { toast } from "../toasts";
import { AccountsDialog, PasswordDialog } from "./AccountDialogs";
import { NewRoomDialog } from "./NewRoomDialog";

function formatWhen(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function RoomCard({ room }: { room: Room }) {
  const navigate = useRouter((s) => s.navigate);
  const queryClient = useQueryClient();
  const players = room.members.filter((m) => m.role === "player");
  const archived = room.status === "closed";

  const archive = useMutation({
    mutationFn: () => api(`/rooms/${room.id}/close`, { method: "POST" }),
    onSuccess: () => {
      toast.info(`"${room.name}" foi arquivada. Tudo fica salvo.`);
      return queryClient.invalidateQueries({ queryKey: ["rooms"] });
    },
    onError: toast.error,
  });
  const reopen = useMutation({
    mutationFn: () => api<Room>(`/rooms/${room.id}/reopen`, { method: "POST" }),
    onSuccess: (reopened) => {
      toast.success(`Mesa reaberta. PIN ${reopened.pin}`);
      return queryClient.invalidateQueries({ queryKey: ["rooms"] });
    },
    onError: toast.error,
  });

  return (
    <Card variant="outlined" sx={{ display: "flex", flexDirection: "column", opacity: archived ? 0.75 : 1 }}>
      <CardContent sx={{ flex: 1 }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: "center", mb: 1 }}>
          <Typography variant="h6" sx={{ flex: 1 }} noWrap>
            {room.name}
          </Typography>
          {!archived && <Chip label={`PIN ${room.pin}`} color="primary" variant="outlined" size="small" />}
        </Stack>
        <Typography variant="body2" color="text.secondary">
          {room.ruleset_name}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {players.length === 0
            ? "Nenhum jogador ainda"
            : players.map((p) => p.character?.name ?? p.display_name).join(", ")}
        </Typography>
        <Typography variant="caption" color="text.disabled">
          Última atividade: {formatWhen(room.last_activity_at ?? room.created_at)}
        </Typography>
      </CardContent>
      <CardActions>
        {archived ? (
          <Button startIcon={<ReplayIcon />} onClick={() => reopen.mutate()} loading={reopen.isPending}>
            Reabrir campanha
          </Button>
        ) : (
          <>
            <Button
              variant="contained"
              startIcon={<PlayIcon />}
              onClick={() => navigate({ name: "table", roomId: room.id })}
            >
              Abrir mesa
            </Button>
            <Tooltip title="Arquivar (tudo fica salvo e dá para reabrir)">
              <IconButton
                aria-label="Arquivar"
                onClick={() => window.confirm(`Arquivar "${room.name}"?`) && archive.mutate()}
              >
                <ArchiveIcon />
              </IconButton>
            </Tooltip>
          </>
        )}
      </CardActions>
    </Card>
  );
}

export function RoomsScreen() {
  const user = useSession((s) => s.user);
  const [dialog, setDialog] = useState<"new" | "password" | "accounts" | null>(null);
  const rooms = useQuery({
    queryKey: ["rooms"],
    queryFn: () => api<Room[]>("/rooms?include_archived=true"),
  });
  const server = useQuery({ queryKey: ["discovery"], queryFn: () => api<Discovery>("/discovery", { auth: false }) });

  const mine = (rooms.data ?? []).filter((r) => r.my_role === "master");
  const open = mine.filter((r) => r.status === "open");
  const archived = mine.filter((r) => r.status === "closed");

  const logout = async () => {
    const refresh = useSession.getState().refresh;
    if (refresh) await api("/auth/logout", { json: { refresh_token: refresh }, auth: false }).catch(() => undefined);
    useSession.getState().clear();
  };

  return (
    <Box sx={{ minHeight: "100vh" }}>
      <AppBar position="sticky" color="transparent" elevation={0} sx={{ borderBottom: 1, borderColor: "divider" }}>
        <Toolbar sx={{ gap: 1 }}>
          <Box component="img" src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" sx={{ width: 32, height: 32 }} />
          <Typography variant="h6" sx={{ flex: 1 }}>
            RPG Play · Mestre
            {server.data && (
              <Typography component="span" color="text.secondary" sx={{ ml: 1, fontFamily: "inherit" }}>
                {server.data.name}
              </Typography>
            )}
          </Typography>
          <Typography color="text.secondary" sx={{ display: { xs: "none", sm: "block" } }}>
            {user?.display_name}
          </Typography>
          <Tooltip title="Trocar minha senha">
            <IconButton aria-label="Trocar senha" onClick={() => setDialog("password")}>
              <KeyIcon />
            </IconButton>
          </Tooltip>
          {user?.is_admin && (
            <Tooltip title="Contas do servidor">
              <IconButton aria-label="Contas" onClick={() => setDialog("accounts")}>
                <ManageAccountsIcon />
              </IconButton>
            </Tooltip>
          )}
          <Tooltip title="Sair">
            <IconButton aria-label="Sair" onClick={() => void logout()}>
              <LogoutIcon />
            </IconButton>
          </Tooltip>
        </Toolbar>
      </AppBar>

      <Container maxWidth="lg" sx={{ py: 4 }}>
        <Stack direction="row" sx={{ alignItems: "center", mb: 2 }}>
          <Typography variant="h5" sx={{ flex: 1 }}>
            Suas mesas
          </Typography>
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setDialog("new")}>
            Nova mesa
          </Button>
        </Stack>
        {rooms.isLoading && <Typography color="text.secondary">Carregando…</Typography>}
        {rooms.isSuccess && open.length === 0 && (
          <Card variant="outlined" sx={{ p: 4, textAlign: "center" }}>
            <Typography variant="h6" gutterBottom>
              Nenhuma mesa aberta
            </Typography>
            <Typography color="text.secondary" sx={{ mb: 2 }}>
              Crie uma mesa, escolha o sistema de regras e passe o PIN (ou o QR code) para o grupo.
            </Typography>
            <Button variant="outlined" startIcon={<AddIcon />} onClick={() => setDialog("new")}>
              Criar a primeira mesa
            </Button>
          </Card>
        )}
        <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))" }}>
          {open.map((room) => (
            <RoomCard key={room.id} room={room} />
          ))}
        </Box>

        {archived.length > 0 && (
          <>
            <Typography variant="h6" sx={{ mt: 5, mb: 2 }} color="text.secondary">
              Campanhas arquivadas
            </Typography>
            <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))" }}>
              {archived.map((room) => (
                <RoomCard key={room.id} room={room} />
              ))}
            </Box>
          </>
        )}
      </Container>

      <NewRoomDialog open={dialog === "new"} onClose={() => setDialog(null)} />
      <PasswordDialog open={dialog === "password"} onClose={() => setDialog(null)} />
      {user?.is_admin && <AccountsDialog open={dialog === "accounts"} onClose={() => setDialog(null)} />}
    </Box>
  );
}
