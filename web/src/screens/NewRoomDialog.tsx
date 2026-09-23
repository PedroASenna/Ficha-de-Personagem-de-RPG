import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";

import { api } from "../api/client";
import type { Room, Ruleset } from "../api/types";
import { useRouter } from "../router";

function NewRoomForm({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState("");
  const [rulesetId, setRulesetId] = useState("");
  const [maxPlayers, setMaxPlayers] = useState(6);
  const navigate = useRouter((s) => s.navigate);
  const queryClient = useQueryClient();
  const rulesets = useQuery({ queryKey: ["rulesets"], queryFn: () => api<Ruleset[]>("/rulesets", { auth: false }) });
  const available = (rulesets.data ?? []).filter((r) => r.status === "available");
  const selected = available.find((r) => r.id === (rulesetId || available[0]?.id));

  const create = useMutation({
    mutationFn: () =>
      api<Room>("/rooms", { json: { name: name.trim(), ruleset_id: selected?.id, max_players: maxPlayers } }),
    onSuccess: async (room) => {
      await queryClient.invalidateQueries({ queryKey: ["rooms"] });
      onClose();
      navigate({ name: "table", roomId: room.id });
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    create.mutate();
  };

  return (
    <form onSubmit={submit}>
      <DialogTitle>Nova mesa</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <TextField
            label="Nome da campanha"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            autoFocus
            slotProps={{ htmlInput: { maxLength: 60 } }}
          />
          <TextField
            select
            label="Sistema de regras"
            value={selected?.id ?? ""}
            onChange={(e) => setRulesetId(e.target.value)}
            helperText="Fica fixo durante toda a campanha (fichas, dados e críticos seguem estas regras)."
          >
            {available.map((r) => (
              <MenuItem key={r.id} value={r.id}>
                {r.name}
              </MenuItem>
            ))}
          </TextField>
          {selected && (
            <Typography variant="body2" color="text.secondary">
              {selected.description}
            </Typography>
          )}
          <TextField
            label="Máximo de jogadores"
            type="number"
            value={maxPlayers}
            onChange={(e) => setMaxPlayers(Number(e.target.value))}
            slotProps={{ htmlInput: { min: 1, max: 12 } }}
          />
          {create.error && <Alert severity="error">{create.error.message}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancelar</Button>
        <Button type="submit" variant="contained" disabled={!name.trim() || !selected} loading={create.isPending}>
          Criar e abrir
        </Button>
      </DialogActions>
    </form>
  );
}

export function NewRoomDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <NewRoomForm onClose={onClose} />
    </Dialog>
  );
}
