import { useState, useEffect } from "react";
import { Box, TextField, Typography } from "@mui/material";
import type { FunctionAbi, AbiType } from "@aztec/aztec.js/abi";

interface FunctionArgsFormProps {
  fn: FunctionAbi;
  values: string[];
  onChange: (values: string[]) => void;
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
      const path = (type as { path?: string }).path ?? "";
      if (path.includes("AztecAddress")) return "0x" + "0".repeat(64);
      return "0";
    }
    case "array": {
      const inner = (type as { type: AbiType; length: number });
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

export function FunctionArgsForm({ fn, values, onChange }: FunctionArgsFormProps) {
  const params = fn.parameters;

  if (params.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        This function takes no arguments.
      </Typography>
    );
  }

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
      {params.map((param, i) => (
        <TextField
          key={param.name}
          fullWidth
          label={`${param.name} (${typeLabel(param.type)})`}
          value={values[i] ?? ""}
          onChange={(e) => {
            const updated = [...values];
            updated[i] = e.target.value;
            onChange(updated);
          }}
          size="small"
        />
      ))}
    </Box>
  );
}

/** Generate default arg values for a function's parameters */
export function getDefaultArgs(fn: FunctionAbi): string[] {
  return fn.parameters.map((p) => defaultForType(p.type));
}
