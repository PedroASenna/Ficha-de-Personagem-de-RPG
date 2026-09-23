import Alert from "@mui/material/Alert";
import Snackbar from "@mui/material/Snackbar";
import { useQuery } from "@tanstack/react-query";

import { api } from "./api/client";
import type { User } from "./api/types";
import { useSession } from "./auth/session";
import { useRouter } from "./router";
import { LoginScreen } from "./screens/LoginScreen";
import { RoomsScreen } from "./screens/RoomsScreen";
import { TableScreen } from "./table/TableScreen";
import { useToasts } from "./toasts";

function Toaster() {
  const current = useToasts((s) => s.current);
  const dismiss = useToasts((s) => s.dismiss);
  return (
    <Snackbar
      key={current?.id}
      open={current !== null}
      autoHideDuration={current?.severity === "error" ? 6000 : 3500}
      onClose={(_, reason) => reason !== "clickaway" && dismiss()}
      anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
    >
      <Alert severity={current?.severity ?? "info"} variant="filled" onClose={dismiss} sx={{ minWidth: 280 }}>
        {current?.message}
      </Alert>
    </Snackbar>
  );
}

function Authenticated() {
  const route = useRouter((s) => s.route);
  const setUser = useSession((s) => s.setUser);
  // Confere a sessão guardada (e atualiza nome/admin) ao abrir o painel.
  useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      const me = await api<User>("/me");
      setUser(me);
      return me;
    },
  });
  return route.name === "table" ? <TableScreen roomId={route.roomId} /> : <RoomsScreen />;
}

export function App() {
  const loggedIn = useSession((s) => s.access !== null);
  return (
    <>
      {loggedIn ? <Authenticated /> : <LoginScreen />}
      <Toaster />
    </>
  );
}
