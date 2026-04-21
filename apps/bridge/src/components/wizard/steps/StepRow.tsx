import type React from "react";
import { Box, Typography, Collapse, CircularProgress } from "@mui/material";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import RadioButtonUncheckedIcon from "@mui/icons-material/RadioButtonUnchecked";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";

export type StepStatus = "completed" | "active" | "pending";

function StepIcon({ status }: { status: StepStatus }) {
  if (status === "completed")
    return <CheckCircleIcon sx={{ color: "primary.main", fontSize: 24 }} />;
  if (status === "active") return <CircularProgress size={20} sx={{ color: "primary.main" }} />;
  return <RadioButtonUncheckedIcon sx={{ color: "text.disabled", fontSize: 24 }} />;
}

export function StepRow({
  label,
  description,
  status,
  expanded,
  onToggle,
  children,
  testId,
}: {
  label: string;
  description: string;
  status: StepStatus;
  expanded: boolean;
  onToggle: () => void;
  children?: React.ReactNode;
  testId?: string;
}) {
  const hasContent = !!children;
  return (
    <Box
      data-testid={testId}
      data-status={status}
      sx={{
        opacity: status === "pending" ? 0.4 : 1,
        transition: "opacity 0.3s",
      }}
    >
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1.5,
          py: 1,
          px: 0.5,
          cursor: hasContent && status !== "pending" ? "pointer" : "default",
          "&:hover":
            hasContent && status !== "pending"
              ? { backgroundColor: "rgba(212,255,40,0.02)" }
              : undefined,
        }}
        onClick={hasContent && status !== "pending" ? onToggle : undefined}
      >
        <StepIcon status={status} />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="body2" sx={{ fontWeight: status === "active" ? 600 : 400 }}>
            {label}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {description}
          </Typography>
        </Box>
        {hasContent &&
          status !== "pending" &&
          (expanded ? (
            <ExpandLessIcon sx={{ fontSize: 18, color: "text.secondary" }} />
          ) : (
            <ExpandMoreIcon sx={{ fontSize: 18, color: "text.secondary" }} />
          ))}
      </Box>
      {hasContent && (
        <Collapse in={expanded && status !== "pending"}>
          <Box sx={{ pl: 5, pr: 5, pb: 2 }}>{children}</Box>
        </Collapse>
      )}
    </Box>
  );
}
