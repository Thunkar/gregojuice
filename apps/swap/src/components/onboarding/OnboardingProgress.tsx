/**
 * OnboardingProgress Component
 * Displays the progress bar and step list for onboarding
 */

import {
  Box,
  Typography,
  LinearProgress,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  CircularProgress,
  Collapse,
} from "@mui/material";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import RadioButtonUncheckedIcon from "@mui/icons-material/RadioButtonUnchecked";
import ErrorIcon from "@mui/icons-material/Error";
import type { OnboardingStep, OnboardingStatus } from "../../contexts/onboarding";

interface OnboardingProgressProps {
  currentStep: number;
  totalSteps: number;
  steps: OnboardingStep[];
  status: OnboardingStatus;
  isLoading: boolean;
}

export function OnboardingProgress({
  currentStep,
  totalSteps,
  steps,
  status,
  isLoading,
}: OnboardingProgressProps) {
  const isComplete = status === "completed";
  const progress = isComplete ? 100 : ((currentStep - 0.5) / totalSteps) * 100;

  const getStepStatus = (stepIndex: number): "completed" | "active" | "pending" | "error" => {
    if (status === "error" && stepIndex === currentStep) return "error";
    if (stepIndex < currentStep) return "completed";
    if (stepIndex === currentStep) return "active";
    return "pending";
  };

  return (
    <>
      {/* Progress Bar */}
      <Box sx={{ mb: 3 }}>
        <Box sx={{ display: "flex", justifyContent: "space-between", mb: 1 }}>
          <Typography variant="caption" color="text.secondary">
            Step {currentStep} of {totalSteps}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {Math.round(progress)}%
          </Typography>
        </Box>
        <LinearProgress
          variant="determinate"
          value={progress}
          sx={{
            height: 8,
            borderRadius: 4,
            backgroundColor: "rgba(212, 255, 40, 0.1)",
            "& .MuiLinearProgress-bar": {
              backgroundColor: "primary.main",
              borderRadius: 4,
            },
          }}
        />
      </Box>

      {/* Steps List */}
      <List sx={{ py: 0 }}>
        {steps.map((step, index) => {
          const stepNum = index + 1;
          const stepStatus = getStepStatus(stepNum);
          const isActive = stepStatus === "active";
          const isCompleted = stepStatus === "completed";
          const isError = stepStatus === "error";

          // First step always visible, remaining steps animate in
          const shouldAnimate = index > 0;

          const stepContent = (
            <ListItem
              sx={{
                py: 2,
                px: 0,
                opacity: stepStatus === "pending" ? 0.5 : 1,
                transition: "opacity 0.3s",
              }}
            >
              <ListItemIcon sx={{ minWidth: 40 }}>
                {isError ? (
                  <ErrorIcon sx={{ color: "error.main", fontSize: 28 }} />
                ) : isCompleted ? (
                  <CheckCircleIcon sx={{ color: "primary.main", fontSize: 28 }} />
                ) : isActive && isLoading ? (
                  <CircularProgress size={24} sx={{ color: "primary.main" }} />
                ) : (
                  <RadioButtonUncheckedIcon sx={{ color: "text.disabled", fontSize: 28 }} />
                )}
              </ListItemIcon>
              <ListItemText
                primary={
                  <Typography
                    variant="body1"
                    sx={{
                      fontWeight: isActive || isError ? 600 : 400,
                      color: isError ? "error.main" : isActive ? "text.primary" : "text.secondary",
                    }}
                  >
                    {step.label}
                  </Typography>
                }
                secondary={
                  <Typography variant="caption" color={isError ? "error.main" : "text.secondary"}>
                    {step.description}
                  </Typography>
                }
              />
            </ListItem>
          );

          if (shouldAnimate) {
            return (
              <Collapse key={step.label} in={status !== "connecting"} timeout={400}>
                {stepContent}
              </Collapse>
            );
          }

          return <Box key={step.label}>{stepContent}</Box>;
        })}
      </List>
    </>
  );
}
