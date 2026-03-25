import { Box, Typography, MenuItem, TextField } from "@mui/material";
import type { ContractArtifact, FunctionAbi } from "@aztec/aztec.js/abi";

interface FunctionSelectorProps {
  artifact: ContractArtifact;
  selectedFunction: FunctionAbi | null;
  onSelect: (fn: FunctionAbi) => void;
}

function getSponsorableFunctions(artifact: ContractArtifact): FunctionAbi[] {
  return artifact.functions.filter(
    (f) =>
      (f.functionType === "private" || f.functionType === "public") &&
      !f.isInternal &&
      f.name !== "constructor" &&
      !f.name.startsWith("_"),
  );
}

function formatParams(fn: FunctionAbi): string {
  return fn.parameters.map((p) => `${p.name}: ${formatType(p.type)}`).join(", ");
}

function formatType(type: { kind: string; [key: string]: unknown }): string {
  switch (type.kind) {
    case "field":
      return "Field";
    case "boolean":
      return "bool";
    case "integer":
      return `${(type as { sign: string }).sign === "unsigned" ? "u" : "i"}${(type as { width: number }).width}`;
    case "struct":
      return (type as { path: string }).path?.split("::").pop() ?? "struct";
    case "array":
      return `[${formatType((type as { type: { kind: string } }).type)}; ${(type as { length: number }).length}]`;
    default:
      return type.kind;
  }
}

export function FunctionSelector({ artifact, selectedFunction, onSelect }: FunctionSelectorProps) {
  const functions = getSponsorableFunctions(artifact);

  if (functions.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        No sponsorable functions found in this artifact.
      </Typography>
    );
  }

  return (
    <Box>
      <TextField
        select
        fullWidth
        label="Function to Sponsor"
        value={selectedFunction?.name ?? ""}
        onChange={(e) => {
          const fn = functions.find((f) => f.name === e.target.value);
          if (fn) onSelect(fn);
        }}
        size="small"
        sx={{ mb: 1 }}
      >
        {functions.map((fn) => (
          <MenuItem key={fn.name} value={fn.name}>
            <Box>
              <Typography variant="body2" fontWeight={600}>
                {fn.name}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {fn.functionType} · {formatParams(fn)}
              </Typography>
            </Box>
          </MenuItem>
        ))}
      </TextField>
    </Box>
  );
}
