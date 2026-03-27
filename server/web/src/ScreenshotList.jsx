import React, { useState } from 'react';
import {
  List,
  Datagrid,
  TextField,
  FunctionField,
  useRecordContext,
  useRefresh,
  useNotify,
  useDelete,
  TextInput,
  TopToolbar,
  FilterButton,
  ExportButton,
} from 'react-admin';
import {
  Box,
  Button,
  IconButton,
  Tooltip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Snackbar,
  Alert,
  Chip,
} from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import DeleteIcon from '@mui/icons-material/Delete';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import CheckIcon from '@mui/icons-material/Check';

const formatFileSize = (bytes) => {
  if (!bytes && bytes !== 0) return '-';
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
};

const formatDate = (dateString) => {
  if (!dateString) return '-';
  const d = new Date(dateString);
  if (isNaN(d.getTime())) return dateString;
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const ThumbnailField = () => {
  const record = useRecordContext();
  if (!record) return null;
  return (
    <a href={record.url} target="_blank" rel="noopener noreferrer">
      <Box
        component="img"
        src={record.url}
        alt={record.name}
        sx={{
          maxHeight: 120,
          maxWidth: 200,
          objectFit: 'contain',
          borderRadius: 1,
          cursor: 'pointer',
          transition: 'opacity 0.2s',
          '&:hover': { opacity: 0.8 },
        }}
      />
    </a>
  );
};

const CopyUrlButton = () => {
  const record = useRecordContext();
  const [copied, setCopied] = useState(false);

  if (!record) return null;

  const handleCopy = async (e) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(record.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for non-HTTPS contexts
      const textarea = document.createElement('textarea');
      textarea.value = record.url;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <Button
      variant={copied ? 'contained' : 'outlined'}
      color={copied ? 'success' : 'primary'}
      size="small"
      startIcon={copied ? <CheckIcon /> : <ContentCopyIcon />}
      onClick={handleCopy}
      sx={{ minWidth: 110, textTransform: 'none' }}
    >
      {copied ? 'Copied!' : 'Copy URL'}
    </Button>
  );
};

const DeleteButton = () => {
  const record = useRecordContext();
  const refresh = useRefresh();
  const notify = useNotify();
  const [open, setOpen] = useState(false);
  const [deleteOne, { isLoading }] = useDelete();

  if (!record) return null;

  const handleDelete = () => {
    deleteOne(
      'screenshots',
      { id: record.id, previousData: record },
      {
        onSuccess: () => {
          setOpen(false);
          notify('Screenshot deleted', { type: 'success' });
          refresh();
        },
        onError: (error) => {
          setOpen(false);
          notify(`Error: ${error.message}`, { type: 'error' });
        },
      }
    );
  };

  return (
    <>
      <Tooltip title="Delete">
        <IconButton
          size="small"
          color="error"
          onClick={(e) => {
            e.stopPropagation();
            setOpen(true);
          }}
        >
          <DeleteIcon fontSize="small" />
        </IconButton>
      </Tooltip>
      <Dialog open={open} onClose={() => setOpen(false)}>
        <DialogTitle>Delete Screenshot</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Are you sure you want to delete <strong>{record.name}</strong>? This
            action cannot be undone.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Cancel</Button>
          <Button
            onClick={handleDelete}
            color="error"
            variant="contained"
            disabled={isLoading}
          >
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};

const screenshotFilters = [
  <TextInput key="q" label="Search" source="q" alwaysOn />,
];

const ListActions = () => (
  <TopToolbar>
    <FilterButton />
    <ExportButton />
  </TopToolbar>
);

export const ScreenshotList = () => (
  <List
    filters={screenshotFilters}
    actions={<ListActions />}
    sort={{ field: 'lastModified', order: 'DESC' }}
    perPage={20}
    title="Screenshots"
  >
    <Datagrid bulkActionButtons={false} rowClick={false}>
      <FunctionField label="Preview" render={() => <ThumbnailField />} />
      <FunctionField
        label="Filename"
        sortBy="name"
        render={(record) => (
          <Tooltip title={record.name}>
            <Box
              sx={{
                maxWidth: 250,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                fontFamily: 'monospace',
                fontSize: '0.85rem',
              }}
            >
              {record.name}
            </Box>
          </Tooltip>
        )}
      />
      <FunctionField
        label="Date"
        sortBy="lastModified"
        render={(record) => (
          <Chip
            label={formatDate(record.lastModified)}
            size="small"
            variant="outlined"
          />
        )}
      />
      <FunctionField
        label="Size"
        sortBy="size"
        render={(record) => (
          <Chip
            label={formatFileSize(record.size)}
            size="small"
            color="default"
          />
        )}
      />
      <FunctionField
        label="Actions"
        render={() => (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <CopyUrlButton />
            <OpenInNewButton />
            <DeleteButton />
          </Box>
        )}
      />
    </Datagrid>
  </List>
);

const OpenInNewButton = () => {
  const record = useRecordContext();
  if (!record) return null;
  return (
    <Tooltip title="Open full size">
      <IconButton
        size="small"
        color="primary"
        component="a"
        href={record.url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
      >
        <OpenInNewIcon fontSize="small" />
      </IconButton>
    </Tooltip>
  );
};
