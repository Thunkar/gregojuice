import {
  Box, Typography, Paper, IconButton, Tooltip, Collapse,
  CircularProgress, LinearProgress,
} from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { useState, useEffect } from 'react';
import type { ClaimCredentials as ClaimData, MessageStatus } from '../services/bridgeService';
import { pollMessageReadiness } from '../services/bridgeService';
import { useNetwork } from '../contexts/NetworkContext';
import { useAztecWallet } from '../contexts/AztecWalletContext';
import { ClaimPanel } from './ClaimPanel';
import { AccountExport } from './AccountExport';

// ── Helpers ─────────────────────────────────────────────────────────

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <Box sx={{ mb: 1 }}>
      <Typography variant="caption" color="text.secondary" fontWeight={500}>{label}</Typography>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, backgroundColor: 'rgba(0,0,0,0.3)', p: 0.75, border: '1px solid rgba(212,255,40,0.08)' }}>
        <Typography variant="body2" sx={{ fontFamily: 'monospace', wordBreak: 'break-all', flex: 1, fontSize: '0.7rem' }}>{value}</Typography>
        <Tooltip title={copied ? 'Copied!' : 'Copy'}>
          <IconButton size="small" onClick={handleCopy} sx={{ color: 'primary.main', p: 0.25 }}>
            <ContentCopyIcon sx={{ fontSize: 14 }} />
          </IconButton>
        </Tooltip>
      </Box>
    </Box>
  );
}

function StepIcon({ status }: { status: 'completed' | 'active' | 'pending' }) {
  if (status === 'completed') return <CheckCircleIcon sx={{ color: 'primary.main', fontSize: 24 }} />;
  if (status === 'active') return <CircularProgress size={20} sx={{ color: 'primary.main' }} />;
  return <RadioButtonUncheckedIcon sx={{ color: 'text.disabled', fontSize: 24 }} />;
}

// ── Step wrapper ────────────────────────────────────────────────────

interface StepRowProps {
  label: string;
  description: string;
  status: 'completed' | 'active' | 'pending';
  expanded: boolean;
  onToggle: () => void;
  children?: React.ReactNode;
}

function StepRow({ label, description, status, expanded, onToggle, children }: StepRowProps) {
  const hasContent = !!children;
  return (
    <Box sx={{ opacity: status === 'pending' ? 0.5 : 1, transition: 'opacity 0.3s' }}>
      <Box
        sx={{
          display: 'flex', alignItems: 'center', gap: 1.5, py: 1,
          cursor: hasContent ? 'pointer' : 'default',
          '&:hover': hasContent ? { backgroundColor: 'rgba(212,255,40,0.02)' } : undefined,
        }}
        onClick={hasContent ? onToggle : undefined}
      >
        <StepIcon status={status} />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="body2" sx={{ fontWeight: status === 'active' ? 600 : 400 }}>{label}</Typography>
          <Typography variant="caption" color="text.secondary">{description}</Typography>
        </Box>
        {hasContent && (
          expanded
            ? <ExpandLessIcon sx={{ fontSize: 18, color: 'text.secondary' }} />
            : <ExpandMoreIcon sx={{ fontSize: 18, color: 'text.secondary' }} />
        )}
      </Box>
      {hasContent && (
        <Collapse in={expanded}>
          <Box sx={{ pl: 5, pr: 1, pb: 1.5 }}>
            {children}
          </Box>
        </Collapse>
      )}
    </Box>
  );
}

// ── Main ────────────────────────────────────────────────────────────

export function ClaimCredentialsDisplay({ credentials, onReset }: { credentials: ClaimData; onReset: () => void }) {
  const { activeNetwork } = useNetwork();
  const { status: aztecStatus, address: aztecAddress, feeJuiceBalance } = useAztecWallet();
  const [messageStatus, setMessageStatus] = useState<MessageStatus>('pending');
  const [expandedStep, setExpandedStep] = useState<number>(1);
  const [allCopied, setAllCopied] = useState(false);

  useEffect(() => {
    const { cancel } = pollMessageReadiness(activeNetwork.aztecNodeUrl, credentials.messageHash, setMessageStatus);
    return cancel;
  }, [activeNetwork.aztecNodeUrl, credentials.messageHash]);

  const hasAztecWallet = aztecStatus !== 'disconnected' && aztecStatus !== 'error' && aztecStatus !== 'creating';
  const syncDone = messageStatus === 'ready';
  const claimDone = aztecStatus === 'deployed' && feeJuiceBalance != null && BigInt(feeJuiceBalance) > 0n;

  // Determine active step: 1=recipient, 2=bridge, 3=sync, 4=claim
  const activeStep = claimDone ? 5 : syncDone ? 4 : 2;

  // Auto-open the active step
  useEffect(() => {
    setExpandedStep(activeStep);
  }, [activeStep]);

  const toggle = (step: number) => setExpandedStep(prev => prev === step ? -1 : step);

  const copyAll = async () => {
    const text = `Recipient: ${credentials.recipient}\nAmount: ${credentials.claimAmount}\nClaim Secret: ${credentials.claimSecret}\nMessage Leaf Index: ${credentials.messageLeafIndex}`;
    await navigator.clipboard.writeText(text);
    setAllCopied(true);
    setTimeout(() => setAllCopied(false), 2000);
  };

  const totalSteps = 4;
  const currentStep = claimDone ? 4 : syncDone ? 3 : 2;
  const progress = (currentStep / totalSteps) * 100;

  const stepStatus = (num: number): 'completed' | 'active' | 'pending' => {
    if (num < activeStep) return 'completed';
    if (num === activeStep) return 'active';
    return 'pending';
  };

  return (
    <Paper sx={{ p: 3, mt: 3 }}>
      {/* Progress bar */}
      <Box sx={{ mb: 2 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
          <Typography variant="caption" color="text.secondary">Step {currentStep} of {totalSteps}</Typography>
          <Typography variant="caption" color="text.secondary">{Math.round(progress)}%</Typography>
        </Box>
        <LinearProgress
          variant="determinate"
          value={progress}
          sx={{
            height: 6, borderRadius: 3,
            backgroundColor: 'rgba(212,255,40,0.1)',
            '& .MuiLinearProgress-bar': { backgroundColor: 'primary.main', borderRadius: 3 },
          }}
        />
      </Box>

      {/* Step 1: Recipient / Account */}
      <StepRow
        label={hasAztecWallet ? 'Account' : 'Recipient'}
        description={hasAztecWallet
          ? (claimDone ? `Funded — FJ: ${feeJuiceBalance}` : aztecAddress?.toString().slice(0, 14) + '...')
          : credentials.recipient.slice(0, 14) + '...'}
        status={stepStatus(1)}
        expanded={expandedStep === 1}
        onToggle={() => toggle(1)}
      >
        {hasAztecWallet ? (
          <>
            <Typography variant="caption" color="text.secondary" sx={{ wordBreak: 'break-all', fontFamily: 'monospace', fontSize: '0.65rem' }}>
              {aztecAddress?.toString()}
            </Typography>
            {feeJuiceBalance != null && (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                Fee Juice: <span style={{ color: '#D4FF28' }}>{feeJuiceBalance}</span>
              </Typography>
            )}
            <Box sx={{ mt: 1 }}><AccountExport /></Box>
          </>
        ) : (
          <Typography variant="caption" sx={{ wordBreak: 'break-all', fontFamily: 'monospace', fontSize: '0.65rem' }}>
            {credentials.recipient}
          </Typography>
        )}
      </StepRow>

      {/* Step 2: Bridge / Claim credentials */}
      <StepRow
        label="Bridge"
        description="L1 deposit confirmed"
        status={stepStatus(2)}
        expanded={expandedStep === 2}
        onToggle={() => toggle(2)}
      >
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 0.5 }}>
          <Tooltip title={allCopied ? 'Copied!' : 'Copy all'}>
            <IconButton size="small" onClick={copyAll} sx={{ color: 'primary.main', p: 0.25 }}>
              <ContentCopyIcon sx={{ fontSize: 14 }} />
            </IconButton>
          </Tooltip>
        </Box>
        <CopyField label="Amount" value={credentials.claimAmount} />
        <CopyField label="Claim Secret" value={credentials.claimSecret} />
        <CopyField label="Message Leaf Index" value={credentials.messageLeafIndex} />
      </StepRow>

      {/* Step 3: L2 Sync */}
      <StepRow
        label="L2 Sync"
        description={syncDone ? 'Message ready' : 'Waiting for L2 checkpoint...'}
        status={stepStatus(3)}
        expanded={expandedStep === 3}
        onToggle={() => toggle(3)}
      />

      {/* Step 4: Claim */}
      <StepRow
        label="Claim"
        description={claimDone ? 'Fee juice claimed' : 'Claim on Aztec L2'}
        status={stepStatus(4)}
        expanded={expandedStep === 4}
        onToggle={() => toggle(4)}
      >
        {!claimDone && (
          <ClaimPanel credentials={credentials} messageReady={syncDone} />
        )}
      </StepRow>

      {/* Bridge More */}
      <Box
        component="button"
        onClick={onReset}
        sx={{
          mt: 2, width: '100%', p: 1.5,
          border: '1px solid rgba(212,255,40,0.3)',
          backgroundColor: 'transparent', color: 'text.secondary',
          cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.875rem', fontWeight: 600,
          '&:hover': { backgroundColor: 'rgba(212,255,40,0.05)' },
        }}
      >
        Bridge More
      </Box>
    </Paper>
  );
}
