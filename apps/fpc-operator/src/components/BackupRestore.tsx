import { useState, useRef } from "react";
import {
  Box,
  Button,
  Typography,
  Alert,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Divider,
  CircularProgress,
} from "@mui/material";
import DownloadIcon from "@mui/icons-material/Download";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import { shortAddress } from "@gregojuice/common";
import { useWallet } from "../contexts/WalletContext";
import { useNetwork } from "../contexts/NetworkContext";
import {
  exportBackup,
  parseAndValidateBackup,
  applyBackup,
  type BackupData,
} from "../services/backupService";

interface BackupRestoreProps {
  mode?: "full" | "import-only";
}

export function BackupRestore({ mode = "full" }: BackupRestoreProps) {
  const { wallet, address } = useWallet();
  const { activeNetwork } = useNetwork();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [exporting, setExporting] = useState(false);
  const [importData, setImportData] = useState<BackupData | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [applying, setApplying] = useState(false);

  const handleExport = async () => {
    if (!wallet || !address) return;
    setExporting(true);
    try {
      await exportBackup(wallet, address);
    } catch (err) {
      console.error("Export failed:", err);
    } finally {
      setExporting(false);
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Reset input so the same file can be re-selected
    e.target.value = "";

    setImportError(null);
    setImportData(null);

    const result = await parseAndValidateBackup(file);
    if (result.errors) {
      setImportError(result.errors.join("; "));
      return;
    }

    setImportData(result.data);
    setConfirmOpen(true);
  };

  const handleConfirmImport = async () => {
    if (!wallet || !importData) return;
    setApplying(true);
    try {
      await applyBackup(wallet, importData);
      // applyBackup calls window.location.reload()
    } catch (err) {
      setApplying(false);
      setImportError(err instanceof Error ? err.message : "Restore failed");
      setConfirmOpen(false);
    }
  };

  const handleCancelImport = () => {
    setConfirmOpen(false);
    setImportData(null);
  };

  const networkMismatch = importData?.network && importData.network !== activeNetwork.id;

  // Import-only mode: compact inline button for SetupWizard
  if (mode === "import-only") {
    return (
      <Box sx={{ textAlign: "center", mt: 2 }}>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          hidden
          onChange={handleFileSelect}
          data-testid="backup-import-input"
        />
        {importError && (
          <Alert severity="error" sx={{ mb: 1 }} data-testid="backup-import-error">
            {importError}
          </Alert>
        )}
        <Button
          variant="text"
          size="small"
          startIcon={<UploadFileIcon />}
          onClick={() => fileInputRef.current?.click()}
          sx={{ textTransform: "none" }}
          data-testid="backup-import-trigger"
        >
          Have a backup? Restore from file
        </Button>

        <ConfirmDialog
          open={confirmOpen}
          data={importData}
          applying={applying}
          networkMismatch={!!networkMismatch}
          onConfirm={handleConfirmImport}
          onCancel={handleCancelImport}
        />
      </Box>
    );
  }

  // Full mode: export + import sections for Dashboard
  return (
    <Box>
      {/* Export */}
      <Typography variant="h6" sx={{ mb: 1 }}>
        Backup
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Export your admin keys and FPC configuration to a JSON file. Store this file securely — it
        contains private keys.
      </Typography>
      <Alert severity="warning" sx={{ mb: 2 }}>
        The backup file contains your admin secret key and FPC secret key. Anyone with this file can
        control your admin account and FPC contract. Keep it safe.
      </Alert>
      <Button
        variant="contained"
        startIcon={exporting ? <CircularProgress size={18} /> : <DownloadIcon />}
        onClick={handleExport}
        disabled={!wallet || !address || exporting}
        data-testid="backup-export"
      >
        {exporting ? "Exporting..." : "Export Backup"}
      </Button>

      <Divider sx={{ my: 4 }} />

      {/* Import */}
      <Typography variant="h6" sx={{ mb: 1 }}>
        Restore
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Replace the current configuration with a previously exported backup file. This will
        overwrite all current data and reload the page.
      </Typography>
      {importError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {importError}
        </Alert>
      )}
      <input ref={fileInputRef} type="file" accept=".json" hidden onChange={handleFileSelect} />
      <Button
        variant="outlined"
        startIcon={<UploadFileIcon />}
        onClick={() => fileInputRef.current?.click()}
        disabled={!wallet}
      >
        Restore from Backup
      </Button>

      <ConfirmDialog
        open={confirmOpen}
        data={importData}
        applying={applying}
        networkMismatch={!!networkMismatch}
        onConfirm={handleConfirmImport}
        onCancel={handleCancelImport}
      />
    </Box>
  );
}

// ── Confirmation dialog ──────────────────────────────────────────────

function ConfirmDialog({
  open,
  data,
  applying,
  networkMismatch,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  data: BackupData | null;
  applying: boolean;
  networkMismatch: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!data) return null;

  return (
    <Dialog open={open} onClose={applying ? undefined : onCancel} maxWidth="sm" fullWidth>
      <DialogTitle>Confirm Restore</DialogTitle>
      <DialogContent>
        {networkMismatch && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            This backup was exported from network "{data.network}". You are currently connected to a
            different network.
          </Alert>
        )}
        <Alert severity="error" sx={{ mb: 2 }}>
          This will replace all current data and reload the page.
        </Alert>
        <Typography variant="body2" sx={{ mb: 1 }}>
          <strong>Admin address:</strong>{" "}
          {data.admin.address ? shortAddress(data.admin.address) : "Unknown"}
        </Typography>
        {data.fpc && (
          <Typography variant="body2" sx={{ mb: 1 }}>
            <strong>FPC address:</strong> {shortAddress(data.fpc.address)}
            {data.fpc.deployed ? " (deployed)" : " (not deployed)"}
          </Typography>
        )}
        <Typography variant="body2" sx={{ mb: 1 }}>
          <strong>Signed-up apps:</strong> {data.apps?.length ?? 0}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          <strong>Exported:</strong> {new Date(data.exportedAt).toLocaleString()}
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel} disabled={applying}>
          Cancel
        </Button>
        <Button
          onClick={onConfirm}
          variant="contained"
          color="error"
          disabled={applying}
          startIcon={applying ? <CircularProgress size={18} /> : undefined}
          data-testid="backup-import-confirm-button"
        >
          {applying ? "Restoring..." : "Restore"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
