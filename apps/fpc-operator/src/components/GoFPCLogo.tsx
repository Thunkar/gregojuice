import { Box } from "@mui/material";

interface GoFPCLogoProps {
  height?: number;
}

export function GoFPCLogo({ height = 48 }: GoFPCLogoProps) {
  return (
    <Box
      sx={{
        display: "inline-flex",
        alignItems: "baseline",
        fontSize: `${height}px`,
        lineHeight: 1,
      }}
    >
      {/* GO in Martel italic */}
      <Box
        component="span"
        sx={{
          fontFamily: "Martel, serif",
          fontWeight: 300,
          fontStyle: "italic",
          color: "#D4FF28",
          letterSpacing: "0.02em",
        }}
      >
        GO&nbsp;
      </Box>

      {/* FPC in Workbench */}
      <Box
        component="span"
        sx={{
          fontFamily: "Workbench, monospace",
          fontWeight: 400,
          fontStyle: "normal",
          color: "#9d4d87",
          letterSpacing: "0.05em",
        }}
      >
        FPC
      </Box>
    </Box>
  );
}
