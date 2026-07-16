import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import client from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';

export default function JoinInvite() {
  const { code } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!code) return;
    client
      .get(`/groups/invite/${code}`)
      .then((res) => setPreview(res.data.data))
      .catch((err) => setError(err.response?.data?.error || 'Invite not found'));
  }, [code]);

  async function join() {
    setBusy(true);
    setError('');
    try {
      await client.post('/groups/join', { code });
      navigate('/chat');
    } catch (err) {
      setError(err.response?.data?.error || 'Could not join group');
      setBusy(false);
    }
  }

  return (
    <div className="join-invite-page">
      <div className="join-invite-card">
        <h1>Join group</h1>
        {preview ? (
          <>
            <h2>{preview.name}</h2>
            {preview.description && <p>{preview.description}</p>}
            <p className="muted">{preview.memberCount} members</p>
          </>
        ) : !error ? (
          <p className="muted">Loading invite…</p>
        ) : null}
        {error && <p className="create-group-error">{error}</p>}
        <div className="join-invite-actions">
          <button type="button" className="btn-secondary" onClick={() => navigate('/chat')}>
            Cancel
          </button>
          <button type="button" className="confirm-btn" onClick={join} disabled={busy || !!error || !user}>
            Join group
          </button>
        </div>
      </div>
    </div>
  );
}
