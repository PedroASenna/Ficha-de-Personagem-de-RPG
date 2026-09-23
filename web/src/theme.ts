import { createTheme } from "@mui/material/styles";

const serif = '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif';

/** Tema escuro de taverna: fundo de madeira, dourado de destaque. Sem fontes externas (funciona sem internet). */
export const theme = createTheme({
  palette: {
    mode: "dark",
    primary: { main: "#d4a64a", contrastText: "#1b140c" },
    secondary: { main: "#4fb3a9" },
    error: { main: "#e0584a" },
    warning: { main: "#e3a13b" },
    success: { main: "#62c370" },
    background: { default: "#14100d", paper: "#1f1915" },
    divider: "rgba(212, 166, 74, 0.16)",
  },
  shape: { borderRadius: 10 },
  typography: {
    fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, Ubuntu, sans-serif',
    h4: { fontFamily: serif, fontWeight: 700 },
    h5: { fontFamily: serif, fontWeight: 700 },
    h6: { fontFamily: serif, fontWeight: 700 },
    button: { textTransform: "none", fontWeight: 600 },
  },
  components: {
    MuiPaper: { styleOverrides: { root: { backgroundImage: "none" } } },
    MuiTooltip: { defaultProps: { arrow: true } },
  },
});
