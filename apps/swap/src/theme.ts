import { createTheme } from "@mui/material/styles";

// Aztec-inspired dark mode color palette
export const theme = createTheme({
  palette: {
    mode: "dark",
    primary: {
      main: "#D4FF28", // Chartreuse green
      light: "#deff5c",
      dark: "#94b21c",
      contrastText: "#00122E",
    },
    secondary: {
      main: "#80336A", // Deep purple/oxblood
      light: "#9d4d87",
      dark: "#5a2449",
      contrastText: "#F2EEE1",
    },
    background: {
      default: "#000000", // Pure black
      paper: "rgba(18, 18, 28, 0.85)", // Dark blue-black with transparency
    },
    text: {
      primary: "#F2EEE1", // Light parchment
      secondary: "#D4FF28", // Chartreuse for accents
    },
    divider: "rgba(212, 255, 40, 0.15)",
  },
  typography: {
    fontFamily:
      '"Geist", -apple-system, BlinkMacSystemFont, "Segoe UI", "Helvetica", "Arial", sans-serif',
    h1: {
      fontWeight: 700,
      fontSize: "2.5rem",
      letterSpacing: "-0.02em",
    },
    h2: {
      fontWeight: 700,
      fontSize: "2rem",
      letterSpacing: "-0.01em",
    },
    h3: {
      fontWeight: 600,
      fontSize: "1.75rem",
      letterSpacing: "-0.01em",
    },
    h4: {
      fontWeight: 600,
      fontSize: "1.5rem",
    },
    h5: {
      fontWeight: 500,
      fontSize: "1.25rem",
    },
    h6: {
      fontWeight: 500,
      fontSize: "1rem",
    },
    body1: {
      fontSize: "1rem",
      lineHeight: 1.6,
      fontWeight: 400,
    },
    body2: {
      fontSize: "0.875rem",
      lineHeight: 1.5,
      fontWeight: 400,
    },
    button: {
      textTransform: "none",
      fontWeight: 600,
    },
  },
  shape: {
    borderRadius: 0,
  },
  shadows: [
    "none",
    "0px 2px 4px rgba(0, 18, 46, 0.04)",
    "0px 4px 8px rgba(0, 18, 46, 0.06)",
    "0px 8px 16px rgba(0, 18, 46, 0.08)",
    "0px 12px 24px rgba(0, 18, 46, 0.1)",
    "0px 16px 32px rgba(0, 18, 46, 0.12)",
    "0px 20px 40px rgba(0, 18, 46, 0.14)",
    "0px 24px 48px rgba(0, 18, 46, 0.16)",
    "0px 28px 56px rgba(0, 18, 46, 0.18)",
    "0px 32px 64px rgba(0, 18, 46, 0.2)",
    "0px 36px 72px rgba(0, 18, 46, 0.22)",
    "0px 40px 80px rgba(0, 18, 46, 0.24)",
    "0px 44px 88px rgba(0, 18, 46, 0.26)",
    "0px 48px 96px rgba(0, 18, 46, 0.28)",
    "0px 52px 104px rgba(0, 18, 46, 0.3)",
    "0px 56px 112px rgba(0, 18, 46, 0.32)",
    "0px 60px 120px rgba(0, 18, 46, 0.34)",
    "0px 64px 128px rgba(0, 18, 46, 0.36)",
    "0px 68px 136px rgba(0, 18, 46, 0.38)",
    "0px 72px 144px rgba(0, 18, 46, 0.4)",
    "0px 76px 152px rgba(0, 18, 46, 0.42)",
    "0px 80px 160px rgba(0, 18, 46, 0.44)",
    "0px 84px 168px rgba(0, 18, 46, 0.46)",
    "0px 88px 176px rgba(0, 18, 46, 0.48)",
    "0px 92px 184px rgba(0, 18, 46, 0.5)",
  ],
  components: {
    MuiButton: {
      styleOverrides: {
        root: {
          borderRadius: 0,
          padding: "12px 24px",
          fontSize: "1rem",
          fontWeight: 600,
        },
        contained: {
          boxShadow: "none",
          "&:hover": {
            boxShadow: "0px 4px 12px rgba(212, 255, 40, 0.4)",
          },
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundImage: "none",
          backdropFilter: "blur(20px)",
          backgroundColor: "rgba(18, 18, 28, 0.85)",
          border: "1px solid rgba(212, 255, 40, 0.1)",
          borderRadius: 0,
        },
      },
    },
    MuiTextField: {
      styleOverrides: {
        root: {
          "& .MuiOutlinedInput-root": {
            borderRadius: 0,
          },
        },
      },
    },
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          backgroundColor: "#000000",
        },
      },
    },
  },
});
