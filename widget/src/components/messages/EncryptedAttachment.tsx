import { useEffect, useState } from 'react';
import type { IAttachment } from '@quantum-chat/shared';
import { decryptAttachmentBytes } from '../../utils/attachmentCrypto';

interface EncryptedAttachmentProps {
  file: IAttachment;
  conversationId: string;
  baseUrl: string;
}

export function EncryptedAttachment({ file, conversationId, baseUrl }: EncryptedAttachmentProps) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [mimeType, setMimeType] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    let blobUrl: string | null = null;

    const load = async () => {
      try {
        const fileUrl = file.url?.startsWith('http') ? file.url : `${baseUrl}${file.url}`;
        const res = await fetch(fileUrl);
        if (!res.ok) throw new Error('Fetch failed');
        const encryptedBytes = await res.arrayBuffer();
        const decrypted = await decryptAttachmentBytes(conversationId, file, encryptedBytes);
        if (!decrypted || !active) {
          if (active) setError(true);
          return;
        }
        const blob = new Blob([decrypted.data], { type: decrypted.mimeType });
        blobUrl = URL.createObjectURL(blob);
        setObjectUrl(blobUrl);
        setDisplayName(decrypted.originalName);
        setMimeType(decrypted.mimeType);
      } catch {
        if (active) setError(true);
      } finally {
        if (active) setLoading(false);
      }
    };

    load();

    return () => {
      active = false;
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [file, conversationId, baseUrl]);

  if (loading) {
    return <span className="qc-attachment-status">🔒 Decrypting attachment...</span>;
  }

  if (error || !objectUrl) {
    return <span className="qc-attachment-status">🔒 Unable to decrypt attachment</span>;
  }

  const isImage = mimeType.startsWith('image/');

  if (isImage) {
    return (
      <a href={objectUrl} download={displayName} target="_blank" rel="noreferrer" className="qc-attachment-image-link">
        <img src={objectUrl} alt={displayName} className="qc-attachment-image" />
      </a>
    );
  }

  return (
    <a
      href={objectUrl}
      download={displayName}
      className="qc-attachment-file-link"
    >
      📎 {displayName || 'Attachment'}
    </a>
  );
}
