import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useQuery } from "@tanstack/react-query";
import QRCode from "qrcode";
import { useState } from "react";

import { api } from "../api/client";
import type { Discovery } from "../api/types";
import { joinLink, serverCandidates } from "./connect";

function ConnectContent({ pin }: { pin: string }) {
  const discovery = useQuery({ queryKey: ["discovery"], queryFn: () => api<Discovery>("/discovery", { auth: false }) });
  const candidates = serverCandidates(window.location, discovery.data);
  const [choice, setChoice] = useState(0);
  const server = candidates[Math.min(choice, candidates.length - 1)] ?? window.location.origin;
  const link = joinLink(server, pin);
  const qr = useQuery({
    queryKey: ["qr", link],
    queryFn: () => QRCode.toDataURL(link, { margin: 1, width: 300, color: { dark: "#14100d", light: "#f3e3bf" } }),
    staleTime: Infinity,
  });

  return (
    <Stack direction={{ xs: "column", sm: "row" }} spacing={3} sx={{ alignItems: "center" }}>
      <Box
        sx={{ width: 300, height: 300, borderRadius: 2, overflow: "hidden", bgcolor: "#f3e3bf", flexShrink: 0 }}
        data-testid="join-qr"
      >
        {qr.data && <img src={qr.data} alt={`QR code para entrar na mesa ${pin}`} width={300} height={300} />}
      </Box>
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
      </Stack>
    </Stack>
  );
}

export function ConnectDialog({ open, pin, onClose }: { open: boolean; pin: string; onClose: () => void }) {
  return (
    <Dialog open={open} onClose={onClose} maxWidth="md">
      <DialogTitle>Conectar celulares</DialogTitle>
      <DialogContent>
        <ConnectContent pin={pin} />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Fechar</Button>
      </DialogActions>
    </Dialog>
  );
}
