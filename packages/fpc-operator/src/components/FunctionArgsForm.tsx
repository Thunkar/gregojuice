import { Box, TextField, Typography, Button, InputAdornment } from "@mui/material";
import PersonIcon from "@mui/icons-material/Person";
import type { FunctionAbi, AbiType } from "@aztec/aztec.js/abi";
import { shortAddress } from "@gregojuice/common";

interface FunctionArgsFormProps {
  fn: FunctionAbi;
  values: string[];
  onChange: (values: string[]) => void;
  adminAddress?: string;
}

function isAddressType(type: AbiType): boolean {
  if (type.kind !== "struct") return false;
  const path = (type as { path?: string }).path ?? "";
  return path.includes("AztecAddress");
}

function defaultForType(type: AbiType): string {
  switch (type.kind) {
    case "field":
      return "0";
    case "boolean":
      return "false";
    case "integer":
      return "0";
    case "struct": {
      if (isAddressType(type)) return "0x" + "0".repeat(64);
      return "0";
    }
    case "array": {
      const inner = type as { type: AbiType; length: number };
      const items = Array.from({ length: inner.length }, () => defaultForType(inner.type));
      return JSON.stringify(items);
    }
    default:
      return "0";
  }
}

function typeLabel(type: AbiType): string {
  switch (type.kind) {
    case "field":
      return "Field";
    case "boolean":
      return "bool";
    case "integer": {
      const t = type as { sign: string; width: number };
      return `${t.sign === "unsigned" ? "u" : "i"}${t.width}`;
    }
    case "struct": {
      const path = (type as { path?: string }).path ?? "";
      return path.split("::").pop() ?? "struct";
    }
    case "array": {
      const t = type as { type: AbiType; length: number };
      return `[${typeLabel(t.type)}; ${t.length}]`;
    }
    default:
      return type.kind;
  }
}

export function FunctionArgsForm({ fn, values, onChange, adminAddress }: FunctionArgsFormProps) {
  const params = fn.parameters;

  if (params.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        This function takes no arguments.
      </Typography>
    );
  }

  const updateValue = (i: number, value: string) => {
    const updated = [...values];
    updated[i] = value;
    onChange(updated);
  };

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
      {params.map((param, i) => {
        const isAddr = isAddressType(param.type);
        return (
          <TextField
            key={param.name}
            fullWidth
            label={`${param.name} (${typeLabel(param.type)})`}
            value={values[i] ?? ""}
            onChange={(e) => updateValue(i, e.target.value)}
            size="small"
            slotProps={isAddr && adminAddress ? {
              input: {
                endAdornment: (
                  <InputAdornment position="end">
                    <Button
                      size="small"
                      startIcon={<PersonIcon sx={{ fontSize: 14 }} />}
                      onClick={() => updateValue(i, adminAddress)}
                      sx={{ fontSize: "0.65rem", minWidth: "auto", whiteSpace: "nowrap" }}
                    >
                      {shortAddress(adminAddress)}
                    </Button>
                  </InputAdornment>
                ),
              },
            } : undefined}
          />
        );
      })}
    </Box>
  );
}

/** Generate default arg values for a function's parameters */
export function getDefaultArgs(fn: FunctionAbi): string[] {
  return fn.parameters.map((p) => defaultForType(p.type));
}
