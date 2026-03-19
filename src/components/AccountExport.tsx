import { Box, Typography, IconButton, Tooltip } from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { useState } from 'react';
import { useAztecWallet } from '../contexts/AztecWalletContext';

function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
      <Typography variant="caption" color="text.secondary" sx={{ minWidth: 80, fontWeight: 500 }}>
        {label}
      </Typography>
      <Typography
        variant="caption"
        sx={{ fontFamily: 'monospace', fontSize: '0.7rem', flex: 1, wordBreak: 'break-all' }}
      >
        {value}
      </Typography>
      <Tooltip title={copied ? 'Copied!' : 'Copy'}>
        <IconButton size="small" onClick={handleCopy} sx={{ color: 'primary.main', p: 0.25 }}>
          <ContentCopyIcon sx={{ fontSize: 14 }} />
        </IconButton>
      </Tooltip>
    </Box>
  );
}

export function AccountExport() {
  const { credentials } = useAztecWallet();
  const [allCopied, setAllCopied] = useState(false);

  if (!credentials) return null;

  const copyAll = async () => {
    const text = `Aztec Account Credentials
Address: ${credentials.address}
Secret Key: ${credentials.secretKey}
Salt: ${credentials.salt}
Signing Key: ${credentials.signingKey}`;
    await navigator.clipboard.writeText(text);
    setAllCopied(true);
    setTimeout(() => setAllCopied(false), 2000);
  };

  return (
    <Box
      sx={{
        backgroundColor: 'rgba(0, 0, 0, 0.3)',
        border: '1px solid rgba(212, 255, 40, 0.1)',
        p: 1.5,
      }}
    >
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
        <Typography variant="body2" color="text.secondary" fontWeight={600} fontSize="0.8rem">
          Account Credentials (save these!)
        </Typography>
        <Tooltip title={allCopied ? 'Copied!' : 'Copy all'}>
          <IconButton size="small" onClick={copyAll} sx={{ color: 'primary.main', p: 0.25 }}>
            <ContentCopyIcon sx={{ fontSize: 14 }} />
          </IconButton>
        </Tooltip>
      </Box>
      <CopyRow label="Address" value={credentials.address} />
      <CopyRow label="Secret Key" value={credentials.secretKey} />
      <CopyRow label="Salt" value={credentials.salt} />
      <CopyRow label="Signing Key" value={credentials.signingKey} />
    </Box>
  );
}
