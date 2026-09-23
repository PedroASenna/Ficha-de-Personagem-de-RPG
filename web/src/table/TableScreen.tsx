import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import QrCodeIcon from "@mui/icons-material/QrCode2";
import AddIcon from "@mui/icons-material/Add";
import AppBar from "@mui/material/AppBar";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import Toolbar from "@mui/material/Toolbar";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { api } from "../api/client";
import type { Room } from "../api/types";
import { useRouter } from "../router";
import { ConnectDialog } from "./ConnectDialog";
import { DetailPanel } from "./DetailPanel";
import { LogPanel } from "./LogPanel";
import { MapCanvas } from "./MapCanvas";
import { Roster } from "./Roster";
import { SceneBar } from "./SceneBar";
import { SceneDialog } from "./SceneDialog";
import { useRoomSocket } from "./socket";
import { useTable } from "./store";

const STATUS_LABEL = {
  connecting: { label: "Conectando…", color: "default" },
  online: { label: "Ao vivo", color: "success" },
  offline: { label: "Reconectando…", color: "warning" },
  closed: { label: "Desconectado", color: "error" },
} as const;

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <Box sx={{ minHeight: "100vh", display: "grid", placeItems: "center", p: 3, textAlign: "center" }}>
      <Stack spacing={2} sx={{ alignItems: "center", maxWidth: 480 }}>
        {children}
      </Stack>
    </Box>
  );
}

function EmptyScenes({ roomId }: { roomId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Box sx={{ flex: 1, display: "grid", placeItems: "center", p: 3 }}>
      <Stack spacing={2} sx={{ alignItems: "center", maxWidth: 420, textAlign: "center" }}>
        <Typography variant="h5">Monte a primeira cena</Typography>
        <Typography color="text.secondary">
          Importe a imagem do mapa (taverna, floresta, masmorra…). Depois arraste os personagens e os inimigos para cima
          dele. Se o grupo se separar, crie outra cena e mova cada um para onde estiver.
        </Typography>
        <Button variant="contained" size="large" startIcon={<AddIcon />} onClick={() => setOpen(true)}>
          Criar cena com mapa
        </Button>
      </Stack>
      <SceneDialog open={open} roomId={roomId} scene={null} onClose={() => setOpen(false)} />
    </Box>
  );
}

function Board({ room }: { room: Room }) {
  const navigate = useRouter((s) => s.navigate);
  const status = useTable((s) => s.status);
  const statusMessage = useTable((s) => s.statusMessage);
  const ready = useTable((s) => s.ready);
  const activeScene = useTable((s) => s.scenes.find((sc) => sc.id === s.activeSceneId) ?? null);
  const hasScenes = useTable((s) => s.scenes.length > 0);
  const onlinePlayers = useTable((s) => s.party.filter((p) => s.online[p.owner_id]).length);
  const partySize = useTable((s) => s.party.length);
  const [connectOpen, setConnectOpen] = useState(false);
  const statusInfo = STATUS_LABEL[status];

  return (
    <Box sx={{ height: "100vh", display: "flex", flexDirection: "column" }}>
      <AppBar position="static" color="transparent" elevation={0} sx={{ borderBottom: 1, borderColor: "divider" }}>
        <Toolbar variant="dense" sx={{ gap: 1.5 }}>
          <Tooltip title="Voltar para as mesas">
            <IconButton edge="start" aria-label="Voltar" onClick={() => navigate({ name: "rooms" })}>
              <ArrowBackIcon />
            </IconButton>
          </Tooltip>
          <Typography variant="h6" noWrap sx={{ minWidth: 0 }}>
            {room.name}
          </Typography>
          <Typography variant="body2" color="text.secondary" noWrap sx={{ display: { xs: "none", md: "block" } }}>
            {room.ruleset_name}
          </Typography>
          <Box sx={{ flex: 1 }} />
          <Tooltip title={statusMessage ?? ""}>
            <Chip
              size="small"
              label={statusInfo.label}
              color={statusInfo.color}
              variant="outlined"
              data-testid="ws-status"
            />
          </Tooltip>
          <Chip size="small" label={`${onlinePlayers}/${partySize} jogadores conectados`} variant="outlined" />
          <Chip label={`PIN ${room.pin}`} color="primary" />
          <Button variant="contained" startIcon={<QrCodeIcon />} onClick={() => setConnectOpen(true)}>
            Conectar celulares
          </Button>
        </Toolbar>
      </AppBar>

      {status === "closed" && statusMessage && (
        <Box sx={{ bgcolor: "error.dark", px: 2, py: 0.5 }}>
          <Typography variant="body2">{statusMessage}</Typography>
        </Box>
      )}

      {!ready ? (
        <Box sx={{ flex: 1, display: "grid", placeItems: "center" }}>
          <CircularProgress />
        </Box>
      ) : (
        <Box sx={{ flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: "300px minmax(0, 1fr) 380px" }}>
          <Box sx={{ borderRight: 1, borderColor: "divider", minHeight: 0 }}>
            <Roster roomId={room.id} />
          </Box>
          <Box sx={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
            {hasScenes ? (
              <>
                <SceneBar roomId={room.id} />
                {activeScene && <MapCanvas key={activeScene.id} roomId={room.id} scene={activeScene} />}
              </>
            ) : (
              <EmptyScenes roomId={room.id} />
            )}
          </Box>
          <Box sx={{ borderLeft: 1, borderColor: "divider", display: "flex", flexDirection: "column", minHeight: 0 }}>
            <Box sx={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
              <DetailPanel />
            </Box>
            <Box sx={{ height: "40%", minHeight: 240, borderTop: 1, borderColor: "divider" }}>
              <LogPanel />
            </Box>
          </Box>
        </Box>
      )}
      <ConnectDialog open={connectOpen} pin={room.pin} onClose={() => setConnectOpen(false)} />
    </Box>
  );
}

export function TableScreen({ roomId }: { roomId: string }) {
  const navigate = useRouter((s) => s.navigate);
  const room = useQuery({ queryKey: ["room", roomId], queryFn: () => api<Room>(`/rooms/${roomId}`) });
  const usable = room.data?.my_role === "master" && room.data.status === "open";
  useRoomSocket(usable ? room.data?.pin : undefined);

  if (room.isLoading) {
    return (
      <Centered>
        <CircularProgress />
      </Centered>
    );
  }
  if (room.isError || !room.data) {
    return (
      <Centered>
        <Typography variant="h5">Mesa não encontrada</Typography>
        <Typography color="text.secondary">{room.error?.message}</Typography>
        <Button onClick={() => navigate({ name: "rooms" })}>Voltar</Button>
      </Centered>
    );
  }
  if (room.data.my_role !== "master") {
    return (
      <Centered>
        <Typography variant="h5">Esta mesa é de outro Mestre</Typography>
        <Typography color="text.secondary">Jogadores participam pelo app RPG Play no celular.</Typography>
        <Button onClick={() => navigate({ name: "rooms" })}>Voltar</Button>
      </Centered>
    );
  }
  if (room.data.status !== "open") {
    return (
      <Centered>
        <Typography variant="h5">Campanha arquivada</Typography>
        <Typography color="text.secondary">Reabra a mesa na lista para continuar de onde parou.</Typography>
        <Button onClick={() => navigate({ name: "rooms" })}>Voltar</Button>
      </Centered>
    );
  }
  return <Board room={room.data} />;
}
