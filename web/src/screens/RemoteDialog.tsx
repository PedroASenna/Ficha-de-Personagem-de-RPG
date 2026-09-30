import CopyIcon from "@mui/icons-material/ContentCopy";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import FormControlLabel from "@mui/material/FormControlLabel";
import IconButton from "@mui/material/IconButton";
import Radio from "@mui/material/Radio";
import RadioGroup from "@mui/material/RadioGroup";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "../api/client";
import type { RemoteMode, RemoteStatus, RemoteView } from "../api/types";
import { copyText } from "../clipboard";
import { toast } from "../toasts";

const REMOTE_STATUS: Record<RemoteStatus, { label: string; color: "default" | "success" | "warning" | "error" }> = {
  off: { label: "Desligado", color: "default" },
  downloading: { label: "Baixando o programa da Cloudflare…", color: "warning" },
  starting: { label: "Abrindo o link…", color: "warning" },
  on: { label: "No ar", color: "success" },
  error: { label: "Com problema", color: "error" },
};

const MODES: { value: RemoteMode; title: string; detail: string }[] = [
  { value: "off", title: "Desligado", detail: "Só quem está no Wi-Fi de casa joga." },
  {
    value: "quick",
    title: "Link rápido (Cloudflare)",
    detail: "Não precisa de conta nem mexer no roteador. O link muda quando o servidor ou o computador reinicia.",
  },
  {
    value: "fixed",
    title: "Link fixo (Tailscale)",
    detail: "O link nunca muda. Precisa de uma conta grátis no Tailscale e de um passo no computador do servidor.",
  },
];

async function copy(text: string, what: string) {
  if (await copyText(text)) toast.success(`${what} copiado.`);
  else toast.error("Não consegui copiar. Selecione o texto e copie.");
}

export function CopyButton({ text, what }: { text: string; what: string }) {
  return (
    <Tooltip title={`Copiar ${what.toLowerCase()}`}>
      <IconButton size="small" aria-label={`Copiar ${what.toLowerCase()}`} onClick={() => void copy(text, what)}>
        <CopyIcon fontSize="small" />
      </IconButton>
    </Tooltip>
  );
}

function FixedSteps() {
  return (
    <Alert severity="info" variant="outlined">
      <Typography variant="body2" gutterBottom>
        Para o link fixo, uma vez só, no computador do servidor:
      </Typography>
      <Typography variant="body2" component="div">
        <ol style={{ margin: 0, paddingLeft: 20 }}>
          <li>
            Instale o <b>Tailscale</b> (tailscale.com/download) e entre com uma conta grátis (Google, Microsoft…).
          </li>
          <li>
            <b>Linux:</b> rode <code>sudo rpgplay-server internet fixo</code>. <b>Windows:</b> no menu Iniciar, abra{" "}
            <b>“Link fixo pela internet (Tailscale)”</b>.
          </li>
          <li>Se aparecer um link pedindo para ativar o Funnel, abra e confirme. Depois clique em Conferir.</li>
        </ol>
      </Typography>
    </Alert>
  );
}

function RemoteContent() {
  const queryClient = useQueryClient();
  const remote = useQuery({
    queryKey: ["remote"],
    queryFn: () => api<RemoteView>("/remote"),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (status === "downloading" || status === "starting") return 1500;
      return status === "error" ? 5000 : false;
    },
  });
  const update = (view: RemoteView) => {
    queryClient.setQueryData(["remote"], view);
    void queryClient.invalidateQueries({ queryKey: ["remote-share"] });
    void queryClient.invalidateQueries({ queryKey: ["rooms"] });
  };
  const setMode = useMutation({
    mutationFn: (mode: RemoteMode) => api<RemoteView>("/remote", { method: "PUT", json: { mode } }),
    onSuccess: update,
    onError: toast.error,
  });
  const newCode = useMutation({
    mutationFn: () => api<RemoteView>("/remote/code", { method: "POST" }),
    onSuccess: (view) => {
      update(view);
      toast.info("Código trocado. Quem já tem conta continua entrando normalmente.");
    },
    onError: toast.error,
  });
  const codeSwitch = useMutation({
    mutationFn: (value: boolean) => api<RemoteView>("/remote", { method: "PUT", json: { require_code: value } }),
    onSuccess: update,
    onError: toast.error,
  });
  const check = useMutation({
    mutationFn: () => api<RemoteView>("/remote/check", { method: "POST" }),
    onSuccess: update,
    onError: toast.error,
  });

  const view = remote.data;
  if (!view) return <Typography color="text.secondary">Carregando…</Typography>;
  if (!view.available) return <Alert severity="warning">{view.error ?? "Acesso pela internet desligado."}</Alert>;
  const status = REMOTE_STATUS[view.status];

  return (
    <Stack spacing={2.5}>
      <Typography color="text.secondary">
        Quem está longe joga pelo celular com um link <b>https</b>, de graça, sem abrir portas no roteador. A pessoa
        cria a conta e o personagem, e nas mesas quem entra pelo PIN espera você aceitar.
      </Typography>
      <RadioGroup
        value={setMode.isPending ? setMode.variables : view.mode}
        onChange={(event) => setMode.mutate(event.target.value as RemoteMode)}
        aria-label="Acesso pela internet"
      >
        {MODES.map((mode) => (
          <FormControlLabel
            key={mode.value}
            value={mode.value}
            disabled={setMode.isPending}
            control={<Radio />}
            sx={{ alignItems: "flex-start", mb: 1, "& .MuiRadio-root": { pt: 0.25 } }}
            label={
              <Box>
                <Typography>{mode.title}</Typography>
                <Typography variant="body2" color="text.secondary">
                  {mode.detail}
                </Typography>
              </Box>
            }
          />
        ))}
      </RadioGroup>

      {view.mode !== "off" && (
        <Stack spacing={1.5}>
          <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
            <Typography variant="overline" color="text.secondary">
              Situação
            </Typography>
            <Chip size="small" label={status.label} color={status.color} data-testid="remote-status" />
          </Stack>
          {view.status === "on" && view.url && (
            <Box>
              <Typography variant="overline" color="text.secondary">
                Link
              </Typography>
              <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                <Typography sx={{ fontFamily: "monospace", wordBreak: "break-all" }} data-testid="remote-url">
                  {view.url}
                </Typography>
                <CopyButton text={view.url} what="Link" />
              </Stack>
            </Box>
          )}
          {view.error && <Alert severity="error">{view.error}</Alert>}
          {view.mode === "fixed" && view.status !== "on" && <FixedSteps />}
          {(view.mode === "fixed" || view.status === "error") && (
            <Box>
              <Button variant="outlined" onClick={() => check.mutate()} loading={check.isPending}>
                Conferir de novo
              </Button>
            </Box>
          )}
          {view.mode === "quick" && (
            <Typography variant="body2" color="text.secondary">
              Serviço gratuito da Cloudflare, sem garantia de funcionamento. Se o servidor reiniciar, o link muda: veja
              o novo aqui ou em “Conectar celulares”, dentro da mesa.
            </Typography>
          )}
        </Stack>
      )}

      <Box>
        <FormControlLabel
          control={
            <Switch
              checked={codeSwitch.isPending ? Boolean(codeSwitch.variables) : view.require_code}
              onChange={(event) => codeSwitch.mutate(event.target.checked)}
            />
          }
          label={
            <Box>
              <Typography>Pedir código de acesso para criar conta pela internet</Typography>
              <Typography variant="body2" color="text.secondary">
                Desligado, quem tem o link cria a conta e o personagem livremente; a mesa continua pedindo sua aprovação
                para entrar.
              </Typography>
            </Box>
          }
          sx={{ alignItems: "flex-start", "& .MuiSwitch-root": { mt: -0.5 } }}
        />
        {view.require_code && (
          <Box sx={{ mt: 1.5, ml: 6 }}>
            <Typography variant="overline" color="text.secondary">
              Código de acesso
            </Typography>
            <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
              <Typography variant="h5" sx={{ fontFamily: "monospace", letterSpacing: 3 }} data-testid="access-code">
                {view.access_code}
              </Typography>
              <CopyButton text={view.access_code} what="Código" />
              <Button
                size="small"
                onClick={() => window.confirm("Trocar o código de acesso? O antigo para de valer.") && newCode.mutate()}
                loading={newCode.isPending}
              >
                Trocar código
              </Button>
            </Stack>
            <Typography variant="body2" color="text.secondary">
              Vai junto no convite. Quem já tem conta não precisa dele. Troque se o código vazar.
            </Typography>
          </Box>
        )}
      </Box>
    </Stack>
  );
}

export function RemoteDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Jogar pela internet</DialogTitle>
      <DialogContent>{open && <RemoteContent />}</DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Fechar</Button>
      </DialogActions>
    </Dialog>
  );
}
