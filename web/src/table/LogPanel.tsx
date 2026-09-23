import CasinoIcon from "@mui/icons-material/Casino";
import FavoriteIcon from "@mui/icons-material/Favorite";
import LockIcon from "@mui/icons-material/LockOutlined";
import LoginIcon from "@mui/icons-material/Login";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import FormControlLabel from "@mui/material/FormControlLabel";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { keyframes } from "@mui/material/styles";
import { type FormEvent, useEffect, useRef, useState } from "react";

import { toast } from "../toasts";
import type { LogEntry } from "./reducer";
import { TIER_COLOR } from "./rules";
import { newRequestId, useTable } from "./store";

const QUICK_DICE = [4, 6, 8, 10, 12, 20, 100];

const pop = keyframes`
  0% { transform: scale(0.4) rotate(-12deg); opacity: 0; }
  60% { transform: scale(1.15) rotate(3deg); opacity: 1; }
  100% { transform: scale(1) rotate(0); opacity: 1; }
`;

function EntryIcon({ entry }: { entry: LogEntry }) {
  const sx = { fontSize: 16, mt: "2px", color: entry.tier ? TIER_COLOR[entry.tier] : "text.secondary" };
  if (entry.kind === "roll") return <CasinoIcon sx={sx} />;
  if (entry.kind === "hp") return <FavoriteIcon sx={{ ...sx, color: "error.main" }} />;
  return <LoginIcon sx={sx} />;
}

function LastRoll() {
  const last = useTable((s) => s.lastRoll);
  if (!last || last.total === undefined) return null;
  const color = last.tier ? TIER_COLOR[last.tier] : "text.primary";
  return (
    <Stack
      key={last.id}
      direction="row"
      spacing={1.5}
      sx={{ alignItems: "center", px: 1.5, py: 1, borderBottom: 1, borderColor: "divider" }}
    >
      <Typography
        variant="h4"
        data-testid="last-roll-total"
        sx={{
          color,
          minWidth: 56,
          textAlign: "center",
          animation: `${pop} 420ms ease-out`,
          textShadow: `0 0 18px ${color}`,
        }}
      >
        {last.total}
      </Typography>
      <Typography variant="body2" sx={{ flex: 1 }}>
        {last.text}
      </Typography>
      {last.secret && (
        <Tooltip title="Rolagem secreta: só você viu">
          <LockIcon fontSize="small" color="primary" />
        </Tooltip>
      )}
    </Stack>
  );
}

function DiceRoller() {
  const [notation, setNotation] = useState("");
  const [secret, setSecret] = useState(false);
  const send = useTable((s) => s.send);
  const roll = (text: string) => {
    if (!text.trim()) return;
    const ok = send({
      type: "roll.request",
      id: newRequestId(),
      notation: text.trim(),
      visibility: secret ? "master_only" : "public",
    });
    if (!ok) toast.error("Sem conexão com a mesa.");
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    roll(notation);
  };
  return (
    <Box sx={{ p: 1, borderTop: 1, borderColor: "divider" }}>
      <Stack direction="row" spacing={0.5} sx={{ mb: 1, flexWrap: "wrap" }} useFlexGap>
        {QUICK_DICE.map((sides) => (
          <Button
            key={sides}
            size="small"
            variant="outlined"
            sx={{ minWidth: 0, px: 1 }}
            onClick={() => roll(`1d${sides}`)}
          >
            d{sides}
          </Button>
        ))}
      </Stack>
      <Stack component="form" onSubmit={submit} direction="row" spacing={1} sx={{ alignItems: "center" }}>
        <TextField
          size="small"
          placeholder="2d6+3, 4d6kh3, 1d20+5…"
          value={notation}
          onChange={(e) => setNotation(e.target.value)}
          sx={{ flex: 1 }}
          slotProps={{ htmlInput: { "aria-label": "Notação dos dados" } }}
        />
        <Tooltip title={secret ? "Rolagem secreta (só você vê)" : "Rolagem aberta (todos veem)"}>
          <FormControlLabel
            sx={{ mr: 0 }}
            control={<Switch size="small" checked={secret} onChange={(e) => setSecret(e.target.checked)} />}
            label={<LockIcon fontSize="small" color={secret ? "primary" : "disabled"} />}
          />
        </Tooltip>
        <Button type="submit" variant="contained" disabled={!notation.trim()}>
          Rolar
        </Button>
      </Stack>
    </Box>
  );
}

export function LogPanel() {
  const log = useTable((s) => s.log);
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [log.length]);

  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <Typography variant="overline" color="text.secondary" sx={{ px: 1.5, pt: 0.5 }}>
        Log da sessão
      </Typography>
      <LastRoll />
      <Box sx={{ flex: 1, overflowY: "auto", px: 1.5, py: 0.5 }} data-testid="session-log">
        {log.map((entry) => (
          <Stack key={entry.id} direction="row" spacing={1} sx={{ py: 0.4, opacity: entry.secret ? 0.85 : 1 }}>
            <Typography variant="caption" color="text.disabled" sx={{ mt: "2px", fontVariantNumeric: "tabular-nums" }}>
              {new Date(entry.ts).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
            </Typography>
            <EntryIcon entry={entry} />
            <Typography variant="body2" sx={{ flex: 1 }}>
              {entry.text}
            </Typography>
            {entry.secret && <LockIcon sx={{ fontSize: 14, mt: "3px" }} color="primary" titleAccess="Secreto" />}
          </Stack>
        ))}
        <div ref={endRef} />
      </Box>
      <DiceRoller />
    </Box>
  );
}
