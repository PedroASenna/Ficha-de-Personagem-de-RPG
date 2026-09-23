import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemText from "@mui/material/ListItemText";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useMutation, useQuery } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";

import { api } from "../api/client";
import type { User } from "../api/types";
import { toast } from "../toasts";

function PasswordForm({ onClose }: { onClose: () => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const change = useMutation({
    mutationFn: () => api("/auth/password", { json: { current_password: current, new_password: next } }),
    onSuccess: () => {
      toast.success("Senha trocada.");
      onClose();
    },
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    change.mutate();
  };
  return (
    <form onSubmit={submit}>
      <DialogTitle>Trocar minha senha</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <TextField
            label="Senha atual"
            type="password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            autoComplete="current-password"
            required
          />
          <TextField
            label="Senha nova"
            type="password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            autoComplete="new-password"
            helperText="Mínimo de 8 caracteres"
            required
          />
          {change.error && <Alert severity="error">{change.error.message}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancelar</Button>
        <Button type="submit" variant="contained" loading={change.isPending} disabled={next.length < 8}>
          Salvar
        </Button>
      </DialogActions>
    </form>
  );
}

export function PasswordDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <PasswordForm onClose={onClose} />
    </Dialog>
  );
}

function ResetPassword({ user }: { user: User }) {
  const [password, setPassword] = useState("");
  const reset = useMutation({
    mutationFn: () => api(`/admin/users/${user.username}/password`, { json: { new_password: password } }),
    onSuccess: () => {
      toast.success(`Senha de ${user.username} redefinida. Passe a senha nova para a pessoa.`);
      setPassword("");
    },
    onError: toast.error,
  });
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
      <TextField
        size="small"
        label="Senha nova"
        type="text"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        sx={{ width: 180 }}
      />
      <Button size="small" disabled={password.length < 8} loading={reset.isPending} onClick={() => reset.mutate()}>
        Redefinir
      </Button>
    </Stack>
  );
}

function AccountsList() {
  const users = useQuery({ queryKey: ["admin-users"], queryFn: () => api<User[]>("/admin/users") });
  return (
    <>
      <Typography variant="body2" color="text.secondary">
        Sem e-mail para recuperar senha: quem esquecer pede para você definir uma nova aqui. As sessões antigas da
        pessoa são encerradas.
      </Typography>
      <List dense>
        {(users.data ?? []).map((user) => (
          <ListItem key={user.id} secondaryAction={<ResetPassword user={user} />} sx={{ pr: 34 }}>
            <ListItemText
              primary={`${user.display_name}${user.is_admin ? " (admin)" : ""}`}
              secondary={`@${user.username}`}
            />
          </ListItem>
        ))}
      </List>
    </>
  );
}

export function AccountsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>Contas do servidor</DialogTitle>
      <DialogContent>
        <AccountsList />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Fechar</Button>
      </DialogActions>
    </Dialog>
  );
}
