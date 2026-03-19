import { Box } from '@mui/material';

interface GregoJuiceLogoProps {
  height?: number;
}

export function GregoJuiceLogo({ height = 48 }: GregoJuiceLogoProps) {
  return (
    <Box
      sx={{
        display: 'inline-flex',
        alignItems: 'baseline',
        fontSize: `${height}px`,
        lineHeight: 1,
      }}
    >
      {/* GREGO in Martel - GRE normal, GO italic */}
      <Box
        component="span"
        sx={{
          fontFamily: 'Martel, serif',
          fontWeight: 300,
          color: '#D4FF28',
          letterSpacing: '0.02em',
        }}
      >
        <Box component="span" sx={{ fontStyle: 'normal' }}>
          GRE
        </Box>
        <Box component="span" sx={{ fontStyle: 'italic' }}>
          GO&nbsp;
        </Box>
      </Box>

      {/* JUICE in Workbench */}
      <Box
        component="span"
        sx={{
          fontFamily: 'Workbench, monospace',
          fontWeight: 400,
          fontStyle: 'normal',
          color: '#9d4d87',
          letterSpacing: '0.05em',
        }}
      >
        JUICE
      </Box>
    </Box>
  );
}
