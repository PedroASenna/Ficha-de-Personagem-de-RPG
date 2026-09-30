import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import CircularProgress from "@mui/material/CircularProgress";
import FormControlLabel from "@mui/material/FormControlLabel";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import QRCode from "qrcode";
import { useState } from "react";

import { api } from "../api/client";
import type { Discovery, RemoteShare, Room } from "../api/types";
import { useSession } from "../auth/session";
import { copyText } from "../clipboard";
import { CopyButton, RemoteDialog } from "../screens/RemoteDialog";
import { toast } from "../toasts";
import { inviteText, joinLink, serverCandidates } from "./connect";

function JoinQr({ link, label }: { link: string; label: string }) {
  const qr = useQuery({
    queryKey: ["qr", link],
    queryFn: () => QRCode.toDataURL(link, { margin: 1, width: 300, color: { dark: "#14100d", light: "#f3e3bf" } }),
    staleTime: Infinity,
  });
  return (
    <Box
      sx={{ width: 300, height: 300, borderRadius: 2, overflow: "hidden", bgcolor: "#f3e3bf", flexShrink: 0 }}
      data-testid="join-qr"
    >
      {qr.data && <img src={qr.data} alt={label} width={300} height={300} />}
    </Box>
  );
}

function LocalContent({ pin }: { pin: string }) {
  const discovery = useQuery({ queryKey: ["discovery"], queryFn: () => api<Discovery>("/discovery", { auth: false }) });
  const candidates = serverCandidates(window.location, discovery.data);
  const [choice, setChoice] = useState(0);
  const server = candidates[Math.min(choice, candidates.length - 1)] ?? window.location.origin;
  const link = joinLink(server, pin);

  return (
    <Stack direction={{ xs: "column", sm: "row" }} spacing={3} sx={{ alignItems: "center" }}>
      <JoinQr link={link} label={`QR code para entrar na mesa ${pin}`} />
      <Stack spacing={2} sx={{ minWidth: 0 }}>
        <Typography>
          No celular, abra o app <b>RPG Play</b> e toque em <b>Ler QR code da mesa</b>. Ele encontra o servidor e já
          entra nesta mesa.
        </Typography>
        <Box>
          <Typography variant="overline" color="text.secondary">
            Ou digite no app
          </Typography>
          <Typography variant="h4" sx={{ letterSpacing: 4 }} data-testid="join-pin">
            {pin}
          </Typography>
          {candidates.length > 1 ? (
            <TextField
              select
              size="small"
              label="Endereço do servidor"
              value={Math.min(choice, candidates.length - 1)}
              onChange={(e) => setChoice(Number(e.target.value))}
              sx={{ mt: 1, minWidth: 260 }}
            >
              {candidates.map((url, index) => (
                <MenuItem key={url} value={index}>
                  {url}
                </MenuItem>
              ))}
            </TextField>
          ) : (
            <Typography sx={{ fontFamily: "monospace" }}>{server}</Typography>
          )}
        </Box>
        {candidates.length === 0 && (
          <Alert severity="warning">
            Não descobri o IP do servidor na rede. Confira com <code>rpgplay-server info</code> no servidor.
          </Alert>
        )}
        <Typography variant="body2" color="text.secondary">
          Os celulares precisam estar no mesmo Wi-Fi do servidor. Se o app não achar, confira se o roteador não isola os
          aparelhos (“isolamento de clientes” / rede de convidados).
        </Typography>
        <Alert severity="info" variant="outlined">
          O celular não conecta? Quase sempre é o firewall do computador do servidor. Nele, rode{" "}
          <code>sudo rpgplay-server diagnostico</code> para ver o que está bloqueando e{" "}
          <code>sudo rpgplay-server liberar-firewall</code> para liberar só para a rede de casa.
        </Alert>
      </Stack>
    </Stack>
  );
}

function InternetContent({ pin }: { pin: string }) {
  const isAdmin = useSession((s) => s.user?.is_admin ?? false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const share = useQuery({
    queryKey: ["remote-share"],
    queryFn: () => api<RemoteShare>("/remote/share"),
    refetchInterval: (query) => (query.state.data?.enabled && query.state.data.status !== "on" ? 2000 : false),
  });
  const data = share.data;
  const settings = (
    <>
      {isAdmin && (
        <Button variant={data?.enabled ? "text" : "contained"} onClick={() => setSettingsOpen(true)}>
          {data?.enabled ? "Configurar acesso pela internet" : "Ligar acesso pela internet"}
        </Button>
      )}
      <RemoteDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </>
  );

  if (share.error) return <Alert severity="error">{share.error.message}</Alert>;
  if (!data) return <CircularProgress />;
  if (!data.enabled) {
    return (
      <Stack spacing={2} sx={{ alignItems: "flex-start" }}>
        <Typography>
          Quem está longe pode jogar pela internet, de graça e sem mexer no roteador. O servidor cria um link https e um
          código de acesso para criar conta.
        </Typography>
        {!isAdmin && (
          <Alert severity="info">
            O acesso pela internet está desligado. O dono do servidor liga no botão <b>Internet</b>, na lista de mesas.
          </Alert>
        )}
        {settings}
      </Stack>
    );
  }
  if (data.status !== "on" || !data.url) {
    return (
      <Stack spacing={2} sx={{ alignItems: "flex-start" }}>
        <Stack direction="row" spacing={2} sx={{ alignItems: "center" }}>
          {data.status !== "error" && <CircularProgress size={24} />}
          <Typography>
            {data.status === "error"
              ? "O link pela internet está com problema."
              : "Abrindo o link pela internet… (na primeira vez o servidor baixa o programa da Cloudflare)"}
          </Typography>
        </Stack>
        {settings}
      </Stack>
    );
  }

  const { url, access_code: code } = data;
  const invite = inviteText(url, pin, code);
  return (
    <Stack direction={{ xs: "column", sm: "row" }} spacing={3} sx={{ alignItems: "center" }}>
      <JoinQr link={joinLink(url, pin, code)} label={`QR code para entrar na mesa ${pin} pela internet`} />
      <Stack spacing={2} sx={{ minWidth: 0 }}>
        <Typography>
          Mande o convite no grupo (WhatsApp, Discord…). Quem abrir o link no celular cai no app: cria a conta e o
          personagem e entra na mesa quando quiser. Se estiver perto, pode ler o QR code.
        </Typography>
        <Box>
          <Button
            variant="contained"
            onClick={() =>
              void copyText(invite).then((ok) =>
                ok ? toast.success("Convite copiado.") : toast.error("Não consegui copiar."),
              )
            }
          >
            Copiar convite
          </Button>
        </Box>
        <Stack spacing={0.5}>
          <Typography variant="overline" color="text.secondary">
            Link
          </Typography>
          <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
            <Typography sx={{ fontFamily: "monospace", wordBreak: "break-all" }} data-testid="internet-url">
              {url}
            </Typography>
            <CopyButton text={url} what="Link" />
          </Stack>
          <Typography variant="overline" color="text.secondary">
            {code ? "Código de acesso · PIN" : "PIN da mesa"}
          </Typography>
          <Typography variant="h5" sx={{ fontFamily: "monospace", letterSpacing: 3 }}>
            {code && (
              <>
                <span data-testid="internet-code">{code}</span> ·{" "}
              </>
            )}
            <span data-testid="internet-pin">{pin}</span>
          </Typography>
        </Stack>
        <Typography variant="body2" color="text.secondary">
          {code
            ? "O código é pedido para criar conta pela internet. "
            : "Criar conta é livre (quem joga de longe já faz o personagem antes). "}
          Com “Aprovar entrada” ligado, ninguém entra na mesa sem você aceitar.
        </Typography>
        <Box>{settings}</Box>
      </Stack>
    </Stack>
  );
}

function ApprovalSwitch({ room }: { room: Room }) {
  const queryClient = useQueryClient();
  const toggle = useMutation({
    mutationFn: (value: boolean) =>
      api<Room>(`/rooms/${room.id}`, { method: "PATCH", json: { require_approval: value } }),
    onSuccess: (updated) => {
      queryClient.setQueryData(["room", room.id], updated);
      void queryClient.invalidateQueries({ queryKey: ["rooms"] });
    },
    onError: toast.error,
  });
  const checked = toggle.isPending ? Boolean(toggle.variables) : Boolean(room.require_approval);
  return (
    <FormControlLabel
      control={<Switch checked={checked} onChange={(event) => toggle.mutate(event.target.checked)} />}
      label={
        <Box>
          <Typography>Aprovar entrada</Typography>
          <Typography variant="body2" color="text.secondary">
            Quem entrar pelo PIN espera você aceitar (recomendado quando a mesa está na internet).
          </Typography>
        </Box>
      }
    />
  );
}

export function ConnectDialog({ open, room, onClose }: { open: boolean; room: Room; onClose: () => void }) {
  const [tab, setTab] = useState<"local" | "internet">("local");
  return (
    <Dialog open={open} onClose={onClose} maxWidth="md">
      <DialogTitle>Conectar celulares</DialogTitle>
      <DialogContent>
        <Tabs value={tab} onChange={(_, value: "local" | "internet") => setTab(value)} sx={{ mb: 2 }}>
          <Tab value="local" label="Na mesma rede (Wi-Fi)" />
          <Tab value="internet" label="Pela internet" />
        </Tabs>
        {open && (tab === "local" ? <LocalContent pin={room.pin} /> : <InternetContent pin={room.pin} />)}
        <Box sx={{ mt: 3, pt: 2, borderTop: 1, borderColor: "divider" }}>
          <ApprovalSwitch room={room} />
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Fechar</Button>
      </DialogActions>
    </Dialog>
  );
}
