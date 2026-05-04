import { Box } from "@mui/material";

interface GoJuiceLogoProps {
  height?: number;
}

export function GoJuiceLogo({ height = 48 }: GoJuiceLogoProps) {
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

      {/* JUICE in Workbench */}
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
        JUICE
      </Box>
    </Box>
  );
}
