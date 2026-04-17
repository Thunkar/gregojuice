import { Box, Typography, keyframes } from "@mui/material";

const spin = keyframes`
  0% {
    transform: rotate(0deg);
  }
  100% {
    transform: rotate(360deg);
  }
`;

const flip = keyframes`
  0% {
    transform: rotateY(0deg);
  }
  50% {
    transform: rotateY(180deg);
  }
  100% {
    transform: rotateY(360deg);
  }
`;

const pulse = keyframes`
  0%, 100% {
    opacity: 0.4;
  }
  50% {
    opacity: 1;
  }
`;

const shimmer = keyframes`
  0% {
    background-position: -200% center;
  }
  100% {
    background-position: 200% center;
  }
`;

export function SwapProgress() {
  const statusText = "Swapping";
  const statusDetail = "Proving & sending transaction...";
  return (
    <Box
      sx={{
        width: "100%",
        mt: 3,
        py: 2,
        px: 3,
        borderRadius: 1,
        background: "linear-gradient(135deg, #80336A 0%, #9d4d87 100%)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 2,
        position: "relative",
        overflow: "hidden",
        "&::before": {
          content: '""',
          position: "absolute",
          inset: 0,
          background: "linear-gradient(90deg, transparent, rgba(212, 255, 40, 0.2), transparent)",
          backgroundSize: "200% 100%",
          animation: `${shimmer} 2s linear infinite`,
        },
      }}
    >
      {/* Spinning coin icon */}
      <Box
        sx={{
          position: "relative",
          width: 32,
          height: 32,
          zIndex: 1,
        }}
      >
        {/* Outer ring */}
        <Box
          sx={{
            position: "absolute",
            inset: -4,
            borderRadius: "50%",
            border: "2px solid rgba(212, 255, 40, 0.4)",
            animation: `${spin} 1.5s linear infinite`,
            borderTopColor: "transparent",
            borderRightColor: "transparent",
          }}
        />

        {/* Coin */}
        <Box
          sx={{
            width: "100%",
            height: "100%",
            borderRadius: "50%",
            background: "linear-gradient(135deg, #F2EEE1 0%, #D4FF28 100%)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            position: "relative",
            animation: `${flip} 2s ease-in-out infinite`,
            boxShadow: "0 4px 12px rgba(212, 255, 40, 0.3)",
          }}
        >
          <Typography
            variant="body2"
            sx={{
              color: "#80336A",
              fontWeight: 700,
              fontSize: "0.75rem",
            }}
          >
            GC
          </Typography>
        </Box>
      </Box>

      {/* Status text */}
      <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5, zIndex: 1, flex: 1 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
          <Typography
            variant="body1"
            sx={{
              color: "#F2EEE1",
              fontWeight: 600,
              fontSize: "1.125rem",
            }}
          >
            {statusText}
          </Typography>

          {/* Loading dots */}
          <Box
            sx={{
              display: "flex",
              gap: 0.5,
              alignItems: "center",
            }}
          >
            {[0, 1, 2].map((i) => (
              <Box
                key={i}
                sx={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  backgroundColor: "#F2EEE1",
                  animation: `${pulse} 1.5s ease-in-out infinite`,
                  animationDelay: `${i * 0.2}s`,
                }}
              />
            ))}
          </Box>
        </Box>

        {/* Detail text */}
        <Typography
          variant="caption"
          sx={{
            color: "rgba(242, 238, 225, 0.7)",
            fontSize: "0.875rem",
          }}
        >
          {statusDetail}
        </Typography>
      </Box>
    </Box>
  );
}
