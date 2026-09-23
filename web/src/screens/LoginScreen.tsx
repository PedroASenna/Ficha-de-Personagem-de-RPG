import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useMutation, useQuery } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";

import { api } from "../api/client";
import type { Discovery, Tokens, User } from "../api/types";
import { useSession } from "../auth/session";

export function LoginScreen() {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const { setTokens, setUser } = useSession.getState();

  const server = useQuery({ queryKey: ["discovery"], queryFn: () => api<Discovery>("/discovery", { auth: false }) });

  const submit = useMutation({
    mutationFn: async () => {
      const tokens =
        mode === "login"
          ? await api<Tokens>("/auth/login", { json: { username, password }, auth: false })
          : await api<Tokens>("/auth/register", {
              json: { username, password, display_name: displayName || username },
              auth: false,
            });
      setTokens(tokens);
      setUser(await api<User>("/me"));
    },
  });

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    submit.mutate();
  };

  const registrationOpen = server.data?.registration_open ?? true;

  return (
    <Box
      sx={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        p: 2,
        background: "radial-gradient(circle at 50% 20%, #2b2119 0%, #14100d 60%)",
      }}
    >
      <Paper elevation={8} sx={{ width: "100%", maxWidth: 420, p: 4 }}>
        <Stack spacing={1} sx={{ alignItems: "center", mb: 2 }}>
          <Box component="img" src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" sx={{ width: 56, height: 56 }} />
          <Typography variant="h4">RPG Play</Typography>
          <Typography color="text.secondary">Painel do Mestre{server.data ? ` · ${server.data.name}` : ""}</Typography>
        </Stack>
        <Tabs
          value={mode}
          onChange={(_, value: "login" | "register") => setMode(value)}
          variant="fullWidth"
          sx={{ mb: 2 }}
        >
          <Tab value="login" label="Entrar" />
          <Tab value="register" label="Criar conta" disabled={!registrationOpen} />
        </Tabs>
        <Stack component="form" spacing={2} onSubmit={onSubmit}>
          <TextField
            label="Usuário"
            value={username}
            onChange={(e) => setUsername(e.target.value.toLowerCase())}
            autoComplete="username"
            autoFocus
            required
            helperText={mode === "register" ? "3 a 32 letras minúsculas, números, ponto, hífen ou _" : undefined}
          />
          {mode === "register" && (
            <TextField
              label="Nome que aparece na mesa"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Mestre Pedro"
            />
          )}
          <TextField
            label="Senha"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            required
            helperText={mode === "register" ? "Mínimo de 8 caracteres" : undefined}
          />
          {submit.error && <Alert severity="error">{submit.error.message}</Alert>}
          {server.isError && (
            <Alert severity="warning">Não consegui falar com o servidor. Ele está ligado e na mesma rede?</Alert>
          )}
          <Button type="submit" variant="contained" size="large" loading={submit.isPending}>
            {mode === "login" ? "Entrar" : "Criar conta e entrar"}
          </Button>
          {mode === "register" && (
            <Typography variant="body2" color="text.secondary">
              A primeira conta criada no servidor vira a conta de administrador (pode redefinir senhas).
            </Typography>
          )}
          {!registrationOpen && (
            <Typography variant="body2" color="text.secondary">
              O cadastro está fechado neste servidor. Peça para o administrador liberar.
            </Typography>
          )}
        </Stack>
        {server.data && (
          <Typography variant="caption" color="text.disabled" sx={{ display: "block", mt: 3, textAlign: "center" }}>
            Servidor v{server.data.version}
          </Typography>
        )}
      </Paper>
    </Box>
  );
}
